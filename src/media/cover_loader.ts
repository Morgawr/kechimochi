import { readFileBytes } from '../api';
import { logPerformance, performanceNow } from '../performance';
import { getServices } from '../services';

interface MediaCoverLoadOptions {
    cache?: boolean;
    useCache?: boolean;
}

interface CachedCover {
    src: string;
    byteSize: number;
}

interface LoadedCover {
    src: string | null;
    byteSize: number;
}

const MAX_CACHE_ENTRIES = 96;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const MAX_CONCURRENT_LOADS = 4;
const NEGATIVE_CACHE_MS = 30_000;

/**
 * Process-local, generation-scoped cover cache.
 *
 * Object URLs are bounded by both count and source byte size, concurrent reads
 * are capped, and identical in-flight requests are shared. `clear()` advances
 * the generation so a cover resolving from an old/restored dataset can never
 * be committed into the new dataset's cache.
 */
export class MediaCoverLoader {
    private static readonly imageCache = new Map<string, CachedCover>();
    private static readonly pendingLoads = new Map<string, Promise<string | null>>();
    private static readonly failedUntil = new Map<string, number>();
    private static readonly loadQueue: Array<() => void> = [];
    private static cachedBytes = 0;
    private static activeLoads = 0;
    private static generation = 0;

    public static async load(coverImage: string, options: MediaCoverLoadOptions = {}): Promise<string | null> {
        const { cache = true, useCache = true } = options;
        const coverRef = coverImage?.trim();
        if (!coverRef) {
            return null;
        }

        if (useCache) {
            const cached = MediaCoverLoader.takeCached(coverRef);
            if (cached) {
                MediaCoverLoader.recordLoad('cache', 'success', 0, cached.byteSize);
                return cached.src;
            }

            const failedUntil = MediaCoverLoader.failedUntil.get(coverRef) ?? 0;
            if (failedUntil > Date.now()) {
                MediaCoverLoader.recordLoad('negative_cache', 'missing', 0, 0);
                return null;
            }
            MediaCoverLoader.failedUntil.delete(coverRef);

            const pending = MediaCoverLoader.pendingLoads.get(coverRef);
            if (pending) {
                MediaCoverLoader.recordLoad('in_flight', 'shared', 0, 0);
                return pending;
            }
        }

        const generation = MediaCoverLoader.generation;
        const started = performanceNow();
        const loadPromise = MediaCoverLoader.enqueue(async () => {
            if (generation !== MediaCoverLoader.generation) {
                return { src: null, byteSize: 0 };
            }
            return MediaCoverLoader.loadSource(coverRef);
        }).then(result => {
            if (generation !== MediaCoverLoader.generation) {
                MediaCoverLoader.revokeIfObjectUrl(result.src);
                MediaCoverLoader.recordLoad('source', 'stale', performanceNow() - started, result.byteSize);
                return null;
            }

            if (!result.src) {
                if (cache) {
                    MediaCoverLoader.failedUntil.set(coverRef, Date.now() + NEGATIVE_CACHE_MS);
                    MediaCoverLoader.trimFailures();
                }
                MediaCoverLoader.recordLoad('source', 'missing', performanceNow() - started, result.byteSize);
                return null;
            }

            if (cache) {
                MediaCoverLoader.store(coverRef, result);
            }
            MediaCoverLoader.recordLoad('source', 'success', performanceNow() - started, result.byteSize);
            return result.src;
        }).catch(() => {
            if (cache && generation === MediaCoverLoader.generation) {
                MediaCoverLoader.failedUntil.set(coverRef, Date.now() + NEGATIVE_CACHE_MS);
                MediaCoverLoader.trimFailures();
            }
            MediaCoverLoader.recordLoad('source', 'error', performanceNow() - started, 0);
            return null;
        });

        if (!useCache) {
            return loadPromise;
        }

        MediaCoverLoader.pendingLoads.set(coverRef, loadPromise);
        try {
            return await loadPromise;
        } finally {
            if (MediaCoverLoader.pendingLoads.get(coverRef) === loadPromise) {
                MediaCoverLoader.pendingLoads.delete(coverRef);
            }
        }
    }

    public static clear() {
        MediaCoverLoader.generation += 1;
        for (const entry of MediaCoverLoader.imageCache.values()) {
            MediaCoverLoader.revokeIfObjectUrl(entry.src);
        }
        MediaCoverLoader.imageCache.clear();
        MediaCoverLoader.pendingLoads.clear();
        MediaCoverLoader.failedUntil.clear();
        MediaCoverLoader.cachedBytes = 0;
    }

    public static getCached(coverImage: string): string | null {
        const coverRef = coverImage?.trim();
        if (!coverRef) return null;
        return MediaCoverLoader.takeCached(coverRef)?.src ?? null;
    }

    public static revokeIfObjectUrl(src: string | null) {
        if (!src?.startsWith('blob:')) return;
        URL.revokeObjectURL(src);
    }

    private static takeCached(coverRef: string): CachedCover | null {
        const cached = MediaCoverLoader.imageCache.get(coverRef);
        if (!cached) return null;
        // Refresh insertion order for LRU eviction.
        MediaCoverLoader.imageCache.delete(coverRef);
        MediaCoverLoader.imageCache.set(coverRef, cached);
        return cached;
    }

    private static async loadSource(coverRef: string): Promise<LoadedCover> {
        if (!getServices().isDesktop()) {
            return {
                src: await getServices().loadCoverImage(coverRef),
                byteSize: 0,
            };
        }

        const bytes = await readFileBytes(coverRef);
        const blob = new Blob([new Uint8Array(bytes)]);
        return {
            src: URL.createObjectURL(blob),
            byteSize: bytes.length,
        };
    }

    private static enqueue<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const run = () => {
                MediaCoverLoader.activeLoads += 1;
                operation()
                    .then(resolve, reject)
                    .finally(() => {
                        MediaCoverLoader.activeLoads -= 1;
                        MediaCoverLoader.drainQueue();
                    });
            };

            if (MediaCoverLoader.activeLoads < MAX_CONCURRENT_LOADS) {
                run();
            } else {
                MediaCoverLoader.loadQueue.push(run);
            }
        });
    }

    private static drainQueue(): void {
        while (MediaCoverLoader.activeLoads < MAX_CONCURRENT_LOADS) {
            const next = MediaCoverLoader.loadQueue.shift();
            if (!next) return;
            next();
        }
    }

    private static store(coverRef: string, loaded: LoadedCover): void {
        if (!loaded.src) return;
        const previous = MediaCoverLoader.imageCache.get(coverRef);
        if (previous) {
            MediaCoverLoader.cachedBytes -= previous.byteSize;
            if (previous.src !== loaded.src) {
                MediaCoverLoader.revokeIfObjectUrl(previous.src);
            }
            MediaCoverLoader.imageCache.delete(coverRef);
        }

        MediaCoverLoader.imageCache.set(coverRef, {
            src: loaded.src,
            byteSize: loaded.byteSize,
        });
        MediaCoverLoader.cachedBytes += loaded.byteSize;

        while (
            MediaCoverLoader.imageCache.size > MAX_CACHE_ENTRIES
            || MediaCoverLoader.cachedBytes > MAX_CACHE_BYTES
        ) {
            const oldest = MediaCoverLoader.imageCache.entries().next().value as [string, CachedCover] | undefined;
            if (!oldest) break;
            MediaCoverLoader.imageCache.delete(oldest[0]);
            MediaCoverLoader.cachedBytes -= oldest[1].byteSize;
            MediaCoverLoader.revokeIfObjectUrl(oldest[1].src);
        }
    }

    private static trimFailures(): void {
        while (MediaCoverLoader.failedUntil.size > MAX_CACHE_ENTRIES) {
            const oldestKey = MediaCoverLoader.failedUntil.keys().next().value as string | undefined;
            if (!oldestKey) return;
            MediaCoverLoader.failedUntil.delete(oldestKey);
        }
    }

    private static recordLoad(source: string, outcome: string, durationMs: number, byteSize: number): void {
        logPerformance('image_load', 'cover_image', durationMs, {
            source,
            outcome,
            byte_size: byteSize,
            cache_entries: MediaCoverLoader.imageCache.size,
            in_flight: MediaCoverLoader.pendingLoads.size,
        });
    }
}

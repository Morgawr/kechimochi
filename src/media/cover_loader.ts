import { readFileBytes } from '../api';
import { getServices } from '../services';

interface MediaCoverLoadOptions {
    cache?: boolean;
    useCache?: boolean;
}

export class MediaCoverLoader {
    private static readonly imageCache = new Map<string, string>();

    public static async load(coverImage: string, options: MediaCoverLoadOptions = {}): Promise<string | null> {
        const { cache = true, useCache = true } = options;

        if (!coverImage || coverImage.trim() === '') {
            return null;
        }

        if (useCache && MediaCoverLoader.imageCache.has(coverImage)) {
            return MediaCoverLoader.imageCache.get(coverImage)!;
        }

        const src = getServices().isDesktop()
            ? await (async () => {
            const bytes = await readFileBytes(coverImage);
            const blob = new Blob([new Uint8Array(bytes)]);
                return URL.createObjectURL(blob);
            })()
            : await getServices().loadCoverImage(coverImage);

        if (!src) {
            return null;
        }

        if (cache) {
            MediaCoverLoader.imageCache.set(coverImage, src);
        }
        return src;
    }

    public static clear() {
        for (const src of MediaCoverLoader.imageCache.values()) {
            MediaCoverLoader.revokeIfObjectUrl(src);
        }
        MediaCoverLoader.imageCache.clear();
    }

    public static getCached(coverImage: string): string | null {
        return MediaCoverLoader.imageCache.get(coverImage) || null;
    }

    public static revokeIfObjectUrl(src: string | null) {
        if (!src?.startsWith('blob:')) return;
        URL.revokeObjectURL(src);
    }
}

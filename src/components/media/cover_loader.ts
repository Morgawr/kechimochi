import { readFileBytes } from '../../api';
import { getServices } from '../../services';

export class MediaCoverLoader {
    private static readonly imageCache = new Map<string, string>();

    public static async load(coverImage: string): Promise<string | null> {
        if (!coverImage || coverImage.trim() === '') {
            return null;
        }

        if (MediaCoverLoader.imageCache.has(coverImage)) {
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

        MediaCoverLoader.imageCache.set(coverImage, src);
        return src;
    }

    public static clear() {
        MediaCoverLoader.imageCache.clear();
    }
}

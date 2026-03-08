export interface ScrapedMetadata {
    title: string;
    description: string;
    coverImageUrl: string;
    extraData: Record<string, string>;
}

export interface MetadataImporter {
    matchUrl(url: string, contentType: string): boolean;
    fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata>;
}

import { VndbImporter } from './vndb';
import { BackloggdImporter } from './backloggd';
import { ImdbImporter } from './imdb';
import { AnilistImporter } from './anilist';
import { CmoaImporter } from './cmoa';
import { BookwalkerImporter } from './bookwalker';

export const importers: MetadataImporter[] = [
    new VndbImporter(),
    new BackloggdImporter(),
    new ImdbImporter(),
    new AnilistImporter(),
    new CmoaImporter(),
    new BookwalkerImporter()
];

export async function fetchMetadataForUrl(url: string, contentType: string, targetVolume?: number): Promise<ScrapedMetadata | null> {
    const importer = importers.find(i => i.matchUrl(url, contentType));
    if (!importer) {
        throw new Error("No importer available for this URL and/or Content Type.");
    }
    return await importer.fetch(url, targetVolume);
}

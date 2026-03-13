export interface ScrapedMetadata {
    title: string;
    description: string;
    coverImageUrl: string;
    extraData: Record<string, string>;
}

export interface MetadataImporter {
    name: string;
    supportedContentTypes: string[];
    matchUrl(url: string, contentType: string): boolean;
    fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata>;
}

import { VndbImporter } from './vndb';
import { BackloggdImporter } from './backloggd';
import { ImdbImporter } from './imdb';
import { AnilistImporter } from './anilist';
import { CmoaImporter } from './cmoa';
import { BookwalkerImporter } from './bookwalker';
import { BookmeterImporter } from './bookmeter';
import { ShonenjumpplusImporter } from './shonenjumpplus';
import { JitenImporter } from './jiten';

export const importers: MetadataImporter[] = [
    new VndbImporter(),
    new BackloggdImporter(),
    new ImdbImporter(),
    new AnilistImporter(),
    new CmoaImporter(),
    new BookwalkerImporter(),
    new BookmeterImporter(),
    new ShonenjumpplusImporter(),
    new JitenImporter()
];

function getMockMetadata(): ScrapedMetadata | null {
    const direct = (globalThis as unknown as Record<string, unknown>).mockMetadata;
    if (direct) return direct as ScrapedMetadata;
    return null;
}

export async function fetchMetadataForUrl(url: string, contentType: string, targetVolume?: number): Promise<ScrapedMetadata | null> {
    const mock = getMockMetadata();
    if (mock) return mock;
    const importer = importers.find(i => i.matchUrl(url, contentType));
    if (!importer) {
        throw new Error("No importer available for this URL and/or Content Type.");
    }
    return await importer.fetch(url, targetVolume);
}

export function isValidImporterUrl(url: string, contentType: string): boolean {
    return importers.some(i => i.matchUrl(url, contentType));
}

export function getImportersForContentType(contentType: string): MetadataImporter[] {
    return importers.filter(i => i.supportedContentTypes.includes(contentType));
}

export function getAvailableSourcesForContentType(contentType: string): string[] {
    return getImportersForContentType(contentType).map(i => i.name);
}

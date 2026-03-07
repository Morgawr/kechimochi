export interface ScrapedMetadata {
    title: string;
    description: string;
    coverImageUrl: string;
    extraData: Record<string, string>;
}

export interface MetadataImporter {
    matchUrl(url: string, contentType: string): boolean;
    fetch(url: string): Promise<ScrapedMetadata>;
}

import { VndbImporter } from './vndb';

export const importers: MetadataImporter[] = [
    new VndbImporter()
];

export async function fetchMetadataForUrl(url: string, contentType: string): Promise<ScrapedMetadata | null> {
    const importer = importers.find(i => i.matchUrl(url, contentType));
    if (!importer) {
        throw new Error("No importer available for this URL and/or Content Type.");
    }
    return await importer.fetch(url);
}

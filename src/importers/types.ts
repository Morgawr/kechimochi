export type ScrapedFieldSource = 'direct' | 'entireSeries';

export interface ScrapedMetadataFieldSources {
    description?: ScrapedFieldSource;
    coverImageUrl?: ScrapedFieldSource;
    extraData?: Record<string, ScrapedFieldSource>;
}

export interface ScrapedMetadata {
    title: string;
    description: string;
    coverImageUrl: string;
    extraData: Record<string, string>;
    contentType?: string;
    fieldSources?: ScrapedMetadataFieldSources;
}

export interface MetadataImporter {
    name: string;
    supportedContentTypes: string[];
    matchUrl(url: string, contentType?: string): boolean;
    fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata>;
}

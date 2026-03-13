import { MetadataImporter, ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

export abstract class BaseImporter implements MetadataImporter {
    abstract name: string;
    abstract supportedContentTypes: string[];
    abstract matchUrl(url: string, contentType?: string): boolean;
    abstract fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata>;

    protected createExtraData(url: string, initialData: Record<string, string> = {}): Record<string, string> {
        return {
            [`Source (${this.name})`]: url,
            ...initialData
        };
    }

    protected async fetchHtml(url: string, headers?: Record<string, string>): Promise<Document> {
        const html = await fetchExternalJson(url, "GET", undefined, headers);
        return this.parseHtml(html);
    }

    protected parseHtml(html: string): Document {
        const parser = new DOMParser();
        return parser.parseFromString(html, 'text/html');
    }
}

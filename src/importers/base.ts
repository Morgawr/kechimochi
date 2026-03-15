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

    protected sanitizeDescription(description: string): string {
        if (!description) return "";

        const normalizedHtml = description
            .replaceAll(/\r\n?/g, '\n')
            .replaceAll(/<\s*br\s*\/?>/gi, '\n')
            .replaceAll(/<\/(p|div|li|h[1-6]|blockquote|section|article|tr)>/gi, '\n');

        const doc = this.parseHtml(`<div>${normalizedHtml}</div>`);
        const text = doc.body.textContent || "";

        const lines = text
            .replaceAll('\u00a0', ' ')
            .split('\n')
            .map(line => line.replaceAll('\t', ' ').trim().split(' ').filter(Boolean).join(' '));

        const collapsedLines: string[] = [];
        let blankLineCount = 0;

        for (const line of lines) {
            if (!line) {
                blankLineCount += 1;
                if (blankLineCount <= 2) collapsedLines.push("");
                continue;
            }

            blankLineCount = 0;
            collapsedLines.push(line);
        }

        return collapsedLines.join('\n').trim();
    }
}

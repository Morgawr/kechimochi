import { MetadataImporter, ScrapedMetadata } from './index';
import { invoke } from '@tauri-apps/api/core';

export class BookmeterImporter implements MetadataImporter {
    name = "Bookmeter";
    supportedContentTypes = ["Novel"];
    matchUrl(url: string, contentType: string): boolean {
        // We only allow Bookmeter urls for Novel
        return this.supportedContentTypes.includes(contentType) && url.includes("bookmeter.com/books/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const html = await invoke<string>('fetch_external_json', { url, method: "GET" });
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const extraData: Record<string, string> = { "Bookmeter Source": url };
        const description = this.extractDescription(doc);
        const coverImageUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || "";
        
        this.extractPageCount(doc, extraData);
        this.extractPublisher(doc, extraData);
        this.extractAuthor(html, extraData);

        return { title: "", description, coverImageUrl, extraData };
    }

    private extractDescription(doc: Document): string {
        const metaDesc = doc.querySelector('meta[property="og:description"]');
        let description = metaDesc?.getAttribute('content') || "";
        
        const prefixRegex = /^.*?があるので安心。/;
        if (prefixRegex.test(description)) {
            description = description.replace(prefixRegex, '').trim();
        }
        return description;
    }

    private extractPageCount(doc: Document, extraData: Record<string, string>) {
        const dtTags = doc.querySelectorAll('dt.bm-details-side__title');
        for (const dt of Array.from(dtTags)) {
            if (dt.textContent?.trim() === "ページ数") {
                const dd = dt.nextElementSibling;
                if (dd?.tagName.toLowerCase() === 'dd') {
                    const match = dd.textContent?.trim().match(/(\d+)/);
                    if (match) extraData["Page Count"] = match[1];
                }
                break;
            }
        }
    }

    private extractPublisher(doc: Document, extraData: Record<string, string>) {
        const pubEl = doc.querySelector('.current-book-detail__publisher');
        if (pubEl) {
            const pubText = pubEl.textContent?.trim() || "";
            const pubMatch = pubText.match(/出版社：(.+)/);
            extraData["Publisher"] = pubMatch ? pubMatch[1].trim() : pubText;
        }
    }

    private extractAuthor(html: string, extraData: Record<string, string>) {
        const authorMatch = html.match(/class="header__authors">.*?href="\/search\?author=[^"]+">([^<]+)<\/a>/is);
        if (authorMatch) {
            extraData["Author"] = authorMatch[1].trim();
        }
    }
}

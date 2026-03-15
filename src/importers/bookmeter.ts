import { BaseImporter } from './base';
import { ScrapedMetadata } from './index';

export class BookmeterImporter extends BaseImporter {
    name = "Bookmeter";
    supportedContentTypes = ["Novel"];
    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("bookmeter.com/books/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const doc = await this.fetchHtml(url);

        const extraData = this.createExtraData(url);
        const description = this.extractDescription(doc);
        const coverImageUrl = doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content || "";
        
        this.extractPageCount(doc, extraData);
        this.extractPublisher(doc, extraData);
        this.extractAuthor(doc, extraData);

        return { title: "", description: this.sanitizeDescription(description), coverImageUrl, extraData };
    }

    private extractDescription(doc: Document): string {
        const metaDesc = doc.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        let description = metaDesc?.content || "";
        
        const prefixRegex = /^.*?があるので安心。/g;
        if (description && prefixRegex.test(description)) {
            description = description.replaceAll(prefixRegex, '').trim();
        }
        return description;
    }

    private extractPageCount(doc: Document, extraData: Record<string, string>) {
        const dtTags = doc.querySelectorAll('dt.bm-details-side__title');
        for (const dt of Array.from(dtTags)) {
            if (dt.textContent?.trim() === "ページ数") {
                const dd = dt.nextElementSibling;
                if (dd?.tagName.toLowerCase() === 'dd') {
                    const match = (/(\d+)/).exec(dd.textContent?.trim() || "");
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
            const pubMatch = (/出版社：(.+)/).exec(pubText);
            extraData["Publisher"] = pubMatch ? pubMatch[1].trim() : pubText;
        }
    }

    private extractAuthor(doc: Document, extraData: Record<string, string>) {
        const authorEl = doc.querySelector('.header__authors a');
        if (authorEl) {
            extraData["Author"] = authorEl.textContent?.trim() || "";
        }
    }
}

import { BaseImporter } from './base';
import type { ScrapedMetadata } from './types';
import { Logger } from '../logger';
import { fetchExternalJson } from '../platform';

export class ShonenjumpplusImporter extends BaseImporter {
    name = "Shonen Jump Plus";
    supportedContentTypes = ["Reading", "Manga"];

    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("shonenjumpplus.com/episode/");
    }

    async fetch(url: string, _targetVolume?: number): Promise<ScrapedMetadata> {
        const doc = await this.fetchHtml(url);

        const coverImageUrl = this.extractCoverImage(doc);
        const rssUrl = doc.querySelector<HTMLLinkElement>('link[rel="alternate"][type="application/rss+xml"]')?.href;

        const extraData = this.createExtraData(url);
        let description = "";

        if (rssUrl) {
            const rssData = await this.fetchAndParseRss(rssUrl);
            if (rssData) {
                description = rssData.description;
                if (rssData.author) extraData["Author"] = rssData.author;
                if (rssData.pubDate) extraData["Publication Date"] = rssData.pubDate;
            }
        }

        return { title: "", description: this.sanitizeDescription(description), coverImageUrl, extraData };
    }

    private extractCoverImage(doc: Document): string {
        let url = doc.querySelector<HTMLImageElement>('.series-header-image-wrapper img, .series-header-image')?.src ||
                  doc.querySelector<HTMLElement>('.series-header-image-wrapper img, .series-header-image')?.dataset.src || "";
        
        if (!url) {
            url = doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content || "";
        }
        return url;
    }

    private async fetchAndParseRss(rssUrl: string) {
        try {
            const rssXml = await fetchExternalJson(rssUrl, "GET");
            const parser = new DOMParser();
            const rssDoc = parser.parseFromString(rssXml, 'text/xml');
            
            const description = rssDoc.querySelector('channel > description')?.textContent?.trim() || "";
            const author = rssDoc.querySelector('item > author')?.textContent?.trim();
            const pubDate = this.extractOldestPubDate(rssDoc);

            return { description, author, pubDate };
        } catch (e) {
            Logger.error("Failed to fetch or parse RSS feed:", e);
            return null;
        }
    }

    private extractOldestPubDate(rssDoc: Document): string | undefined {
        const pubDates = Array.from(rssDoc.querySelectorAll('item > pubDate'))
            .map(el => el.textContent ? new Date(el.textContent) : null)
            .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));

        if (pubDates.length > 0) {
            const oldestDate = new Date(Math.min(...pubDates.map(d => d.getTime())));
            return oldestDate.toISOString().split('T')[0];
        }
        return undefined;
    }
}

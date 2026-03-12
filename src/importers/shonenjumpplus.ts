import { MetadataImporter, ScrapedMetadata } from './index';
import { invoke } from '@tauri-apps/api/core';

export class ShonenjumpplusImporter implements MetadataImporter {
    name = "Shonen Jump Plus";
    supportedContentTypes = ["Reading", "Manga"];

    matchUrl(url: string, contentType: string): boolean {
        return this.supportedContentTypes.includes(contentType) && url.includes("shonenjumpplus.com/episode/");
    }

    async fetch(url: string, _targetVolume?: number): Promise<ScrapedMetadata> {
        const html = await invoke<string>('fetch_external_json', { url, method: "GET" });
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const coverImageUrl = this.extractCoverImage(doc);
        const rssUrl = (doc.querySelector('link[rel="alternate"][type="application/rss+xml"]') as HTMLLinkElement | null)?.href;

        const extraData: Record<string, string> = { "Source": url };
        let description = "";

        if (rssUrl) {
            const rssData = await this.fetchAndParseRss(rssUrl, parser);
            if (rssData) {
                description = rssData.description;
                if (rssData.author) extraData["Author"] = rssData.author;
                if (rssData.pubDate) extraData["Publication Date"] = rssData.pubDate;
            }
        }

        return { title: "", description, coverImageUrl, extraData };
    }

    private extractCoverImage(doc: Document): string {
        let url = (doc.querySelector('.series-header-image-wrapper img, .series-header-image') as HTMLImageElement | null)?.src ||
                  (doc.querySelector('.series-header-image-wrapper img, .series-header-image') as HTMLElement | null)?.dataset.src || "";
        
        if (!url) {
            url = (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content || "";
        }
        return url;
    }

    private async fetchAndParseRss(rssUrl: string, parser: DOMParser) {
        try {
            const rssXml = await invoke<string>('fetch_external_json', { url: rssUrl, method: "GET" });
            const rssDoc = parser.parseFromString(rssXml, 'text/xml');
            
            const description = rssDoc.querySelector('channel > description')?.textContent?.trim() || "";
            const author = rssDoc.querySelector('item > author')?.textContent?.trim();
            const pubDate = this.extractOldestPubDate(rssDoc);

            return { description, author, pubDate };
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error("Failed to fetch or parse RSS feed:", e);
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

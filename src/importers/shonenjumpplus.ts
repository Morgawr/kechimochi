import { MetadataImporter, ScrapedMetadata } from './index';
import { invoke } from '@tauri-apps/api/core';

export class ShonenjumpplusImporter implements MetadataImporter {
    name = "Shonen Jump Plus";
    supportedContentTypes = ["Reading", "Manga"];

    matchUrl(url: string, contentType: string): boolean {
        return this.supportedContentTypes.includes(contentType) && url.includes("shonenjumpplus.com/episode/");
    }

    async fetch(url: string, _targetVolume?: number): Promise<ScrapedMetadata> {
        // Fetch the episode page
        const html = await invoke<string>('fetch_external_json', { url: url, method: "GET" });
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Extract RSS Link
        const rssLinkEl = doc.querySelector('link[rel="alternate"][type="application/rss+xml"]');
        const rssUrl = rssLinkEl?.getAttribute('href');

        // 2. Extract Cover Image
        let coverImageUrl = "";
        const coverEl = doc.querySelector('.series-header-image-wrapper img, .series-header-image');
        if (coverEl) {
            coverImageUrl = coverEl.getAttribute('src') || coverEl.getAttribute('data-src') || "";
        }
        
        // Fallback for cover if not found in specific wrapper
        if (!coverImageUrl) {
            const ogImage = doc.querySelector('meta[property="og:image"]');
            if (ogImage) {
                coverImageUrl = ogImage.getAttribute('content') || "";
            }
        }

        const extraData: Record<string, string> = {
            "Source": url
        };

        let description = "";
        if (rssUrl) {
            try {
                const rssXml = await invoke<string>('fetch_external_json', { url: rssUrl, method: "GET" });
                const rssDoc = parser.parseFromString(rssXml, 'text/xml');

                // 3. Extract Description
                const descEl = rssDoc.querySelector('channel > description');
                if (descEl) {
                    description = descEl.textContent?.trim() || "";
                }

                // 4. Extract Author
                // Author is usually in each <item>, we take the one from the first item
                const authorEl = rssDoc.querySelector('item > author');
                if (authorEl) {
                    extraData["Author"] = authorEl.textContent?.trim() || "";
                }

                // 5. Extract Publication Date (Oldest pubDate)
                const pubDates = Array.from(rssDoc.querySelectorAll('item > pubDate'))
                    .map(el => el.textContent ? new Date(el.textContent) : null)
                    .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

                if (pubDates.length > 0) {
                    const oldestDate = new Date(Math.min(...pubDates.map(d => d.getTime())));
                    // Format as YYYY-MM-DD
                    extraData["Publication Date"] = oldestDate.toISOString().split('T')[0];
                }
            } catch (e) {
                console.error("Failed to fetch or parse RSS feed:", e);
            }
        }

        // Title handling is usually manual in this app based on other importers
        return {
            title: "", 
            description,
            coverImageUrl,
            extraData
        };
    }
}

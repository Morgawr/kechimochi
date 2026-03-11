import { MetadataImporter, ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

export class BookwalkerImporter implements MetadataImporter {
    name = "Bookwalker";
    supportedContentTypes = ["Reading", "Manga"];
    matchUrl(url: string, contentType: string): boolean {
        return this.supportedContentTypes.includes(contentType) && url.includes("bookwalker.jp/");
    }

    async fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata> {
        let currentUrl = url;
        let html = await fetchExternalJson(currentUrl, "GET");
        let parser = new DOMParser();
        let doc = parser.parseFromString(html, 'text/html');

        // Volume Routing Logic
        if (targetVolume !== undefined) {
            let seriesUrl = "";

            // Check if we are already on a Series List page
            if (currentUrl.includes("/list/") && currentUrl.includes("/series/")) {
                seriesUrl = currentUrl;
            } else {
                // We're on a Volume page, look for the Series List link
                const seriesLink = doc.querySelector('a[href*="/series/"][href$="/list/"]');
                if (seriesLink) {
                    seriesUrl = seriesLink.getAttribute('href') || "";
                }
            }

            if (seriesUrl) {
                // Fetch the Series List page
                const seriesHtml = await fetchExternalJson(seriesUrl, "GET");
                const seriesDoc = parser.parseFromString(seriesHtml, 'text/html');
                
                // Find all volume links
                let foundUrl = "";
                const volumeLinks = seriesDoc.querySelectorAll('.m-book-item__title a');
                
                // We want to find the exact volume number match.
                // Examples of Bookwalker volume text: " 3 ", "（３）", "第3巻"
                // We use regex to isolate the number from Japanese/English wrappers.
                for (const link of volumeLinks) {
                    const titleText = link.textContent?.trim() || "";
                    // Normalize full-width numbers to half-width
                    const normalizedTitleText = titleText.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
                    // Regex to find a number immediately preceded/followed by anything except a digit
                    const r = new RegExp(`(?:[^0-9]|^)0*${targetVolume}(?:[^0-9]|$)`);
                    if (r.test(normalizedTitleText)) {
                        foundUrl = link.getAttribute('href') || "";
                        break;
                    }
                }

                if (foundUrl) {
                    // We found our target volume! Re-fetch the real target page.
                    if (!foundUrl.startsWith("http")) foundUrl = "https://bookwalker.jp" + foundUrl;
                    currentUrl = foundUrl;
                    html = await fetchExternalJson(currentUrl, "GET");
                    doc = parser.parseFromString(html, 'text/html');
                } else {
                    console.warn(`Could not find Volume ${targetVolume} on series list. Using original URL.`);
                }
            } else {
                console.warn(`Could not find a Series List link from the provided URL. Using original URL.`);
            }
        }

        const extraData: Record<string, string> = {
            "Bookwalker Source": currentUrl
        };

        // 1. Description
        let description = "";
        const descEl = doc.querySelector('.m-synopsis');
        if (descEl) {
            description = descEl.textContent?.trim() || "";
        } else {
            const metaDesc = doc.querySelector('meta[property="og:description"]');
            if (metaDesc) {
                description = metaDesc.getAttribute('content') || "";
            }
        }

        // 2. Cover Image
        let coverImageUrl = "";
        const metaImg = doc.querySelector('meta[property="og:image"]');
        if (metaImg) {
            coverImageUrl = metaImg.getAttribute('content') || "";
        } else {
            const imgEl = doc.querySelector('.m-main-cover__img');
            if (imgEl) {
                coverImageUrl = imgEl.getAttribute('src') || "";
            }
        }

        // 3. Extracting Details using the specific definition list (DT/DD) layout Bookwalker uses
        const dts = doc.querySelectorAll('dt');
        dts.forEach(dt => {
            const header = dt.textContent?.trim();
            const dd = dt.nextElementSibling;
            
            if (!header || !dd || dd.tagName.toLowerCase() !== 'dd') return;

            if (header === "シリーズ") {
                const a = dd.querySelector('a');
                if (a && a.textContent) {
                    const text = a.textContent.trim().replace(/\(著者\)/g, '').trim();
                    extraData["Series Name"] = text;
                }
            }
            else if (header === "著者") {
                const authors = Array.from(dd.querySelectorAll('a'))
                                    .map(a => a.textContent?.trim().replace(/\(.*?\)/g, '').trim()) // Strip (著者) or (イラスト) markers
                                    .filter(Boolean);
                if (authors.length > 0) extraData["Author"] = [...new Set(authors)].join(", ");
            }
            else if (header === "出版社") {
                const a = dd.querySelector('a');
                if (a && a.textContent) extraData["Publisher"] = a.textContent.trim();
            }
            else if (header === "配信開始日") {
                // Bookwalker format: 2024/05/15 00:00
                const text = dd.textContent?.trim();
                if (text) {
                    const match = text.match(/(\d{4})\/(\d{1,2})/); // Keep Year/Month
                    if (match) {
                        extraData["Publication Date"] = `${match[1]}年${match[2]}月`;
                    } else {
                        extraData["Publication Date"] = text;
                    }
                }
            }
            else if (header === "ページ概数" || header === "ページ数") {
                const text = dd.textContent?.trim();
                const m = text?.match(/\d+/);
                if (m) {
                    extraData["Page Number"] = m[0];
                }
            }
        });

        // 4. Rating - Bookwalker usually places <span> with star classes, but it is often dynamic.
        // As requested, rating isn't strictly necessary from Bookwalker but is good if possible.
        // We will stick to the requested explicit targets.

        return {
            title: "", // Exclude title for manual handling
            description,
            coverImageUrl,
            extraData
        };
    }
}

import { MetadataImporter, ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

export class BookmeterImporter implements MetadataImporter {
    name = "Bookmeter";
    supportedContentTypes = ["Novel"];
    matchUrl(url: string, contentType: string): boolean {
        // We only allow Bookmeter urls for Novel
        return this.supportedContentTypes.includes(contentType) && url.includes("bookmeter.com/books/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const html = await fetchExternalJson(url, "GET");

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const extraData: Record<string, string> = {
            "Bookmeter Source": url
        };

        // 1. Title
        // The user specifically requested not to extract the title from Bookmeter.
        let title = "";

        // 2. Cover Image
        let coverImageUrl = "";
        const metaCover = doc.querySelector('meta[property="og:image"]');
        if (metaCover) {
            coverImageUrl = metaCover.getAttribute('content') || "";
        }

        // 3. Description
        let description = "";
        const metaDesc = doc.querySelector('meta[property="og:description"]');
        if (metaDesc) {
            description = metaDesc.getAttribute('content') || "";
            // Bookmeter description often has a boilerplate prefix:
            // e.g. "支倉 凍砂『狼と香辛料IX対立の町(下)』の感想・レビュー一覧です。電子書籍版の無料試し読みあり。ネタバレを含む感想・レビューは、ネタバレフィルターがあるので安心。伝説の海獣イッカク..."
            // We want to strip everything up to "があるので安心。"
            const prefixRegex = /^.*?があるので安心。/;
            if (prefixRegex.test(description)) {
                description = description.replace(prefixRegex, '').trim();
            }
        }

        // 4. Page Count
        const dtTags = doc.querySelectorAll('dt.bm-details-side__title');
        for (const dt of Array.from(dtTags)) {
            if (dt.textContent?.trim() === "ページ数") {
                const dd = dt.nextElementSibling;
                if (dd && dd.tagName.toLowerCase() === 'dd') {
                    const pageText = dd.textContent?.trim() || "";
                    // Extract just the numbers
                    const match = pageText.match(/(\d+)/);
                    if (match) {
                        extraData["Page Count"] = match[1];
                    }
                }
                break;
            }
        }

        // 5. Publisher
        const pubEl = doc.querySelector('.current-book-detail__publisher');
        if (pubEl) {
            let pubText = pubEl.textContent?.trim() || "";
            // Prefix is usually "出版社："
            const pubMatch = pubText.match(/出版社：(.+)/);
            if (pubMatch) {
                extraData["Publisher"] = pubMatch[1].trim();
            } else {
                extraData["Publisher"] = pubText;
            }
        }

        // 6. Author
        const authorMatch = html.match(/class="header__authors">.*?href="\/search\?author=[^"]+">([^<]+)<\/a>/is);
        if (authorMatch) {
            extraData["Author"] = authorMatch[1].trim();
        }

        return {
            title,
            description,
            coverImageUrl,
            extraData
        };
    }
}

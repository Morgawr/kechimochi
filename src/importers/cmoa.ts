import { MetadataImporter, ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

export class CmoaImporter implements MetadataImporter {
    name = "Cmoa";
    supportedContentTypes = ["Reading", "Manga"];
    matchUrl(url: string, contentType: string): boolean {
        // We only allow Cmoa urls. They can be for Reading/Manga
        return this.supportedContentTypes.includes(contentType) && url.includes("cmoa.jp/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const html = await fetchExternalJson(url, "GET");

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const extraData: Record<string, string> = {
            "Cmoa Source": url
        };

        // 1. Description
        let description = "";
        const descEl = doc.querySelector('.title_detail_text');
        if (descEl) {
            description = descEl.textContent?.trim() || "";
        } else {
            const metaDesc = doc.querySelector('meta[property="og:description"]');
            if (metaDesc) {
                description = metaDesc.getAttribute('content') || "";
            }
        }

        // Clean up description HTML and Cmoa adverts
        description = description.replace(/<br\s*\/?>/gi, '\n');
        
        // Handle common Cmoa boilerplate prefixes:
        // 1. "コミックシーモアなら無料で試し読み！[Title] [Vol]｜"
        // 2. "コミックシーモアなら期間限定[X]巻無料！[Title] [Vol] [｜]"
        const prefixRegex = /^コミックシーモアなら(?:無料で試し読み|期間限定\d+巻無料)！.*?[｜巻][\s｜]*/;
        if (prefixRegex.test(description)) {
            description = description.replace(prefixRegex, '').trim();
        }

        // 2. Cover Image
        let coverImageUrl = "";
        const imgEl = doc.querySelector('.title_detail_img img');
        if (imgEl) {
            coverImageUrl = imgEl.getAttribute('src') || "";
        } else {
            const metaImg = doc.querySelector('meta[property="og:image"]');
            if (metaImg) {
                coverImageUrl = metaImg.getAttribute('content') || "";
            }
        }
        
        if (coverImageUrl && coverImageUrl.startsWith("//")) {
            coverImageUrl = "https:" + coverImageUrl;
        }

        // 3. Category Lines (Genres, Tags, Publisher, Publication Date, ISBN)
        const categoryLines = doc.querySelectorAll('.category_line');
        categoryLines.forEach(line => {
            const headerEl = line.querySelector('.category_line_f_l_l');
            const dataEl = line.querySelector('.category_line_f_r_l');
            
            if (!headerEl || !dataEl) return;
            
            const header = headerEl.textContent?.trim();
            
            if (header === "ジャンル") { // Genre
                const links = Array.from(dataEl.querySelectorAll('a'))
                                .map(a => a.textContent?.trim())
                                .filter(t => t && !t.includes("位)")); // Ignore "(12位)" strings usually appended
                if (links.length > 0) extraData["Genres"] = links.join(", ");
            } 
            else if (header === "作品タグ") { // Tags
                const links = Array.from(dataEl.querySelectorAll('a'))
                                .map(a => a.textContent?.trim())
                                .filter(Boolean);
                if (links.length > 0) extraData["Tags"] = links.join(", ");
            }
            else if (header === "出版社") { // Publisher
                const a = dataEl.querySelector('a');
                if (a && a.textContent) extraData["Publisher"] = a.textContent.trim();
            }
            else if (header === "出版年月") { // Publication date
                const text = dataEl.textContent?.replace('：', '').trim();
                if (text) extraData["Publication Date"] = text;
            }
            else if (header === "配信開始日" && !extraData["Publication Date"]) {
                const text = dataEl.textContent?.replace('：', '').trim();
                if (text) {
                    const match = text.match(/(\d{4})年(\d{1,2})月/);
                    if (match) {
                        extraData["Publication Date"] = `${match[1]}年${match[2]}月`;
                    } else {
                        extraData["Publication Date"] = text;
                    }
                }
            }
            else if (header === "ISBN") { // ISBN
                const pre = dataEl.querySelector('pre');
                if (pre && pre.textContent) extraData["ISBN"] = pre.textContent.trim();
            }
        });

        // 4. Rating (from JSON-LD script or meta)
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            if (script.textContent && script.textContent.includes("AggregateRating")) {
                try {
                    const json = JSON.parse(script.textContent);
                    const rating = json.aggregateRating || json.AggregateRating;
                    if (rating && rating.ratingValue) {
                        extraData["Rating"] = `${rating.ratingValue} Stars`;
                        break;
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }
        }

        // 5. Authors
        const authorLinks = doc.querySelectorAll('.title_detail_item_name_author, .title_details_author_name a');
        const authors = Array.from(authorLinks)
                            .map(a => a.textContent?.trim())
                            .filter(Boolean);
        if (authors.length > 0) {
            // Deduplicate authors if they appear multiple times for logic reasons
            extraData["Author"] = Array.from(new Set(authors)).join(", ");
        }

        return {
            title: "", // Exclude title to allow manual handling
            description,
            coverImageUrl,
            extraData
        };
    }
}

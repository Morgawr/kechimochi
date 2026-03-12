import { ScrapedMetadata, MetadataImporter } from './index';
import { invoke } from '@tauri-apps/api/core';

export class BackloggdImporter implements MetadataImporter {
    name = "Backloggd";
    supportedContentTypes = ["Videogame"];
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;
        try {
            const u = new URL(url);
            return u.hostname === "backloggd.com" && u.pathname.startsWith("/games/");
        } catch {
            return false;
        }
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const html = await invoke<string>('fetch_external_json', {
            url,
            method: "GET"
        });

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Description from Meta Tags
        let description = "";
        const metaDesc = doc.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        if (metaDesc) {
            description = metaDesc.content || "";
        }

        // 2. Cover Image
        let coverImageUrl = "";
        const metaImg = doc.querySelector<HTMLMetaElement>('meta[property="og:image"]');
        const coverImg = doc.querySelector<HTMLElement>('.card-img');
        
        if (metaImg) {
            coverImageUrl = metaImg.content || "";
        } else if (coverImg) {
            coverImageUrl = coverImg.dataset.src || coverImg.getAttribute('src') || "";
        }

        if (coverImageUrl) {
            // Handle protocol-relative URLs (//example.com/image.jpg)
            if (coverImageUrl.startsWith('//')) {
                coverImageUrl = 'https:' + coverImageUrl;
            }
            
            // Ensure high-res version if applicable (IGDB covers)
            if (coverImageUrl.includes('t_cover_big')) {
                coverImageUrl = coverImageUrl.replaceAll('t_cover_big', 't_cover_big_2x');
            }
        }

        const extraData: Record<string, string> = {
            "Source URL": url
        };

        // 3. Game Details (Released, Genres, Platforms)
        // Backloggd uses detail rows
        const detailRows = doc.querySelectorAll('.row.mt-2');
        detailRows.forEach(row => {
            const header = row.querySelector('.game-details-header')?.textContent?.trim();
            if (!header) return;

            if (header === "Released") {
                const val = row.querySelector('.game-details-value')?.textContent?.trim();
                if (val) extraData["Release Date"] = val;
            } else if (header === "Genres") {
                const genres = Array.from(row.querySelectorAll('.game-details-value'))
                    .map(el => el.textContent?.trim())
                    .filter(Boolean);
                if (genres.length > 0) extraData["Genres"] = genres.join(", ");
            } else if (header === "Platforms") {
                const platforms = Array.from(row.querySelectorAll('.game-details-value'))
                    .map(el => el.textContent?.trim())
                    .filter(Boolean);
                if (platforms.length > 0) extraData["Platforms"] = platforms.join(", ");
            }
        });

        // 4. Developer & Publisher (Heuristic from subtitle)
        // Example: "by Feelplus, Microsoft Game Studios"
        const companies = Array.from(doc.querySelectorAll('.game-subtitle a, .sub-title a'))
            .filter(el => el.getAttribute('href')?.startsWith('/company/'))
            .map(el => el.textContent?.trim())
            .filter(Boolean);

        if (companies.length > 0) {
            // Usually the first one is the main developer
            extraData["Developer"] = companies[0] || "Unknown";
            if (companies.length > 1) {
                extraData["Publisher"] = companies.slice(1).join(", ");
            } else {
                extraData["Publisher"] = companies[0] || "Unknown"; // Fallback if only one is listed
            }
        }

        return {
            title: "", // We do not import title
            description,
            coverImageUrl,
            extraData
        };
    }
}

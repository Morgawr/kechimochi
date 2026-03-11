import { ScrapedMetadata, MetadataImporter } from './index';
import { fetchExternalJson } from '../platform';

export class ImdbImporter implements MetadataImporter {
    name = "IMDB";
    supportedContentTypes = ["Anime", "Movie", "Live Action", "Drama"];
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;

        try {
            const u = new URL(url);
            return (u.hostname === "www.imdb.com" || u.hostname === "imdb.com") && u.pathname.startsWith("/title/");
        } catch {
            return false;
        }
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const html = await fetchExternalJson(url, "GET", undefined, {
            "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Accept-Language": "en-US,en;q=0.5",
        });

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let metadata: Partial<ScrapedMetadata> = {};
        let extraData: Record<string, string> = { "Source URL": url };

        // --- Strat 1: JSON-LD (Search all blocks) ---
        const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        let movieData: any = null;
        
        for (const script of Array.from(jsonLdScripts)) {
            try {
                const content = JSON.parse(script.textContent || "{}");
                if (content["@type"] === "Movie" || (Array.isArray(content["@type"]) && content["@type"].includes("Movie"))) {
                    movieData = content;
                    break;
                }
            } catch (e) { /* skip malformed */ }
        }

        if (movieData) {
            metadata.description = movieData.description;
            metadata.coverImageUrl = movieData.image;
            
            if (movieData.director) {
                const directors = Array.isArray(movieData.director) ? movieData.director : [movieData.director];
                extraData["Director"] = directors.map((d: any) => d.name).filter(Boolean).join(", ");
            }
            if (movieData.genre) {
                const genres = Array.isArray(movieData.genre) ? movieData.genre : [movieData.genre];
                extraData["Genres"] = genres.join(", ");
            }
            if (movieData.duration) {
                extraData["Total Runtime"] = this.parseISO8601Duration(movieData.duration);
            }
            if (movieData.datePublished) {
                const yearMatch = movieData.datePublished.match(/^\d{4}/);
                if (yearMatch) extraData["Release Year"] = yearMatch[0];
            }
            if (movieData.aggregateRating?.ratingValue) {
                extraData["IMDb Rating"] = movieData.aggregateRating.ratingValue.toString();
            }
        }

        // --- Strat 2: Fallback CSS Selectors (Fill gaps) ---
        if (!metadata.description) {
            metadata.description = doc.querySelector('span[data-testid="plot-xl"], span[data-testid="plot-l"]')?.textContent?.trim() || "";
        }
        if (!metadata.coverImageUrl) {
            metadata.coverImageUrl = doc.querySelector('section[data-testid="hero-parent"] .ipc-poster img.ipc-image')?.getAttribute('src') || "";
        }
        if (!extraData["Director"]) {
            const dirLabel = Array.from(doc.querySelectorAll('li[data-testid="title-pc-principal-credit"]'))
                .find(li => li.querySelector('button, span')?.textContent?.includes("Director"));
            if (dirLabel) {
                extraData["Director"] = Array.from(dirLabel.querySelectorAll('a.ipc-metadata-list-item__list-content-item'))
                    .map(a => a.textContent?.trim())
                    .filter(Boolean)
                    .join(", ");
            }
        }
        if (!extraData["Genres"]) {
            const genres = Array.from(doc.querySelectorAll('div[data-testid="genres"] a.ipc-chip'))
                .map(a => a.textContent?.trim())
                .filter(Boolean);
            if (genres.length > 0) extraData["Genres"] = genres.join(", ");
        }
        if (!extraData["Total Runtime"]) {
            const runtime = Array.from(doc.querySelectorAll('ul[data-testid="hero-title-block__metadata"] li.ipc-inline-list__item'))
                .find(li => li.textContent?.includes("h") || li.textContent?.includes("m"))
                ?.textContent?.trim();
            if (runtime) extraData["Total Runtime"] = runtime;
        }
        if (!extraData["Release Year"]) {
            const year = doc.querySelector('ul[data-testid="hero-title-block__metadata"] a[href*="releaseinfo"]')?.textContent?.trim();
            if (year) extraData["Release Year"] = year;
        }
        if (!extraData["IMDb Rating"]) {
            const rating = doc.querySelector('div[data-testid="hero-rating-bar__aggregate-rating__score"] span')?.textContent?.trim();
            if (rating) extraData["IMDb Rating"] = rating;
        }

        if (!metadata.description && !metadata.coverImageUrl && Object.keys(extraData).length <= 1) {
            // Check if we hit a CAPTCHA or blocking page
            const title = doc.title.toLowerCase();
            if (title.includes("captcha") || title.includes("access denied") || title.includes("bot check")) {
                throw new Error("IMDb blocked the request. Please try again later or check your network.");
            }
            throw new Error("Could not extract any data from the IMDb page. The layout might have changed or the URL is invalid.");
        }

        return {
            title: "",
            description: metadata.description || "",
            coverImageUrl: metadata.coverImageUrl || "",
            extraData
        };
    }

    private parseISO8601Duration(duration: string): string {
        // Simple parser for PT2H23M format
        const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
        const matches = duration.match(regex);
        if (!matches) return duration;

        const hours = matches[1];
        const minutes = matches[2];
        const seconds = matches[3];

        const parts = [];
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        if (seconds && !hours && !minutes) parts.push(`${seconds}s`);

        return parts.join(" ") || "0m";
    }
}

import { BaseImporter } from './base';
import { ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

const IMDB_GRAPHQL_ENDPOINT = "https://caching.graphql.imdb.com/";
const IMDB_TITLE_QUERY = `
query TitleMetadata($id: ID!) {
    title(id: $id) {
        id
        plot {
            plotText {
                plainText
            }
        }
        primaryImage {
            url
        }
        releaseYear {
            year
        }
        runtime {
            seconds
        }
        genres {
            genres {
                text
            }
        }
        ratingsSummary {
            aggregateRating
        }
        principalCredits {
            category {
                text
            }
            credits {
                name {
                    nameText {
                        text
                    }
                }
            }
        }
    }
}`;

type ImdbGraphQlResponse = {
    data?: {
        title?: ImdbGraphQlTitle | null;
    };
};

type ImdbGraphQlTitle = {
    plot?: {
        plotText?: {
            plainText?: string;
        };
    };
    primaryImage?: {
        url?: string;
    };
    releaseYear?: {
        year?: number | string;
    };
    runtime?: {
        seconds?: number;
    };
    genres?: {
        genres?: Array<{
            text?: string;
        }>;
    };
    ratingsSummary?: {
        aggregateRating?: number | string | null;
    };
    principalCredits?: ImdbGraphQlCredit[];
};

type ImdbGraphQlCredit = {
    category?: {
        text?: string;
    };
    credits?: Array<{
        name?: {
            nameText?: {
                text?: string;
            };
        };
    }>;
};

export class ImdbImporter extends BaseImporter {
    name = "IMDB";
    supportedContentTypes = ["Anime", "Movie", "Live Action", "Drama"];
    matchUrl(url: string, _contentType?: string): boolean {
        try {
            const u = new URL(url);
            return (u.hostname === "www.imdb.com" || u.hostname === "imdb.com") && u.pathname.startsWith("/title/");
        } catch {
            return false;
        }
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const metadata: Partial<ScrapedMetadata> = {};
        const extraData = this.createExtraData(url);
        let doc: Document | null = null;
        let titlePageError: unknown = null;

        try {
            doc = await this.fetchHtml(url, {
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept-Language": "en-US,en;q=0.5",
            });

            this.extractFromJsonLd(doc, metadata, extraData);
            this.extractFromDom(doc, metadata, extraData);
        } catch (error) {
            titlePageError = error;
        }

        if (this.needsGraphQlFallback(metadata, extraData)) {
            try {
                await this.extractFromGraphQl(url, metadata, extraData);
            } catch { /* keep any data extracted from the title page */ }
        }

        if (!metadata.description && !metadata.coverImageUrl && Object.keys(extraData).length <= 1) {
            if (doc) this.handleExtractionFailure(doc);
            if (titlePageError instanceof Error) throw titlePageError;
            throw new Error("Could not extract any data from the IMDb page. The layout might have changed or the URL is invalid.");
        }

        return {
            title: "",
            description: this.sanitizeDescription(metadata.description || ""),
            coverImageUrl: metadata.coverImageUrl || "",
            extraData
        };
    }

    private needsGraphQlFallback(metadata: Partial<ScrapedMetadata>, extraData: Record<string, string>): boolean {
        return !metadata.description || !metadata.coverImageUrl || Object.keys(extraData).length <= 1;
    }

    private async extractFromGraphQl(url: string, metadata: Partial<ScrapedMetadata>, extraData: Record<string, string>) {
        const titleId = this.extractTitleId(url);
        if (!titleId) return;

        const responseText = await fetchExternalJson(
            IMDB_GRAPHQL_ENDPOINT,
            "POST",
            JSON.stringify({
                query: IMDB_TITLE_QUERY,
                variables: { id: titleId }
            }),
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        );
        const response = JSON.parse(responseText) as ImdbGraphQlResponse;
        const title = response.data?.title;
        if (!title) return;

        if (!metadata.description) {
            metadata.description = title.plot?.plotText?.plainText || "";
        }
        if (!metadata.coverImageUrl) {
            metadata.coverImageUrl = title.primaryImage?.url || "";
        }
        this.parseGraphQlFields(title, extraData);
    }

    private extractTitleId(url: string): string | null {
        try {
            const path = new URL(url).pathname;
            return /\/title\/(tt\d+)/.exec(path)?.[1] || null;
        } catch {
            return null;
        }
    }

    private extractFromJsonLd(doc: Document, metadata: Partial<ScrapedMetadata>, extraData: Record<string, string>) {
        const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        let movieData: Record<string, unknown> | null = null;
        
        for (const script of Array.from(jsonLdScripts)) {
            try {
                const content = JSON.parse(script.textContent || "{}");
                if (content["@type"] === "Movie" || (Array.isArray(content["@type"]) && content["@type"].includes("Movie"))) {
                    movieData = content;
                    break;
                }
            } catch { /* skip malformed */ }
        }

        if (movieData) {
            metadata.description = movieData.description as string;
            metadata.coverImageUrl = movieData.image as string;
            this.parseJsonLdFields(movieData, extraData);
        }
    }

    private parseJsonLdFields(movieData: Record<string, unknown>, extraData: Record<string, string>) {
        if (movieData.director) {
            const directors = Array.isArray(movieData.director) ? movieData.director : [movieData.director];
            extraData["Director"] = directors.map((d: Record<string, unknown>) => d.name).filter(Boolean).join(", ");
        }
        if (movieData.genre) {
            const genres = Array.isArray(movieData.genre) ? movieData.genre : [movieData.genre];
            extraData["Genres"] = genres.map(g => (typeof g === 'string' || typeof g === 'number') ? String(g) : JSON.stringify(g)).join(", ");
        }
        if (movieData.duration) {
            extraData["Total Runtime"] = this.parseISO8601Duration(movieData.duration as string);
        }
        if (movieData.datePublished) {
            const yearMatch = /^\d{4}/.exec(movieData.datePublished as string);
            if (yearMatch) extraData["Release Year"] = yearMatch[0];
        }
        const rating = (movieData.aggregateRating as Record<string, unknown>)?.ratingValue;
        if (typeof rating === "string" || typeof rating === "number") {
            extraData["IMDb Rating"] = String(rating);
        } else if (rating !== undefined && rating !== null) {
            extraData["IMDb Rating"] = JSON.stringify(rating);
        }
    }

    private parseGraphQlFields(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        this.extractGraphQlDirector(title, extraData);
        this.extractGraphQlGenres(title, extraData);
        this.extractGraphQlRuntime(title, extraData);
        this.extractGraphQlReleaseYear(title, extraData);
        this.extractGraphQlRating(title, extraData);
    }

    private extractGraphQlDirector(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        if (!extraData["Director"]) {
            const directorCredit = title.principalCredits?.find(credit =>
                credit.category?.text?.toLowerCase().startsWith("director")
            );
            const directors = (directorCredit?.credits || [])
                .map(credit => credit.name?.nameText?.text?.trim())
                .filter((name): name is string => Boolean(name));
            if (directors.length > 0) extraData["Director"] = directors.join(", ");
        }
    }

    private extractGraphQlGenres(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        if (!extraData["Genres"]) {
            const genres = (title.genres?.genres || [])
                .map(genre => genre.text?.trim())
                .filter((genre): genre is string => Boolean(genre));
            if (genres.length > 0) extraData["Genres"] = genres.join(", ");
        }
    }

    private extractGraphQlRuntime(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        if (!extraData["Total Runtime"]) {
            const seconds = title.runtime?.seconds;
            if (typeof seconds === "number" && Number.isFinite(seconds)) {
                extraData["Total Runtime"] = this.formatRuntimeFromSeconds(seconds);
            }
        }
    }

    private extractGraphQlReleaseYear(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        if (!extraData["Release Year"]) {
            const year = title.releaseYear?.year;
            if (typeof year === "string" || typeof year === "number") extraData["Release Year"] = String(year);
        }
    }

    private extractGraphQlRating(title: ImdbGraphQlTitle, extraData: Record<string, string>) {
        if (!extraData["IMDb Rating"]) {
            const rating = title.ratingsSummary?.aggregateRating;
            if (typeof rating === "string" || typeof rating === "number") extraData["IMDb Rating"] = String(rating);
        }
    }

    private extractFromDom(doc: Document, metadata: Partial<ScrapedMetadata>, extraData: Record<string, string>) {
        if (!metadata.description) {
            metadata.description = doc.querySelector('span[data-testid="plot-xl"], span[data-testid="plot-l"]')?.textContent?.trim() || "";
        }
        if (!metadata.coverImageUrl) {
            metadata.coverImageUrl = doc.querySelector<HTMLImageElement>('section[data-testid="hero-parent"] .ipc-poster img.ipc-image')?.src || "";
        }
        this.extractDomFields(doc, extraData);
    }

    private extractDomFields(doc: Document, extraData: Record<string, string>) {
        if (!extraData["Director"]) {
            const dirLabel = Array.from(doc.querySelectorAll('li[data-testid="title-pc-principal-credit"]'))
                .find(li => li.querySelector('button, span')?.textContent?.includes("Director"));
            if (dirLabel) {
                extraData["Director"] = Array.from(dirLabel.querySelectorAll('a.ipc-metadata-list-item__list-content-item'))
                    .map(a => a.textContent?.trim()).filter(Boolean).join(", ");
            }
        }
        if (!extraData["Genres"]) {
            const genres = Array.from(doc.querySelectorAll('div[data-testid="genres"] a.ipc-chip'))
                .map(a => a.textContent?.trim()).filter(Boolean);
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
    }

    private handleExtractionFailure(doc: Document) {
        const title = doc.title.toLowerCase();
        const bodyText = doc.body.textContent?.toLowerCase() || "";
        if (
            title.includes("captcha") ||
            title.includes("access denied") ||
            title.includes("bot check") ||
            bodyText.includes("verify that you're not a robot") ||
            bodyText.includes("javascript is disabled")
        ) {
            throw new Error("IMDb blocked the request. Please try again later or check your network.");
        }
        throw new Error("Could not extract any data from the IMDb page. The layout might have changed or the URL is invalid.");
    }


    private parseISO8601Duration(duration: string): string {
        // Simple parser for PT2H23M format
        const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
        const matches = regex.exec(duration);
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

    private formatRuntimeFromSeconds(totalSeconds: number): string {
        const totalMinutes = Math.round(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];

        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);

        return parts.join(" ") || "0m";
    }
}

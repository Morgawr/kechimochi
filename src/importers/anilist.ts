import { BaseImporter } from './base';
import type { ScrapedMetadata } from './types';
import { fetchExternalJson } from '../platform';

interface AnilistMedia {
    title?: { romaji?: string; english?: string };
    description?: string;
    coverImage?: { extraLarge?: string; large?: string };
    episodes?: number;
    volumes?: number;
    chapters?: number;
    season?: string;
    seasonYear?: number;
    startDate?: { year: number; month?: number; day?: number };
    endDate?: { year: number; month?: number; day?: number };
    averageScore?: number;
    source?: string;
    genres?: string[];
}

type AnilistMediaType = "ANIME" | "MANGA";

export class AnilistImporter extends BaseImporter {
    name = "Anilist";
    supportedContentTypes = ["Anime", "Manga"];
    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("anilist.co/anime/") || url.includes("anilist.co/manga/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const urlRegex = /\/(anime|manga)\/(\d+)/;
        const match = urlRegex.exec(url);
        if (!match?.[1] || !match?.[2]) throw new Error("Could not extract Anilist Media ID from URL.");
        
        const mediaType = match[1] === "manga" ? "MANGA" : "ANIME";
        const mediaId = Number.parseInt(match[2], 10);
        const media = await this.fetchAnilistMedia(mediaId, mediaType);
        if (!media) throw new Error("Could not find media data in Anilist response.");

        const contentType = mediaType === "MANGA" ? "Manga" : "Anime";
        const title = media.title?.english || media.title?.romaji || `Unknown ${contentType}`;
        const extraData = this.mapExtraData(media, url, mediaType);

        return {
            title: title,
            description: this.sanitizeDescription(media.description || ""),
            coverImageUrl: media.coverImage?.extraLarge || media.coverImage?.large || "",
            extraData,
            contentType
        };
    }

    private async fetchAnilistMedia(id: number, mediaType: AnilistMediaType): Promise<AnilistMedia | null> {
        const query = `
        query ($id: Int, $type: MediaType) {
          Media (id: $id, type: $type) {
            title { romaji english }
            description(asHtml: false)
            coverImage { extraLarge large }
            episodes volumes chapters season seasonYear
            startDate { year month day }
            endDate { year month day }
            averageScore source genres
          }
        }`;

        const responseText: string = await fetchExternalJson(
            "https://graphql.anilist.co",
            "POST",
            JSON.stringify({ query, variables: { id, type: mediaType } }),
            { "Content-Type": "application/json", "Accept": "application/json" },
        );

        const json = JSON.parse(responseText) as { data?: { Media?: AnilistMedia }, errors?: { message: string }[] };
        if (json.errors) throw new Error("Anilist API returned an error: " + json.errors[0]?.message);
        return json.data?.Media || null;
    }

    private mapExtraData(m: AnilistMedia, url: string, mediaType: AnilistMediaType): Record<string, string> {
        const extras = this.createExtraData(url);

        if (mediaType === "MANGA") {
            this.mapMangaExtraData(m, extras);
            return extras;
        }
        
        if (m.episodes) extras["Episodes"] = m.episodes.toString();
        
        if (m.season || m.seasonYear) {
            const seasonStr = m.season ? m.season.charAt(0).toUpperCase() + m.season.slice(1).toLowerCase() : "";
            extras["Airing Season"] = `${seasonStr} ${m.seasonYear ?? ""}`.trim();
        }
        
        if (m.startDate?.year) extras["Start Airing Date"] = this.formatDate(m.startDate);
        if (m.endDate?.year) extras["End Airing Date"] = this.formatDate(m.endDate);
        if (m.averageScore) extras["Anilist Score"] = `${m.averageScore}%`;
        
        if (m.source) {
            extras["Original Source"] = m.source.replaceAll('_', ' ')
                .replaceAll(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
        }

        if (m.genres && m.genres.length > 0) extras["Genres"] = m.genres.join(", ");

        return extras;
    }

    private mapMangaExtraData(m: AnilistMedia, extras: Record<string, string>): void {
        if (m.volumes && m.volumes > 0) extras["Total Volumes"] = m.volumes.toString();
        if (m.chapters && m.chapters > 0) extras["Total Chapters"] = m.chapters.toString();
        if (m.startDate?.year) extras["Publication Date"] = this.formatDate(m.startDate);
        if (m.averageScore) extras["Anilist Score"] = `${m.averageScore}%`;
        if (m.genres && m.genres.length > 0) extras["Genres"] = m.genres.join(", ");
    }

    private formatDate(date: { year: number, month?: number, day?: number }): string {
        const y = date.year;
        const m = (date.month || 1).toString().padStart(2, '0');
        const d = (date.day || 1).toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

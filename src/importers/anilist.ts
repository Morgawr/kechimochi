import { BaseImporter } from './base';
import { ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

interface AnilistMedia {
    title?: { romaji?: string; english?: string };
    description?: string;
    coverImage?: { extraLarge?: string; large?: string };
    episodes?: number;
    season?: string;
    seasonYear?: number;
    startDate?: { year: number; month?: number; day?: number };
    endDate?: { year: number; month?: number; day?: number };
    averageScore?: number;
    source?: string;
    genres?: string[];
}

export class AnilistImporter extends BaseImporter {
    name = "Anilist";
    supportedContentTypes = ["Anime"];
    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("anilist.co/anime/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const urlRegex = /\/anime\/(\d+)/;
        const match = urlRegex.exec(url);
        if (!match?.[1]) throw new Error("Could not extract Anilist Media ID from URL.");
        
        const mediaId = Number.parseInt(match[1], 10);
        const media = await this.fetchAnilistMedia(mediaId);
        if (!media) throw new Error("Could not find media data in Anilist response.");

        const title = media.title?.english || media.title?.romaji || "Unknown Anime";
        const extraData = this.mapExtraData(media, url);

        return {
            title: title,
            description: media.description || "",
            coverImageUrl: media.coverImage?.extraLarge || media.coverImage?.large || "",
            extraData
        };
    }

    private async fetchAnilistMedia(id: number): Promise<AnilistMedia | null> {
        const query = `
        query ($id: Int) {
          Media (id: $id, type: ANIME) {
            title { romaji english }
            description(asHtml: false)
            coverImage { extraLarge large }
            episodes season seasonYear
            startDate { year month day }
            endDate { year month day }
            averageScore source genres
          }
        }`;

        const responseText: string = await fetchExternalJson(
            "https://graphql.anilist.co",
            "POST",
            JSON.stringify({ query, variables: { id } }),
            { "Content-Type": "application/json", "Accept": "application/json" },
        );

        const json = JSON.parse(responseText) as { data?: { Media?: AnilistMedia }, errors?: { message: string }[] };
        if (json.errors) throw new Error("Anilist API returned an error: " + json.errors[0]?.message);
        return json.data?.Media || null;
    }

    private mapExtraData(m: AnilistMedia, url: string): Record<string, string> {
        const extras = this.createExtraData(url);
        
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

    private formatDate(date: { year: number, month?: number, day?: number }): string {
        const y = date.year;
        const m = (date.month || 1).toString().padStart(2, '0');
        const d = (date.day || 1).toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

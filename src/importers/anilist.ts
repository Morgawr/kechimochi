import { MetadataImporter, ScrapedMetadata } from './index';
import { invoke } from '@tauri-apps/api/core';

export class AnilistImporter implements MetadataImporter {
    name = "Anilist";
    supportedContentTypes = ["Anime"];
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;
        return url.includes("anilist.co/anime/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const match = url.match(/\/anime\/(\d+)/);
        if (!match?.[1]) throw new Error("Could not extract Anilist Media ID from URL.");
        
        const mediaId = parseInt(match[1], 10);
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

    private async fetchAnilistMedia(id: number) {
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

        const responseText: string = await invoke('fetch_external_json', {
            url: "https://graphql.anilist.co",
            method: "POST",
            body: JSON.stringify({ query, variables: { id } }),
            headers: { "Content-Type": "application/json", "Accept": "application/json" }
        });

        const json = JSON.parse(responseText);
        if (json.errors) throw new Error("Anilist API returned an error: " + json.errors[0]?.message);
        return json.data?.Media;
    }

    private mapExtraData(m: any, url: string): Record<string, string> {
        const extras: Record<string, string> = { "Anilist Source": url };
        
        if (m.episodes) extras["Episodes"] = m.episodes.toString();
        
        if (m.season || m.seasonYear) {
            const seasonStr = m.season ? m.season.charAt(0).toUpperCase() + m.season.substring(1).toLowerCase() : "";
            extras["Airing Season"] = `${seasonStr} ${m.seasonYear || ""}`.trim();
        }
        
        if (m.startDate?.year) extras["Start Airing Date"] = this.formatDate(m.startDate);
        if (m.endDate?.year) extras["End Airing Date"] = this.formatDate(m.endDate);
        if (m.averageScore) extras["Anilist Score"] = `${m.averageScore}%`;
        
        if (m.source) {
            extras["Original Source"] = m.source.replace(/_/g, ' ')
                .replace(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
        }

        if (m.genres?.length > 0) extras["Genres"] = m.genres.join(", ");

        return extras;
    }

    private formatDate(date: { year: number, month?: number, day?: number }): string {
        const y = date.year;
        const m = (date.month || 1).toString().padStart(2, '0');
        const d = (date.day || 1).toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

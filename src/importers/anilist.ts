import { MetadataImporter, ScrapedMetadata } from './index';
import { fetchExternalJson } from '../platform';

export class AnilistImporter implements MetadataImporter {
    name = "Anilist";
    supportedContentTypes = ["Anime"];
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;
        return url.includes("anilist.co/anime/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        // Extract the Anilist Media ID from the URL using a Regex
        const match = url.match(/\/anime\/(\d+)/);
        if (!match || !match[1]) {
            throw new Error("Could not extract Anilist Media ID from URL.");
        }
        
        const mediaId = parseInt(match[1], 10);

        const query = `
        query ($id: Int) {
          Media (id: $id, type: ANIME) {
            title { romaji english }
            description(asHtml: false)
            coverImage { extraLarge large }
            episodes
            season
            seasonYear
            startDate { year month day }
            endDate { year month day }
            averageScore
            source
            genres
          }
        }`;

        const variables = { id: mediaId };

        const requestBody = JSON.stringify({
            query: query,
            variables: variables
        });

        const responseText: string = await fetchExternalJson(
            "https://graphql.anilist.co",
            "POST",
            requestBody,
            { "Content-Type": "application/json", "Accept": "application/json" },
        );

        const json = JSON.parse(responseText);
        
        if (json.errors) {
            console.error("Anilist API returned errors:", json.errors);
            throw new Error("Anilist API returned an error: " + json.errors[0]?.message);
        }

        const m = json.data?.Media;
        if (!m) {
            throw new Error("Could not find media data in Anilist response.");
        }

        // 1. Title
        const title = m.title?.english || m.title?.romaji || "Unknown Anime";
        
        // 2. Description
        const cleanDesc = m.description || "";
        
        // 3. Cover Image
        const coverUrl = m.coverImage?.extraLarge || m.coverImage?.large || "";

        // 4. Extra Data Mapping
        const extras: Record<string, string> = {};
        
        extras["Anilist Source"] = url;
        
        if (m.episodes) {
            extras["Episodes"] = m.episodes.toString();
        }
        
        if (m.season || m.seasonYear) {
            let seasonStr = m.season ? m.season.charAt(0).toUpperCase() + m.season.substring(1).toLowerCase() : "";
            extras["Airing Season"] = `${seasonStr} ${m.seasonYear || ""}`.trim();
        }
        
        if (m.startDate && m.startDate.year) {
            extras["Start Airing Date"] = `${m.startDate.year}-${m.startDate.month?.toString().padStart(2, '0') || "01"}-${m.startDate.day?.toString().padStart(2, '0') || "01"}`;
        }

        if (m.endDate && m.endDate.year) {
            extras["End Airing Date"] = `${m.endDate.year}-${m.endDate.month?.toString().padStart(2, '0') || "01"}-${m.endDate.day?.toString().padStart(2, '0') || "01"}`;
        }

        if (m.averageScore) {
            extras["Anilist Score"] = `${m.averageScore}%`;
        }

        if (m.source) {
            extras["Original Source"] = m.source.replace(/_/g, ' ').replace(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
        }

        if (m.genres && m.genres.length > 0) {
            extras["Genres"] = m.genres.join(", ");
        }

        return {
            title: title,
            description: cleanDesc,
            coverImageUrl: coverUrl,
            extraData: extras
        };
    }
}

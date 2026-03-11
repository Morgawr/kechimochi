import { ScrapedMetadata, MetadataImporter } from './index';
import { fetchExternalJson } from '../platform';

export class VndbImporter implements MetadataImporter {
    name = "VNDB";
    supportedContentTypes = ["Visual Novel"];
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;
        try {
            const u = new URL(url);
            return u.hostname === "vndb.org" && u.pathname.startsWith("/v") && !isNaN(parseInt(u.pathname.substring(2)));
        } catch {
            return false;
        }
    }

    private removeBbcode(text: string): string {
        if (!text) return "";
        // Removes [url=...]text[/url] or [url]text[/url] but keeps 'text'
        let cleaned = text.replace(/\[url(?:=.*?)?\](.*?)\[\/url\]/gi, '$1');
        // Removes other markers like [b], [i], [spoiler], [code], etc.
        cleaned = cleaned.replace(/\[\/?(b|i|u|s|spoiler|size|color|quote|list|pre|code|raw|\*)\]/gi, '');
        return cleaned.trim();
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const u = new URL(url);
        const vnId = u.pathname.substring(1); // e.g. "v5850"

        // 1. Fetch VN details
        const vnPayload = {
            filters: ["id", "=", vnId],
            fields: "id, description, image.url, platforms"
        };
        
        const resStr1 = await fetchExternalJson(
            "https://api.vndb.org/kana/vn",
            "POST",
            JSON.stringify(vnPayload),
        );
        
        const vnData = JSON.parse(resStr1);
        if (!vnData.results || vnData.results.length === 0) {
            throw new Error("VN not found on VNDB.");
        }
        const vn = vnData.results[0];

        // 2. Fetch Release details to find earliest release
        const relPayload = {
            filters: ["vn", "=", ["id", "=", vnId]],
            fields: "id, title, released, producers.developer, producers.publisher, producers.name",
            sort: "released",
            reverse: false
        };

        const resStr2 = await fetchExternalJson(
            "https://api.vndb.org/kana/release",
            "POST",
            JSON.stringify(relPayload),
        );

        const relData = JSON.parse(resStr2);
        
        let developer = "Unknown";
        let publisher = "Unknown";
        let releaseDate = "Unknown";
        
        if (relData.results && relData.results.length > 0) {
            const firstRel = relData.results[0];
            if (firstRel.released && firstRel.released !== "tba") {
                releaseDate = firstRel.released;
            }
            if (firstRel.producers && firstRel.producers.length > 0) {
                const devs = firstRel.producers.filter((p: any) => p.developer).map((p: any) => p.name);
                if (devs.length > 0) developer = devs.join(", ");
                
                const pubs = firstRel.producers.filter((p: any) => p.publisher).map((p: any) => p.name);
                if (pubs.length > 0) publisher = pubs.join(", ");
            }
        }

        const extraData: Record<string, string> = {
            "Source URL": url,
            "Release Date": releaseDate,
            "Developer": developer,
            "Publisher": publisher
        };

        if (vn.platforms && vn.platforms.length > 0) {
            extraData["Platforms"] = vn.platforms.join(", ").toUpperCase();
        }

        return {
            title: "",
            description: this.removeBbcode(vn.description),
            coverImageUrl: vn.image?.url || "",
            extraData
        };
    }
}

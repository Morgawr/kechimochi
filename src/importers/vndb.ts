import { ScrapedMetadata, MetadataImporter } from './index';
import { invoke } from '@tauri-apps/api/core';

interface VndbVn {
    id: string;
    description: string;
    image?: { url: string };
    platforms?: string[];
}

interface VndbRelease {
    id: string;
    title: string;
    released?: string;
    producers?: Array<{ name: string, developer: boolean, publisher: boolean }>;
}

export class VndbImporter implements MetadataImporter {
    name = "VNDB";
    supportedContentTypes = ["Visual Novel"];
    
    matchUrl(url: string, contentType: string): boolean {
        if (!this.supportedContentTypes.includes(contentType)) return false;
        try {
            const u = new URL(url);
            return u.hostname === "vndb.org" && u.pathname.startsWith("/v") && !isNaN(parseInt(u.pathname.substring(2)));
        } catch { return false; }
    }

    private removeBbcode(text: string): string {
        if (!text) return "";
        let cleaned = text.replace(/\[url(?:=.*?)?\](.*?)\[\/url\]/gi, '$1');
        cleaned = cleaned.replace(/\[\/?(b|i|u|s|spoiler|size|color|quote|list|pre|code|raw|\*)\]/gi, '');
        return cleaned.trim();
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const u = new URL(url);
        const vnId = u.pathname.substring(1);

        const vn = await this.fetchVnDetails(vnId);
        const release = await this.fetchEarliestRelease(vnId);

        const extraData: Record<string, string> = {
            "Source URL": url,
            "Release Date": release.releaseDate,
            "Developer": release.developer,
            "Publisher": release.publisher
        };

        if (vn.platforms?.length) {
            extraData["Platforms"] = vn.platforms.join(", ").toUpperCase();
        }

        return {
            title: "",
            description: this.removeBbcode(vn.description),
            coverImageUrl: vn.image?.url || "",
            extraData
        };
    }

    private async fetchVnDetails(vnId: string): Promise<VndbVn> {
        const resStr = await invoke<string>('fetch_external_json', {
            url: "https://api.vndb.org/kana/vn",
            method: "POST",
            body: JSON.stringify({ filters: ["id", "=", vnId], fields: "id, description, image.url, platforms" })
        });
        const data = JSON.parse(resStr);
        if (!data.results?.[0]) throw new Error("VN not found on VNDB.");
        return data.results[0];
    }

    private async fetchEarliestRelease(vnId: string) {
        const resStr = await invoke<string>('fetch_external_json', {
            url: "https://api.vndb.org/kana/release",
            method: "POST",
            body: JSON.stringify({
                filters: ["vn", "=", ["id", "=", vnId]],
                fields: "id, title, released, producers.developer, producers.publisher, producers.name",
                sort: "released", reverse: false
            })
        });

        const data = JSON.parse(resStr);
        const firstRel: VndbRelease | undefined = data.results?.[0];

        let developer = "Unknown", publisher = "Unknown", releaseDate = "Unknown";

        if (firstRel) {
            if (firstRel.released && firstRel.released !== "tba") releaseDate = firstRel.released;
            if (firstRel.producers?.length) {
                developer = firstRel.producers.filter(p => p.developer).map(p => p.name).join(", ") || "Unknown";
                publisher = firstRel.producers.filter(p => p.publisher).map(p => p.name).join(", ") || "Unknown";
            }
        }

        return { developer, publisher, releaseDate };
    }
}

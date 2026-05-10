import { BaseImporter } from './base';
import type { ScrapedMetadata } from './types';

export class DmmImporter extends BaseImporter {
    name = "DMM Games";
    supportedContentTypes = ["Videogame"];
    
    matchUrl(url: string, _contentType?: string): boolean {
        try {
            const u = new URL(url);
            return (u.hostname === "dlsoft.dmm.com" || u.hostname === "dlsoft.dmm.co.jp") && u.pathname.startsWith("/detail/");
        } catch {
            return false;
        }
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const doc = await this.fetchHtml(url, { "Cookie": "age_check_done=1" });
        const extraData = this.createExtraData(url);

        const description = this.extractDescription(doc);
        this.extractTableData(doc, extraData);

        return {
            title: "", // We do not import title
            description,
            coverImageUrl: "", // Explicitly requested to not fetch images as cover
            extraData
        };
    }

    private extractDescription(doc: Document): string {
        const descEl = doc.querySelector('.read-text-area');
        if (descEl) {
            const readmore = descEl.querySelector('.readmore');
            if (readmore) {
                readmore.remove();
            }
            return this.sanitizeDescription(descEl.innerHTML);
        }
        
        const metaDesc = doc.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        if (metaDesc) {
            return this.sanitizeDescription(metaDesc.content);
        }
        
        return "";
    }

    private extractTableData(doc: Document, extraData: Record<string, string>) {
        const fieldMapping: Record<string, string> = {
            "シリーズ": "Series",
            "メーカー": "Developer",
            "ゲームジャンル": "Genre",
            "ボイス": "Voice acting",
            "ダウンロード版配信開始日": "Release date",
            "ダウンロード版対応OS": "Platform"
        };

        const rows = [
            ...Array.from(doc.querySelectorAll('.contentsDetailTop__tableRow')),
            ...Array.from(doc.querySelectorAll('.contentsDetailBottom__tableRow'))
        ];

        for (const row of rows) {
            const leftEl = row.querySelector('[class*="__tableDataLeft"]');
            const rightEl = row.querySelector('[class*="__tableDataRight"]');
            if (!leftEl || !rightEl) continue;
            
            const leftText = leftEl.textContent?.trim() || "";
            const value = rightEl.textContent?.replace(/\s+/g, ' ').trim() || "";
            
            if (leftText && value && fieldMapping[leftText]) {
                extraData[fieldMapping[leftText]] = value;
            }
        }
    }
}

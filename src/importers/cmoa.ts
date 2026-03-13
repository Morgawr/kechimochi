import { BaseImporter } from './base';
import { ScrapedMetadata } from './index';

export class CmoaImporter extends BaseImporter {
    name = "Cmoa";
    supportedContentTypes = ["Reading", "Manga"];
    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("cmoa.jp/");
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const doc = await this.fetchHtml(url);

        const extraData = this.createExtraData(url);
        const description = this.extractDescription(doc);
        const coverImageUrl = this.extractCoverImage(doc);
        
        this.extractCategories(doc, extraData);
        this.extractRating(doc, extraData);
        this.extractAuthors(doc, extraData);

        return { title: "", description, coverImageUrl, extraData };
    }

    private extractDescription(doc: Document): string {
        const descEl = doc.querySelector('.title_detail_text');
        let description = descEl?.textContent?.trim() || doc.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content || "";
        
        description = description.replaceAll(/<br\s*\/?>/gi, '\n');
        const prefixRegex = /^コミックシーモアなら(?:無料で試し読み|期間限定\d+巻無料)！.*?[｜巻][\s｜]*/g;
        return description.replaceAll(prefixRegex, '').trim();
    }

    private extractCoverImage(doc: Document): string {
        let url = doc.querySelector('.title_detail_img img')?.getAttribute('src') || doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content || "";
        if (url.startsWith("//")) url = "https:" + url;
        return url;
    }

    private extractCategories(doc: Document, extraData: Record<string, string>) {
        const categoryLines = doc.querySelectorAll('.category_line');
        categoryLines.forEach(line => {
            const header = line.querySelector('.category_line_f_l_l')?.textContent?.trim();
            const dataEl = line.querySelector('.category_line_f_r_l');
            if (header && dataEl) this.parseCategoryLine(header, dataEl, extraData);
        });
    }

    private parseCategoryLine(header: string, dataEl: Element, extraData: Record<string, string>) {
        switch (header) {
            case "ジャンル":
                this.parseGenres(dataEl, extraData);
                break;
            case "作品タグ":
                this.parseTags(dataEl, extraData);
                break;
            case "出版社":
                this.parsePublisher(dataEl, extraData);
                break;
            case "出版年月":
                this.parseYearMonth(dataEl, extraData);
                break;
            case "配信開始日":
                if (!extraData["Publication Date"]) this.parsePublicationDate(dataEl, extraData);
                break;
            case "ISBN":
                this.parseIsbn(dataEl, extraData);
                break;
        }
    }

    private parseGenres(dataEl: Element, extraData: Record<string, string>) {
        const links = Array.from(dataEl.querySelectorAll('a')).map(a => a.textContent?.trim()).filter(t => t && !t.includes("位)"));
        if (links.length > 0) extraData["Genres"] = links.join(", ");
    }

    private parseTags(dataEl: Element, extraData: Record<string, string>) {
        const links = Array.from(dataEl.querySelectorAll('a')).map(a => a.textContent?.trim()).filter(Boolean);
        if (links.length > 0) extraData["Tags"] = links.join(", ");
    }

    private parsePublisher(dataEl: Element, extraData: Record<string, string>) {
        const a = dataEl.querySelector('a');
        if (a?.textContent) extraData["Publisher"] = a.textContent.trim();
    }

    private parseYearMonth(dataEl: Element, extraData: Record<string, string>) {
        const text = dataEl.textContent?.replace('：', '').trim();
        if (text) extraData["Publication Date"] = text;
    }

    private parseIsbn(dataEl: Element, extraData: Record<string, string>) {
        const pre = dataEl.querySelector('pre');
        if (pre?.textContent) extraData["ISBN"] = pre.textContent.trim();
    }

    private parsePublicationDate(dataEl: Element, extraData: Record<string, string>) {
        const text = dataEl.textContent?.replace('：', '').trim();
        if (text) {
            const match = (/(\d{4})年(\d{1,2})月/).exec(text);
            extraData["Publication Date"] = match ? `${match[1]}年${match[2]}月` : text;
        }
    }

    private extractRating(doc: Document, extraData: Record<string, string>) {
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
        for (const script of Array.from(scripts)) {
            if (script.textContent?.includes("AggregateRating")) {
                try {
                    const json = JSON.parse(script.textContent);
                    const rating = json.aggregateRating || json.AggregateRating;
                    if (rating?.ratingValue) {
                        extraData["Rating"] = `${rating.ratingValue} Stars`;
                        break;
                    }
                } catch { /* skip */ }
            }
        }
    }

    private extractAuthors(doc: Document, extraData: Record<string, string>) {
        const authorLinks = doc.querySelectorAll('.title_detail_item_name_author, .title_details_author_name a');
        const authors = Array.from(authorLinks).map(a => a.textContent?.trim()).filter(Boolean);
        if (authors.length > 0) extraData["Author"] = Array.from(new Set(authors)).join(", ");
    }
}

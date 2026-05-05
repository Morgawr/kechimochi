import { BaseImporter } from './base';
import type { ScrapedMetadata } from './types';
import { Logger } from '../core/logger';

export class BookwalkerImporter extends BaseImporter {
    name = "Bookwalker";
    supportedContentTypes = ["Reading", "Manga"];
    matchUrl(url: string, _contentType?: string): boolean {
        return url.includes("bookwalker.jp/");
    }

    async fetch(url: string, targetVolume?: number): Promise<ScrapedMetadata> {
        let currentUrl = url;
        let doc = await this.fetchHtml(currentUrl);

        if (targetVolume !== undefined) {
            const routed = await this.routeToVolume(doc, currentUrl, targetVolume);
            if (routed) {
                currentUrl = routed.url;
                doc = routed.doc;
            }
        }

        const extraData = this.createExtraData(currentUrl);
        const description = this.extractDescription(doc);
        const coverImageUrl = this.extractCoverImage(doc);
        this.extractProperties(doc, extraData);

        return { title: "", description: this.sanitizeDescription(description), coverImageUrl, extraData };
    }

    private async routeToVolume(doc: Document, currentUrl: string, targetVolume: number): Promise<{ url: string, doc: Document } | null> {
        let seriesUrl = "";

        if (currentUrl.includes("/list/") && currentUrl.includes("/series/")) {
            seriesUrl = currentUrl;
        } else {
            const seriesLink = doc.querySelector<HTMLAnchorElement>('a[href*="/series/"][href$="/list/"]');
            if (seriesLink) seriesUrl = seriesLink.href || "";
        }

        if (!seriesUrl) {
            Logger.warn(`Could not find a Series List link. Using original URL.`);
            return null;
        }

        const seriesDoc = await this.fetchHtml(seriesUrl);
        const foundUrl = this.findVolumeUrl(seriesDoc, targetVolume);

        if (foundUrl) {
            let fullUrl = foundUrl;
            if (!fullUrl.startsWith("http")) fullUrl = "https://bookwalker.jp" + fullUrl;
            return { url: fullUrl, doc: await this.fetchHtml(fullUrl) };
        }

        Logger.warn(`Could not find Volume ${targetVolume} on series list. Using original URL.`);
        return null;
    }

    private findVolumeUrl(seriesDoc: Document, targetVolume: number): string | null {
        const volumeLinks = seriesDoc.querySelectorAll('.m-book-item__title a');
        for (const link of Array.from(volumeLinks)) {
            const titleText = link.textContent?.trim() || "";
            const normalizedTitleText = titleText.replaceAll(/[０-９]/g, s => String.fromCodePoint((s.codePointAt(0) ?? 0) - 0xFEE0));
            const r = new RegExp(`(?:[^0-9]|^)0*${targetVolume}(?:[^0-9]|$)`);
            if (r.test(normalizedTitleText)) return link.getAttribute('href');
        }
        return null;
    }

    private extractDescription(doc: Document): string {
        const descEl = doc.querySelector('.m-synopsis');
        if (descEl) return descEl.textContent?.trim() || "";
        const metaDesc = doc.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        return metaDesc?.content || "";
    }

    private extractCoverImage(doc: Document): string {
        const metaImg = doc.querySelector<HTMLMetaElement>('meta[property="og:image"]');
        if (metaImg) return metaImg.content || "";
        const imgEl = doc.querySelector('.m-main-cover__img');
        return imgEl?.getAttribute('src') || "";
    }

    private extractProperties(doc: Document, extraData: Record<string, string>) {
        const dts = doc.querySelectorAll('dt');
        dts.forEach(dt => {
            const header = dt.textContent?.trim();
            const dd = dt.nextElementSibling;
            if (header && dd?.tagName.toLowerCase() === 'dd') {
                this.parseDtDd(header, dd, extraData);
            }
        });
    }

    private parseDtDd(header: string, dd: Element, extraData: Record<string, string>) {
        if (header === "シリーズ") {
            const a = dd.querySelector('a');
            if (a?.textContent) extraData["Series Name"] = a.textContent.trim().replaceAll('(著者)', '').trim();
        } else if (header === "著者") {
            const authors = Array.from(dd.querySelectorAll('a'))
                .map(a => a.textContent?.trim().replaceAll(/\([^()]*\)/g, '').trim()).filter(Boolean);
            if (authors.length > 0) extraData["Author"] = [...new Set(authors)].join(", ");
        } else if (header === "出版社") {
            const a = dd.querySelector('a');
            if (a?.textContent) extraData["Publisher"] = a.textContent.trim();
        } else if (header === "配信開始日") {
            this.parsePublicationDate(dd, extraData);
        } else if (header === "ページ概数" || header === "ページ数") {
            const m = (/\d+/).exec(dd.textContent?.trim() || "");
            if (m) extraData["Page Number"] = m[0];
        }
    }

    private parsePublicationDate(dd: Element, extraData: Record<string, string>) {
        const text = dd.textContent?.trim();
        if (text) {
            const match = (/(\d{4})\/(\d{1,2})/).exec(text);
            extraData["Publication Date"] = match ? `${match[1]}年${match[2]}月` : text;
        }
    }
}

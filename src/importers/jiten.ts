import { BaseImporter } from './base';
import type { ScrapedMetadata, ScrapedMetadataFieldSources } from './types';
import { JITEN_BASE_URL, getJitenCoverUrl, getJitenMediaContentType } from '../jiten_api';
import { fetchExternalJson } from '../platform';

type JitenDeckDetail = {
    deckId: number;
    parentDeckId: number | null;
    originalTitle?: string;
    romajiTitle?: string;
    englishTitle?: string;
    description?: string | null;
    characterCount?: number | null;
    wordCount?: number | null;
    uniqueKanjiCount?: number | null;
    difficultyRaw?: number | null;
    mediaType: number;
    coverName?: string | null;
};

function hasText(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

const hasNumber = (value: number | null | undefined): value is number => value !== null && value !== undefined;
const hasDifficulty = (value: number | null | undefined): value is number => hasNumber(value) && value !== -1;

const NUMERIC_FIELDS = [
    ['Character count', 'characterCount', hasNumber, (value: number) => value.toLocaleString()],
    ['Word count', 'wordCount', hasNumber, (value: number) => value.toLocaleString()],
    ['Unique kanji', 'uniqueKanjiCount', hasNumber, (value: number) => value.toLocaleString()],
    ['Jiten difficulty', 'difficultyRaw', hasDifficulty, (value: number) => `${value.toFixed(2)}/5`],
] as const;

function pickValue<T>(childValue: T | null | undefined, seriesValue: T | null | undefined, isUsable: (value: T | null | undefined) => value is T) {
    if (isUsable(childValue)) return { value: childValue, fromEntireSeries: false };
    if (isUsable(seriesValue)) return { value: seriesValue, fromEntireSeries: true };
    return { value: undefined, fromEntireSeries: false };
}

async function loadDeckDetail(deckId: number): Promise<JitenDeckDetail | null> {
    const json = JSON.parse(await fetchExternalJson(`${JITEN_BASE_URL}/api/media-deck/${deckId}/detail`, 'GET'));
    return (json.data?.mainDeck as JitenDeckDetail | undefined) || null;
}

export class JitenImporter extends BaseImporter {
    name = "Jiten.moe";
    supportedContentTypes = ["Anime", "Manga", "Novel", "WebNovel", "NonFiction", "Drama", "Videogame", "Visual Novel", "Movie", "Audio"];

    matchUrl(url: string, _contentType?: string): boolean {
        try {
            const u = new URL(url);
            return (u.hostname === "jiten.moe" || u.hostname === "www.jiten.moe") && u.pathname.startsWith("/decks/");
        } catch {
            return false;
        }
    }

    async fetch(url: string): Promise<ScrapedMetadata> {
        const deckIdMatch = (/\/decks\/(\d+)/).exec(url);
        if (!deckIdMatch) {
            throw new Error("Invalid Jiten.moe URL. Could not find Deck ID.");
        }
        const deckId = Number.parseInt(deckIdMatch[1], 10);

        const childDeck = await loadDeckDetail(deckId);
        if (!childDeck) {
            throw new Error("Could not find media data in Jiten.moe response.");
        }

        const seriesDeck = childDeck.parentDeckId ? await loadDeckDetail(childDeck.parentDeckId) : null;
        const extraData = this.createExtraData(url);
        const fieldSources: ScrapedMetadataFieldSources = {};

        for (const [label, key, isUsable, format] of NUMERIC_FIELDS) {
            const picked = pickValue(childDeck[key], seriesDeck?.[key], isUsable);
            if (picked.value === undefined) continue;
            extraData[label] = format(picked.value);
            if (picked.fromEntireSeries) {
                fieldSources.extraData = { ...fieldSources.extraData, [label]: 'entireSeries' };
            }
        }

        const pickedDescription = pickValue(childDeck.description, seriesDeck?.description, hasText);
        const description = pickedDescription.value ? this.sanitizeDescription(pickedDescription.value) : "";
        if (pickedDescription.fromEntireSeries) {
            fieldSources.description = 'entireSeries';
        }

        const useSeriesCover = !!childDeck.parentDeckId;
        const coverImageUrl = getJitenCoverUrl(childDeck.deckId, useSeriesCover ? childDeck.parentDeckId : null);
        if (useSeriesCover) fieldSources.coverImageUrl = 'entireSeries';

        return {
            title: childDeck.originalTitle || childDeck.romajiTitle || childDeck.englishTitle || "",
            description,
            coverImageUrl,
            extraData,
            contentType: getJitenMediaContentType(childDeck.mediaType),
            fieldSources,
        };
    }
}

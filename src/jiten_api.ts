import { fetchExternalJson } from './platform';
import { Logger } from './core/logger';

export interface JitenResult {
    deckId: number;
    originalTitle: string;
    romajiTitle: string;
    englishTitle: string;
    mediaType: number;
    coverName: string | null;
    parentDeckId: number | null;
    childrenDeckCount: number;
}

export const JITEN_BASE_URL = 'https://api.jiten.moe';

const MEDIA_TYPE_MAP: Record<string, number> = {
    'Anime': 1,
    'Drama': 2,
    'Movie': 3,
    'Novel': 4,
    'NonFiction': 5,
    'Videogame': 6,
    'Visual Novel': 7,
    'WebNovel': 8,
    'Manga': 9,
    'Audio': 10
};

export function getJitenMediaLabel(type: number): string {
    switch (type) {
        case 1: return 'Anime';
        case 2: return 'Drama';
        case 3: return 'Movie';
        case 4: return 'Novel';
        case 5: return 'NonFiction';
        case 6: return 'Videogame';
        case 7: return 'VN';
        case 8: return 'WebNovel';
        case 9: return 'Manga';
        case 10: return 'Audio';
        default: return 'Media';
    }
}

export async function searchJiten(title: string, contentType: string): Promise<JitenResult[]> {
    const mediaType = MEDIA_TYPE_MAP[contentType] || 0;
    
    // 1. Try original search
    let results = await searchWithFallback(title, mediaType);
    if (results.length > 0) return results;

    // 2. Remove punctuation and symbols
    const noPunctTitle = title.replaceAll(/[!！?？.。,:：;；~～()（）[\]［］{}｛｝]/g, ' ').replaceAll(/\s+/g, ' ').trim();
    if (noPunctTitle && noPunctTitle !== title) {
        results = await searchWithFallback(noPunctTitle, mediaType);
        if (results.length > 0) return results;
    }

    // 3. Remove numbers
    const noNumTitle = (noPunctTitle || title).replaceAll(/[0-9１２３４５６７８９０]/g, '').trim();
    if (noNumTitle && noNumTitle !== title && noNumTitle !== noPunctTitle) {
        results = await searchWithFallback(noNumTitle, mediaType);
        if (results.length > 0) return results;
    }

    // 4. Word-by-word shortening
    return await searchShortened(title, mediaType);
}

async function searchWithFallback(query: string, mediaType: number): Promise<JitenResult[]> {
    let results = await performSearch(query, mediaType);
    if (results.length > 25) results = [];
    
    if (results.length === 0 && mediaType > 0) {
        results = await performSearch(query, 0);
        if (results.length > 25) results = [];
    }
    return results;
}

async function searchShortened(title: string, mediaType: number): Promise<JitenResult[]> {
    let currentTitle = title;
    for (let i = 0; i < 3; i++) {
        const lastSpace = Math.max(currentTitle.lastIndexOf(' '), currentTitle.lastIndexOf('　'));
        if (lastSpace === -1) break;
        
        currentTitle = currentTitle.substring(0, lastSpace).trim();
        if (!currentTitle) break;

        const results = await searchWithFallback(currentTitle, mediaType);
        if (results.length > 0) return results;
    }
    return [];
}

async function performSearch(query: string, mediaType: number): Promise<JitenResult[]> {
    const params = new URLSearchParams({ titleFilter: query, limit: '26' });
    if (mediaType > 0) params.append('mediaType', mediaType.toString());

    try {
        const jsonStr = await fetchExternalJson(
            `${JITEN_BASE_URL}/api/media-deck/get-media-decks?${params.toString()}`,
            'GET',
        );
        const data = JSON.parse(jsonStr);
        return (data?.data || []).map(mapToJitenResult);
    } catch (e) {
        Logger.error("Jiten API search failed", e);
        return [];
    }
}

interface JitenDeck {
    deckId: number;
    originalTitle: string;
    romajiTitle: string;
    englishTitle: string;
    mediaType: number;
    coverName: string | null;
    parentDeckId: number | null;
    childrenDeckCount?: number;
}

function mapToJitenResult(deck: JitenDeck): JitenResult {
    return {
        deckId: deck.deckId,
        originalTitle: deck.originalTitle,
        romajiTitle: deck.romajiTitle,
        englishTitle: deck.englishTitle,
        mediaType: deck.mediaType,
        coverName: deck.coverName,
        parentDeckId: deck.parentDeckId,
        childrenDeckCount: deck.childrenDeckCount || 0
    };
}

export async function getJitenDeckChildren(deckId: number): Promise<JitenResult[]> {
    try {
        const jsonStr = await fetchExternalJson(
            `${JITEN_BASE_URL}/api/media-deck/${deckId}/detail`,
            'GET',
        );
        const json = JSON.parse(jsonStr);
        return (json.data?.subDecks || []).map(mapToJitenResult);
    } catch (e) {
        Logger.error("Jiten API Deck Children fetch failed", e);
        return [];
    }
}

export function getJitenCoverUrl(deckId: number, parentDeckId: number | null): string {
    const id = parentDeckId || deckId;
    return `https://cdn.jiten.moe/${id}/cover.jpg`;
}

export function getJitenDeckUrl(deckId: number): string {
    return `https://jiten.moe/decks/${deckId}`;
}

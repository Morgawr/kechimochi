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
    'Videogame': 6,
    'Visual Novel': 7,
    'Manga': 9,
    'Podcast': 10
};

export async function searchJiten(title: string, contentType: string): Promise<JitenResult[]> {
    const mediaType = MEDIA_TYPE_MAP[contentType] || 0;
    
    const validateResults = (results: JitenResult[]) => {
        // If there are more than 6 results, it's likely a false positive.
        if (results.length > 6) return [];
        return results;
    };

    // 1. Try original search (with and without mediaType fallback)
    let results = await performSearch(title, mediaType);
    if (results.length > 0) {
        const validated = validateResults(results);
        if (validated.length > 0) return validated;
    }
    if (mediaType > 0) {
        results = await performSearch(title, 0);
        if (results.length > 0) {
            const validated = validateResults(results);
            if (validated.length > 0) return validated;
        }
    }

    // 2. Remove punctuation and symbols
    const noPunctuationTitle = title.replace(/[!！?？.。,:：;；~～()（）\[\]［］{}｛｝]/g, ' ').replace(/\s+/g, ' ').trim();
    if (noPunctuationTitle && noPunctuationTitle !== title) {
        results = await performSearch(noPunctuationTitle, mediaType);
        if (results.length === 0) results = await performSearch(noPunctuationTitle, 0);
        
        const validated = validateResults(results);
        if (validated.length > 0) return validated;
    }

    // 3. Remove numbers (standard and full-width) and retry
    const noNumbersTitle = (noPunctuationTitle || title).replace(/[0-9１２３４５６７８９０]/g, '').trim();
    if (noNumbersTitle && noNumbersTitle !== title && noNumbersTitle !== noPunctuationTitle) {
        results = await performSearch(noNumbersTitle, mediaType);
        if (results.length === 0) results = await performSearch(noNumbersTitle, 0);
        
        const validated = validateResults(results);
        if (validated.length > 0) return validated;
    }

    // 4. Remove words after whitespace sequentially (limit to 3 iterations)
    let currentTitle = title;
    let iterations = 0;
    while (iterations < 3) {
        const lastSpaceIndex = currentTitle.lastIndexOf(' ');
        const lastFullWidthSpaceIndex = currentTitle.lastIndexOf('　');
        const splitIndex = Math.max(lastSpaceIndex, lastFullWidthSpaceIndex);
        
        if (splitIndex === -1) break;
        
        currentTitle = currentTitle.substring(0, splitIndex).trim();
        if (!currentTitle) break;

        results = await performSearch(currentTitle, mediaType);
        if (results.length === 0) results = await performSearch(currentTitle, 0);
        
        const validated = validateResults(results);
        if (validated.length > 0) return validated;
        
        iterations++;
    }

    return [];
}

async function performSearch(query: string, mediaType: number): Promise<JitenResult[]> {
    const params = new URLSearchParams({
        titleFilter: query,
        limit: '7'
    });
    if (mediaType > 0) {
        params.append('mediaType', mediaType.toString());
    }

    try {
        const response = await fetch(`${JITEN_BASE_URL}/api/media-deck/get-media-decks?${params.toString()}`);
        if (!response.ok) return [];
        
        const data = await response.json();
        if (data && data.data && Array.isArray(data.data)) {
            return data.data.map((deck: any) => ({
                deckId: deck.deckId,
                originalTitle: deck.originalTitle,
                romajiTitle: deck.romajiTitle,
                englishTitle: deck.englishTitle,
                mediaType: deck.mediaType,
                coverName: deck.coverName,
                parentDeckId: deck.parentDeckId,
                childrenDeckCount: deck.childrenDeckCount || 0
            }));
        }
    } catch (e) {
        console.error("Jiten search failed", e);
    }
    return [];
}

export async function getJitenDeckChildren(deckId: number): Promise<JitenResult[]> {
    try {
        const response = await fetch(`${JITEN_BASE_URL}/api/media-deck/${deckId}/detail`);
        if (!response.ok) return [];
        
        const json = await response.json();
        const subDecks = json.data?.subDecks;
        if (subDecks && Array.isArray(subDecks)) {
            return subDecks.map((child: any) => ({
                deckId: child.deckId,
                originalTitle: child.originalTitle,
                romajiTitle: child.romajiTitle,
                englishTitle: child.englishTitle,
                mediaType: child.mediaType,
                coverName: child.coverName,
                parentDeckId: child.parentDeckId,
                childrenDeckCount: child.childrenDeckCount || 0
            }));
        }
    } catch (e) {
        console.error("Jiten get children failed", e);
    }
    return [];
}

export function getJitenCoverUrl(deckId: number, parentDeckId: number | null): string {
    const id = parentDeckId || deckId;
    return `https://cdn.jiten.moe/${id}/cover.jpg`;
}

export function getJitenDeckUrl(deckId: number): string {
    return `https://jiten.moe/decks/${deckId}`;
}

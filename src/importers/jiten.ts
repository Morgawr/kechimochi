import { BaseImporter } from './base';
import { ScrapedMetadata } from './index';
import { JITEN_BASE_URL } from '../jiten_api';
import { fetchExternalJson } from '../platform';

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
        const deckId = deckIdMatch[1];

        const jsonStr = await fetchExternalJson(
            `${JITEN_BASE_URL}/api/media-deck/${deckId}/detail`,
            'GET',
        );
        const json = JSON.parse(jsonStr);
        const data = json.data?.mainDeck;
        if (!data) {
            throw new Error("Could not find media data in Jiten.moe response.");
        }

        const extraData = this.createExtraData(url);

        if (data.characterCount) extraData["Character count"] = data.characterCount.toLocaleString();
        if (data.wordCount) extraData["Word count"] = data.wordCount.toLocaleString();
        if (data.uniqueKanjiCount) extraData["Unique kanji"] = data.uniqueKanjiCount.toLocaleString();
        if (data.difficultyRaw !== undefined && data.difficultyRaw !== -1) {
            extraData["Jiten difficulty"] = `${data.difficultyRaw.toFixed(2)}/5`;
        }

        return {
            title: data.originalTitle || data.romajiTitle || data.englishTitle || "",
            description: data.description || "",
            coverImageUrl: data.parentDeckId ? "" : `https://cdn.jiten.moe/${data.deckId}/cover.jpg`,
            extraData
        };
    }
}

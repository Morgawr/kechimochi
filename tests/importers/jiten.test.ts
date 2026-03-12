import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JitenImporter } from '../../src/importers/jiten';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('JitenImporter', () => {
    let importer: JitenImporter;

    beforeEach(() => {
        importer = new JitenImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Jiten URLs', () => {
            expect(importer.matchUrl('https://jiten.moe/decks/123', 'Anime')).toBe(true);
            expect(importer.matchUrl('https://jiten.moe/decks/456', 'Novel')).toBe(true);
            expect(importer.matchUrl('https://jiten.moe/decks/789', 'Manga')).toBe(true);
        });

        it('should NOT match invalid domains or paths', () => {
            expect(importer.matchUrl('https://jiten.moe/', 'Anime')).toBe(false);
            expect(importer.matchUrl('https://google.com/decks/123', 'Anime')).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should fetch and parse Jiten deck data correctly', async () => {
            const mockData = {
                data: {
                    mainDeck: {
                        deckId: 123,
                        originalTitle: 'タイトル',
                        description: 'Desc',
                        characterCount: 1000,
                        difficultyRaw: 3.5
                    }
                }
            };

            vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockData));

            const result = await importer.fetch('https://jiten.moe/decks/123');

            expect(result.title).toBe('タイトル');
            expect(result.description).toBe('Desc');
            expect(result.coverImageUrl).toContain('cdn.jiten.moe/123/cover.jpg');
            expect(result.extraData['Character count']).toBe('1,000');
            expect(result.extraData['Jiten difficulty']).toBe('3.50/5');
        });

        it('should throw error on invalid URL', async () => {
            await expect(importer.fetch('https://jiten.moe/invalid')).rejects.toThrow('Invalid Jiten.moe URL');
        });
    });
});

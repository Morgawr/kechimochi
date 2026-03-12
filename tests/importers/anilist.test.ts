import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnilistImporter } from '../../src/importers/anilist';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('AnilistImporter', () => {
    let importer: AnilistImporter;

    beforeEach(() => {
        importer = new AnilistImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Anilist URLs', () => {
            expect(importer.matchUrl('https://anilist.co/anime/123/Some-Title/', 'Anime')).toBe(true);
        });

        it('should NOT match invalid URLs or types', () => {
            expect(importer.matchUrl('https://anilist.co/anime/123', 'Manga')).toBe(false);
            expect(importer.matchUrl('https://google.com', 'Anime')).toBe(false);
        });
    });

    describe('fetch', () => {
        it('should fetch and parse Anilist record correctly', async () => {
            const mockResponse = {
                data: {
                    Media: {
                        title: { english: 'Test Anime', romaji: 'Test Romaji' },
                        description: 'Best anime ever.',
                        coverImage: { extraLarge: 'https://img.anilist.co/extralarge/123.jpg' },
                        episodes: 12,
                        season: 'SUMMER',
                        seasonYear: 2024,
                        startDate: { year: 2024, month: 7, day: 1 },
                        averageScore: 85,
                        source: 'LIGHT_NOVEL',
                        genres: ['Action', 'Fantasy']
                    }
                }
            };

            vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockResponse));

            const result = await importer.fetch('https://anilist.co/anime/123/');

            expect(result.title).toBe('Test Anime');
            expect(result.description).toBe('Best anime ever.');
            expect(result.coverImageUrl).toBe('https://img.anilist.co/extralarge/123.jpg');
            expect(result.extraData['Episodes']).toBe('12');
            expect(result.extraData['Airing Season']).toBe('Summer 2024');
            expect(result.extraData['Anilist Score']).toBe('85%');
            expect(result.extraData['Original Source']).toBe('Light Novel');
        });

        it('should throw error on invalid ID', async () => {
            await expect(importer.fetch('https://anilist.co/anime/notanid/')).rejects.toThrow('Could not extract Anilist Media ID from URL.');
        });

        it('should throw error on API error response', async () => {
            const errorResponse = {
                errors: [{ message: 'Not Found' }]
            };
            vi.mocked(invoke).mockResolvedValue(JSON.stringify(errorResponse));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(importer.fetch('https://anilist.co/anime/123/')).rejects.toThrow('Anilist API returned an error: Not Found');
            
            consoleSpy.mockRestore();
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnilistImporter } from '../../src/importers/anilist';
import { invoke } from '@tauri-apps/api/core';

describe('AnilistImporter', () => {
    let importer: AnilistImporter;

    beforeEach(() => {
        importer = new AnilistImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Anilist URLs', () => {
            expect(importer.matchUrl('https://anilist.co/anime/123/Some-Title/', 'Anime')).toBe(true);
            expect(importer.matchUrl('https://anilist.co/manga/151254/Erio-to-Denki-Ningyou/', 'Manga')).toBe(true);
        });

    });

    describe('fetch', () => {
        it('should fetch and parse Anilist record correctly', async () => {
            const mockResponse = {
                data: {
                    Media: {
                        title: { english: 'Test Anime', romaji: 'Test Romaji' },
                        description: '<i>Best anime ever.</i><br><br>Absolutely worth it.',
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
            expect(result.contentType).toBe('Anime');
            expect(result.description).toBe('Best anime ever.\n\nAbsolutely worth it.');
            expect(result.coverImageUrl).toBe('https://img.anilist.co/extralarge/123.jpg');
            expect(result.extraData['Episodes']).toBe('12');
            expect(result.extraData['Airing Season']).toBe('Summer 2024');
            expect(result.extraData['Anilist Score']).toBe('85%');
            expect(result.extraData['Source (Anilist)']).toBe('https://anilist.co/anime/123/');
            expect(result.extraData['Original Source']).toBe('Light Novel');
        });

        it('should fetch and parse Anilist manga records correctly', async () => {
            const mockResponse = {
                data: {
                    Media: {
                        title: { romaji: 'Erio to Denki Ningyou' },
                        description: 'A futuristic yet nostalgic world.<br><br>(Source: Tonari no Young Jump)',
                        coverImage: { large: 'https://img.anilist.co/large/151254.jpg' },
                        volumes: 5,
                        chapters: 45,
                        startDate: { year: 2022, month: 6, day: 3 },
                        averageScore: 75,
                        genres: ['Adventure', 'Sci-Fi']
                    }
                }
            };

            vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockResponse));

            const result = await importer.fetch('https://anilist.co/manga/151254/Erio-to-Denki-Ningyou/');

            expect(result.title).toBe('Erio to Denki Ningyou');
            expect(result.contentType).toBe('Manga');
            expect(result.description).toBe('A futuristic yet nostalgic world.\n\n(Source: Tonari no Young Jump)');
            expect(result.coverImageUrl).toBe('https://img.anilist.co/large/151254.jpg');
            expect(result.extraData['Total Volumes']).toBe('5');
            expect(result.extraData['Total Chapters']).toBe('45');
            expect(result.extraData['Publication Date']).toBe('2022-06-03');
            expect(result.extraData['Anilist Score']).toBe('75%');
            expect(result.extraData['Genres']).toBe('Adventure, Sci-Fi');
            expect(result.extraData['Source (Anilist)']).toBe('https://anilist.co/manga/151254/Erio-to-Denki-Ningyou/');
        });

        it('should omit manga volume totals when Anilist reports zero volumes', async () => {
            const mockResponse = {
                data: {
                    Media: {
                        title: { romaji: 'Serialized Manga' },
                        coverImage: {},
                        volumes: 0,
                        chapters: 10,
                    }
                }
            };

            vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockResponse));

            const result = await importer.fetch('https://anilist.co/manga/456/');

            expect(result.extraData['Total Volumes']).toBeUndefined();
            expect(result.extraData['Total Chapters']).toBe('10');
        });

        it('should throw error on invalid ID', async () => {
            await expect(importer.fetch('https://anilist.co/anime/notanid/')).rejects.toThrow('Could not extract Anilist Media ID from URL.');
            await expect(importer.fetch('https://anilist.co/manga/notanid/')).rejects.toThrow('Could not extract Anilist Media ID from URL.');
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

        it('should fall back to the romaji title and throw when media is missing', async () => {
            vi.mocked(invoke)
                .mockResolvedValueOnce(JSON.stringify({
                    data: {
                        Media: {
                            title: { romaji: 'Romaji Only' },
                            coverImage: {},
                        }
                    }
                }))
                .mockResolvedValueOnce(JSON.stringify({ data: {} }));

            await expect(importer.fetch('https://anilist.co/anime/321/')).resolves.toEqual(expect.objectContaining({
                title: 'Romaji Only',
            }));

            await expect(importer.fetch('https://anilist.co/anime/999/')).rejects.toThrow('Could not find media data in Anilist response.');
        });
    });
});

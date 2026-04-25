import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackloggdImporter } from '../../src/importers/backloggd';
import { invoke } from '@tauri-apps/api/core';

describe('BackloggdImporter', () => {
    let importer: BackloggdImporter;

    beforeEach(() => {
        importer = new BackloggdImporter();
        vi.clearAllMocks();
        // DOMParser is available in happy-dom
    });

    describe('matchUrl', () => {
        it('should match valid Backloggd URLs', () => {
            expect(importer.matchUrl('https://backloggd.com/games/persona-5/', 'Videogame')).toBe(true);
        });

    });

    describe('fetch', () => {
        it('should parse metadata from HTML correctly', async () => {
            const mockHtml = `
                <html>
                <head>
                    <meta property="og:description" content="A JRPG masterpiece.">
                    <meta property="og:image" content="//img.backloggd.com/t_cover_big/123.jpg">
                </head>
                <body>
                    <div class="row mt-2">
                        <div class="game-details-header">Released</div>
                        <div class="game-details-value">Sep 15, 2016</div>
                    </div>
                    <div class="row mt-2">
                        <div class="game-details-header">Genres</div>
                        <div class="game-details-value">RPGs</div>
                    </div>
                    <div class="row mt-2">
                        <div class="game-details-header">Platforms</div>
                        <div class="game-details-value">PlayStation 4</div>
                    </div>
                    <div class="game-subtitle">
                        <a href="/company/atlus">Atlus</a>
                        <a href="/company/sega">Sega</a>
                    </div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://backloggd.com/games/p5/');

            expect(invoke).toHaveBeenCalledWith('fetch_external_json', expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept-Language': 'en-US,en;q=0.9',
                }),
            }));
            expect(result.description).toBe('A JRPG masterpiece.');
            expect(result.coverImageUrl).toBe('https://img.backloggd.com/t_cover_big_2x/123.jpg'); // protocol-relative + high-res fix
            expect(result.extraData['Source (Backloggd)']).toBe('https://backloggd.com/games/p5/');
            expect(result.extraData['Release Date']).toBe('Sep 15, 2016');
            expect(result.extraData['Genres']).toBe('RPGs');
            expect(result.extraData['Platforms']).toBe('PlayStation 4');
            expect(result.extraData['Developer']).toBe('Atlus');
            expect(result.extraData['Publisher']).toBe('Sega');
        });

        it('should handle missing data gracefully', async () => {
            vi.mocked(invoke).mockResolvedValue('<html><body></body></html>');
            const result = await importer.fetch('https://backloggd.com/games/missing/');
            expect(result.description).toBe('');
            expect(result.coverImageUrl).toBe('');
            expect(result.extraData['Developer']).toBeUndefined();
        });

        it('should fall back to img src and reuse a single company as publisher', async () => {
            const mockHtml = `
                <html>
                <body>
                    <img class="card-img" src="https://img.backloggd.com/cover.jpg">
                    <div class="game-subtitle">
                        <a href="/company/atlus">Atlus</a>
                    </div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://backloggd.com/games/p5/');

            expect(result.coverImageUrl).toBe('https://img.backloggd.com/cover.jpg');
            expect(result.extraData['Developer']).toBe('Atlus');
            expect(result.extraData['Publisher']).toBe('Atlus');
        });

        it('should parse release date and dedupe companies from current Backloggd page markup', async () => {
            const mockHtml = `
                <html>
                <head>
                    <meta property="og:description" content="A space adventure.">
                    <meta property="og:image" content="https://images.igdb.com/igdb/image/upload/t_cover_big/co720g.jpg">
                </head>
                <body>
                    <div class="row d-none d-sm-flex mx-n1 game-title-section">
                        <div class="col-auto sub-title">
                            <span class="filler-text">by</span>
                        </div>
                        <div class="col-auto sub-title">
                            <a href="/company/konami/">Konami</a>
                        </div>
                        <div class="col-auto sub-title">
                            <a href="/company/kce/">KCE Japan</a>
                        </div>
                        <div class="container backloggd-container sm-container">
                            <div class="row">
                                <div class="col-auto my-auto">Released</div>
                                <div class="col-auto my-auto pl-1">
                                    <a href="/games/lib/popular/release_year:1994/">Jul 29, 1994</a>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="game-subtitle">
                        <a href="/games/lib/popular/release_year:1994/" class="game-year">1994</a>
                        <a href="/company/konami/">Konami</a>
                        <a href="/company/kce/">KCE Japan</a>
                    </div>
                    <div class="row mt-2">
                        <div class="col-3 col-md-2 my-auto">
                            <p class="game-details-header">Genres</p>
                        </div>
                        <div class="col-auto col-md ml-auto my-auto">
                            <span class="game-detail">
                                <a class="game-details-value" href="/games/lib/popular/genre:adventure/">Adventure</a>
                            </span>
                            <span class="game-detail">
                                <a class="game-details-value" href="/games/lib/popular/genre:visual-novel/">Visual Novel</a>
                            </span>
                        </div>
                    </div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://backloggd.com/games/policenauts/');

            expect(result.extraData['Release Date']).toBe('Jul 29, 1994');
            expect(result.extraData['Genres']).toBe('Adventure, Visual Novel');
            expect(result.extraData['Developer']).toBe('Konami');
            expect(result.extraData['Publisher']).toBe('KCE Japan');
        });
    });
});

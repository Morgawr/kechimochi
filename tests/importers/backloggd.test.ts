import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackloggdImporter } from '../../src/importers/backloggd';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

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

        it('should match Backloggd URLs regardless of content type', () => {
            expect(importer.matchUrl('https://backloggd.com/games/persona-5/', 'Anime')).toBe(true);
            expect(importer.matchUrl('https://google.com', 'Videogame')).toBe(false);
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
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImdbImporter } from '../../src/importers/imdb';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('ImdbImporter', () => {
    let importer: ImdbImporter;

    beforeEach(() => {
        importer = new ImdbImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid IMDb URLs', () => {
            expect(importer.matchUrl('https://www.imdb.com/title/tt12345/', 'Movie')).toBe(true);
            expect(importer.matchUrl('https://imdb.com/title/tt12345/', 'Anime')).toBe(true);
        });

    });

    describe('fetch', () => {
        it('should parse data from JSON-LD correctly', async () => {
            const mockHtml = `
                <html>
                <head>
                    <script type="application/ld+json">
                    {
                        "@type": "Movie",
                        "description": "JSON-LD Desc",
                        "image": "https://img.imdb.com/123.jpg",
                        "director": { "name": "Nolan" },
                        "genre": ["Action", "Sci-Fi"],
                        "duration": "PT2H28M",
                        "datePublished": "2010-07-16",
                        "aggregateRating": { "ratingValue": 8.8 }
                    }
                    </script>
                </head>
                <body></body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://imdb.com/title/tt123/');

            expect(result.description).toBe('JSON-LD Desc');
            expect(result.coverImageUrl).toBe('https://img.imdb.com/123.jpg');
            expect(result.extraData['Source (IMDB)']).toBe('https://imdb.com/title/tt123/');
            expect(result.extraData['Director']).toBe('Nolan');
            expect(result.extraData['Genres']).toBe('Action, Sci-Fi');
            expect(result.extraData['Total Runtime']).toBe('2h 28m');
            expect(result.extraData['Release Year']).toBe('2010');
            expect(result.extraData['IMDb Rating']).toBe('8.8');
        });

        it('should fallback to CSS selectors if JSON-LD is missing', async () => {
            const mockHtml = `
                <html>
                <body>
                    <span data-testid="plot-xl">CSS Desc</span>
                    <section data-testid="hero-parent">
                        <div class="ipc-poster"><img class="ipc-image" src="https://img.imdb.com/css.jpg"></div>
                    </section>
                    <div data-testid="genres"><a class="ipc-chip">Action</a></div>
                    <ul data-testid="hero-title-block__metadata">
                        <li class="ipc-inline-list__item">2h 10m</li>
                        <a href="/releaseinfo">2022</a>
                    </ul>
                    <div data-testid="hero-rating-bar__aggregate-rating__score"><span>7.5</span></div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://imdb.com/title/tt123/');

            expect(result.description).toBe('CSS Desc');
            expect(result.coverImageUrl).toBe('https://img.imdb.com/css.jpg');
            expect(result.extraData['Genres']).toBe('Action');
            expect(result.extraData['Total Runtime']).toBe('2h 10m');
            expect(result.extraData['Release Year']).toBe('2022');
            expect(result.extraData['IMDb Rating']).toBe('7.5');
        });

        it('should throw error on CAPTCHA check', async () => {
            const captchaHtml = '<html><head><title>Bot Check - IMDb</title></head><body></body></html>';
            vi.mocked(invoke).mockResolvedValue(captchaHtml);

            await expect(importer.fetch('https://imdb.com/title/tt123/')).rejects.toThrow('IMDb blocked the request');
        });
    });
});

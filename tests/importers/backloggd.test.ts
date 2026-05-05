import { expect, it } from 'vitest';
import { BackloggdImporter } from '../../src/importers/backloggd';
import {
    describeImporter,
    expectMockedImport,
    htmlDocument,
    itMatchesUrls,
    mockedInvoke,
    mockFetchResponse,
} from './importer_test_utils';

describeImporter('BackloggdImporter', () => new BackloggdImporter(), getImporter => {
    itMatchesUrls('matches valid Backloggd URLs', getImporter, [
        { url: 'https://backloggd.com/games/persona-5/', contentType: 'Videogame' },
    ]);

    it('parses metadata from HTML correctly', async () => {
        await expectMockedImport(getImporter(), {
            url: 'https://backloggd.com/games/p5/',
            response: htmlDocument({
                head: `
                    <meta property="og:description" content="A JRPG masterpiece.">
                    <meta property="og:image" content="//img.backloggd.com/t_cover_big/123.jpg">
                `,
                body: `
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
                `,
            }),
            expected: {
                description: 'A JRPG masterpiece.',
                coverImageUrl: 'https://img.backloggd.com/t_cover_big_2x/123.jpg',
                extraData: {
                    'Source (Backloggd)': 'https://backloggd.com/games/p5/',
                    'Release Date': 'Sep 15, 2016',
                    Genres: 'RPGs',
                    Platforms: 'PlayStation 4',
                    Developer: 'Atlus',
                    Publisher: 'Sega',
                },
            },
        });

        expect(mockedInvoke).toHaveBeenCalledWith('fetch_external_json', expect.objectContaining({
            headers: expect.objectContaining({
                'Accept-Language': 'en-US,en;q=0.9',
            }),
        }));
    });

    it('handles missing data gracefully', async () => {
        mockFetchResponse('<html><body></body></html>');

        const result = await getImporter().fetch('https://backloggd.com/games/missing/');

        expect(result.description).toBe('');
        expect(result.coverImageUrl).toBe('');
        expect(result.extraData['Developer']).toBeUndefined();
    });

    it('falls back to img src and reuses a single company as publisher', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://backloggd.com/games/p5/',
            response: htmlDocument({
                body: `
                    <img class="card-img" src="https://img.backloggd.com/cover.jpg">
                    <div class="game-subtitle">
                        <a href="/company/atlus">Atlus</a>
                    </div>
                `,
            }),
            expected: {
                coverImageUrl: 'https://img.backloggd.com/cover.jpg',
                extraData: {
                    Developer: 'Atlus',
                    Publisher: 'Atlus',
                },
            },
        });

        expect(result).toBeDefined();
    });

    it('parses release date and dedupes companies from current Backloggd page markup', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://backloggd.com/games/policenauts/',
            response: htmlDocument({
                head: `
                    <meta property="og:description" content="A space adventure.">
                    <meta property="og:image" content="https://images.igdb.com/igdb/image/upload/t_cover_big/co720g.jpg">
                `,
                body: `
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
                `,
            }),
            expected: {
                extraData: {
                    'Release Date': 'Jul 29, 1994',
                    Genres: 'Adventure, Visual Novel',
                    Developer: 'Konami',
                    Publisher: 'KCE Japan',
                },
            },
        });

        expect(result).toBeDefined();
    });
});

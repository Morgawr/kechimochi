import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ImdbImporter } from '../../src/importers/imdb';
import type { ScrapedMetadata } from '../../src/importers';

const mockedInvoke = vi.mocked(invoke);
const imdbUrl = 'https://imdb.com/title/tt123/';

type ExpectedImport = {
    description?: string;
    coverImageUrl?: string;
    extraData?: Record<string, string>;
};

function imdbPage(body = '', head = ''): string {
    return `<html><head>${head}</head><body>${body}</body></html>`;
}

function imdbJsonLdPage(payload: Record<string, unknown>): string {
    return imdbPage('', `<script type="application/ld+json">${JSON.stringify(payload)}</script>`);
}

function imdbGraphQlPayload() {
    return JSON.stringify({
        data: {
            title: {
                plot: { plotText: { plainText: 'Gabby&amp;apos;s road trip takes an unexpected turn.' } },
                primaryImage: { url: 'https://m.media-amazon.com/images/M/test.jpg' },
                releaseYear: { year: 2025 },
                runtime: { seconds: 5880 },
                genres: { genres: [{ text: 'Animation' }, { text: 'Adventure' }] },
                ratingsSummary: { aggregateRating: 5.5 },
                principalCredits: [{
                    category: { text: 'Director' },
                    credits: [{ name: { nameText: { text: 'Ryan Crego' } } }]
                }]
            }
        }
    });
}

async function importFromImdb(responses: string[], url = imdbUrl): Promise<ScrapedMetadata> {
    for (const response of responses) mockedInvoke.mockResolvedValueOnce(response);
    return new ImdbImporter().fetch(url);
}

async function expectImdbImport(responses: string[], expected: ExpectedImport, url = imdbUrl) {
    const result = await importFromImdb(responses, url);

    if (expected.description !== undefined) expect(result.description).toBe(expected.description);
    if (expected.coverImageUrl !== undefined) expect(result.coverImageUrl).toBe(expected.coverImageUrl);
    if (expected.extraData) expect(result.extraData).toEqual(expect.objectContaining(expected.extraData));

    return result;
}

describe('ImdbImporter', () => {
    beforeEach(() => {
        mockedInvoke.mockReset();
    });

    it('matches supported title URLs', () => {
        const subject = new ImdbImporter();

        expect([
            subject.matchUrl('https://www.imdb.com/title/tt12345/', 'Movie'),
            subject.matchUrl('https://imdb.com/title/tt12345/', 'Anime')
        ]).toEqual([true, true]);
    });

    it('reads structured metadata from JSON-LD', async () => {
        await expectImdbImport(
            [imdbJsonLdPage({
                "@type": "Movie",
                description: "JSON-LD Desc",
                image: "https://img.imdb.com/123.jpg",
                director: { name: "Nolan" },
                genre: ["Action", "Sci-Fi"],
                duration: "PT2H28M",
                datePublished: "2010-07-16",
                aggregateRating: { ratingValue: 8.8 }
            })],
            {
                description: 'JSON-LD Desc',
                coverImageUrl: 'https://img.imdb.com/123.jpg',
                extraData: {
                    'Source (IMDB)': imdbUrl,
                    Director: 'Nolan',
                    Genres: 'Action, Sci-Fi',
                    'Total Runtime': '2h 28m',
                    'Release Year': '2010',
                    'IMDb Rating': '8.8'
                }
            }
        );
    });

    it('uses page selectors when JSON-LD is absent', async () => {
        await expectImdbImport(
            [imdbPage(`
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
            `)],
            {
                description: 'CSS Desc',
                coverImageUrl: 'https://img.imdb.com/css.jpg',
                extraData: {
                    Genres: 'Action',
                    'Total Runtime': '2h 10m',
                    'Release Year': '2022',
                    'IMDb Rating': '7.5'
                }
            }
        );
    });

    it('uses IMDb GraphQL when the title page has no embedded metadata', async () => {
        await expectImdbImport(
            [imdbPage('', '<title>IMDb</title>'), imdbGraphQlPayload()],
            {
                description: "Gabby's road trip takes an unexpected turn.",
                coverImageUrl: 'https://m.media-amazon.com/images/M/test.jpg',
                extraData: {
                    Director: 'Ryan Crego',
                    Genres: 'Animation, Adventure',
                    'Total Runtime': '1h 38m',
                    'Release Year': '2025',
                    'IMDb Rating': '5.5'
                }
            },
            'https://www.imdb.com/title/tt32214143/'
        );

        expect(mockedInvoke).toHaveBeenLastCalledWith('fetch_external_json', expect.objectContaining({
            url: 'https://caching.graphql.imdb.com/',
            method: 'POST',
            headers: expect.objectContaining({ Accept: 'application/json' })
        }));
    });

    it('reports IMDb robot checks clearly', async () => {
        await expect(importFromImdb([imdbPage('', '<title>Bot Check - IMDb</title>')]))
            .rejects.toThrow('IMDb blocked the request');
    });

    it('keeps second-only durations and reports empty pages as extraction failures', async () => {
        const secondsOnlyResult = await importFromImdb([
            imdbJsonLdPage({ "@type": "Movie", duration: "PT45S" }),
            '{"data":{"title":null}}'
        ], 'https://imdb.com/title/tt456/');

        expect(secondsOnlyResult.extraData['Total Runtime']).toBe('45s');

        await expect(importFromImdb([
            imdbPage('', '<title>IMDb</title>'),
            '{"data":{"title":null}}'
        ], 'https://imdb.com/title/tt789/')).rejects.toThrow('Could not extract any data from the IMDb page.');
    });
});

import { appendFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import type { MetadataImporter, ScrapedMetadata } from '../../src/importers';
import { VndbImporter } from '../../src/importers/vndb';
import { BackloggdImporter } from '../../src/importers/backloggd';
import { ImdbImporter } from '../../src/importers/imdb';
import { AnilistImporter } from '../../src/importers/anilist';
import { CmoaImporter } from '../../src/importers/cmoa';
import { BookwalkerImporter } from '../../src/importers/bookwalker';
import { BookmeterImporter } from '../../src/importers/bookmeter';
import { ShonenjumpplusImporter } from '../../src/importers/shonenjumpplus';
import { JitenImporter } from '../../src/importers/jiten';

type FieldRule =
    | { kind: 'empty' }
    | { kind: 'exact'; value: string }
    | { kind: 'text'; minimumLength?: number }
    | { kind: 'url' }
    | { kind: 'pattern'; value: RegExp; description: string }
    | { kind: 'number'; minimum: number; maximum?: number };

type MetadataContract = {
    title: FieldRule;
    description: FieldRule;
    coverImageUrl: FieldRule;
    contentType?: FieldRule;
    extraData: Record<string, FieldRule>;
};

type HealthSample = {
    name: string;
    importer: MetadataImporter;
    url: string;
    contract: MetadataContract;
};

type HealthResult = {
    name: string;
    status: 'Healthy' | 'Unhealthy';
    attempts: number;
    returnedFields: string;
    detail: string;
};

const EMPTY: FieldRule = { kind: 'empty' };
const TEXT: FieldRule = { kind: 'text' };
const DESCRIPTION: FieldRule = { kind: 'text', minimumLength: 20 };
const HTTP_URL: FieldRule = { kind: 'url' };
const POSITIVE_NUMBER: FieldRule = { kind: 'number', minimum: 1 };
const DATE = pattern(/^\d{4}-\d{2}-\d{2}$/, 'a YYYY-MM-DD date');
const YEAR = pattern(/^\d{4}$/, 'a four-digit year');

const samples: HealthSample[] = [
    sample('VNDB', new VndbImporter(), 'https://vndb.org/v17', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            'Release Date': DATE,
            Developer: TEXT,
            Publisher: TEXT,
            Platforms: TEXT,
        },
    }),
    sample('Backloggd', new BackloggdImporter(), 'https://backloggd.com/games/persona-5/', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            'Release Date': TEXT,
            Genres: TEXT,
            Platforms: TEXT,
            Developer: TEXT,
            Publisher: TEXT,
        },
    }),
    sample('IMDb', new ImdbImporter(), 'https://www.imdb.com/title/tt14521412/', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            Director: TEXT,
            Genres: TEXT,
            'Total Runtime': pattern(/^(?:\d+h(?: \d+m)?|\d+m|\d+s)$/, 'a formatted runtime'),
            'Release Year': YEAR,
            'IMDb Rating': { kind: 'number', minimum: 0, maximum: 10 },
        },
    }),
    sample('AniList', new AnilistImporter(), 'https://anilist.co/anime/1/Cowboy-Bebop/', {
        title: TEXT,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        contentType: exact('Anime'),
        extraData: {
            Episodes: POSITIVE_NUMBER,
            'Airing Season': TEXT,
            'Start Airing Date': DATE,
            'End Airing Date': DATE,
            'Anilist Score': { kind: 'number', minimum: 0, maximum: 100 },
            'Original Source': TEXT,
            Genres: TEXT,
        },
    }),
    sample('Cmoa', new CmoaImporter(), 'https://www.cmoa.jp/title/60370/', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            Genres: TEXT,
            Publisher: TEXT,
            'Publication Date': TEXT,
            Rating: { kind: 'number', minimum: 0, maximum: 5 },
            Author: TEXT,
        },
    }),
    sample('Bookwalker', new BookwalkerImporter(), 'https://bookwalker.jp/de898cbc54-927d-428a-bfd3-20a0eaaaa6b1/', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            'Series Name': TEXT,
            Author: TEXT,
            Publisher: TEXT,
            'Publication Date': TEXT,
            'Page Number': POSITIVE_NUMBER,
        },
    }),
    sample('Bookmeter', new BookmeterImporter(), 'https://bookmeter.com/books/576956', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            'Page Count': POSITIVE_NUMBER,
            Publisher: TEXT,
            Author: TEXT,
        },
    }),
    sample('Shonen Jump Plus', new ShonenjumpplusImporter(), 'https://shonenjumpplus.com/episode/17106371864158162696', {
        title: EMPTY,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        extraData: {
            'Publication Date': DATE,
        },
    }),
    sample('Jiten.moe', new JitenImporter(), 'https://jiten.moe/decks/32245', {
        title: TEXT,
        description: DESCRIPTION,
        coverImageUrl: HTTP_URL,
        contentType: exact('Anime'),
        extraData: {
            'Character count': POSITIVE_NUMBER,
            'Word count': POSITIVE_NUMBER,
            'Unique kanji': POSITIVE_NUMBER,
            'Jiten difficulty': { kind: 'number', minimum: 0, maximum: 5 },
        },
    }),
    // DMM Games blocks the GitHub-hosted health runner because it operates outside Japan.
];

const healthResults: HealthResult[] = [];

describe('daily importer infrastructure health', () => {
    for (const healthSample of samples) {
        it(`${healthSample.name} returns reasonable metadata`, async () => {
            let attempts = 0;
            let latestMetadata: ScrapedMetadata | undefined;

            try {
                const metadata = await attemptTwice(async () => {
                    attempts += 1;
                    const result = await healthSample.importer.fetch(healthSample.url);
                    latestMetadata = result;
                    validateMetadata(healthSample, result);
                    return result;
                });

                healthResults.push({
                    name: healthSample.name,
                    status: 'Healthy',
                    attempts,
                    returnedFields: summarizeFields(metadata),
                    detail: 'Contract satisfied',
                });
                expect(metadata).toBeDefined();
            } catch (error) {
                const detail = errorMessage(error);
                healthResults.push({
                    name: healthSample.name,
                    status: 'Unhealthy',
                    attempts,
                    returnedFields: latestMetadata ? summarizeFields(latestMetadata) : 'Unavailable',
                    detail,
                });
                throw new Error(`${healthSample.name} infrastructure health check failed: ${detail}`, { cause: error });
            }
        });
    }
});

afterAll(async () => {
    const report = buildReport(healthResults);
    process.stdout.write(`\n${report}\n`);

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) await appendFile(summaryPath, `${report}\n`, 'utf8');
});

function sample(name: string, importer: MetadataImporter, url: string, contract: MetadataContract): HealthSample {
    return {
        name,
        importer,
        url,
        contract: {
            ...contract,
            extraData: {
                [`Source (${importer.name})`]: exact(url),
                ...contract.extraData,
            },
        },
    };
}

function exact(value: string): FieldRule {
    return { kind: 'exact', value };
}

function pattern(value: RegExp, description: string): FieldRule {
    return { kind: 'pattern', value, description };
}

async function attemptTwice<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch { /* retry once to filter transient upstream failures */ }

    await new Promise(resolve => setTimeout(resolve, 1_000));

    try {
        return await operation();
    } catch (secondError) {
        throw new Error(`Two attempts failed. Last error: ${errorMessage(secondError)}`, { cause: secondError });
    }
}

function validateMetadata(healthSample: HealthSample, metadata: ScrapedMetadata): void {
    const errors = [
        ...validateField('title', metadata.title, healthSample.contract.title),
        ...validateField('description', metadata.description, healthSample.contract.description),
        ...validateField('coverImageUrl', metadata.coverImageUrl, healthSample.contract.coverImageUrl),
    ];

    if (healthSample.contract.contentType) {
        errors.push(...validateField('contentType', metadata.contentType, healthSample.contract.contentType));
    }

    if (!metadata.extraData || typeof metadata.extraData !== 'object') {
        errors.push('extraData must be an object');
    } else {
        for (const [key, rule] of Object.entries(healthSample.contract.extraData)) {
            errors.push(...validateField(`extraData[${JSON.stringify(key)}]`, metadata.extraData[key], rule));
        }
    }

    if (errors.length > 0) {
        throw new Error(`Returned metadata violated its health contract:\n- ${errors.join('\n- ')}`);
    }
}

function validateField(label: string, value: unknown, rule: FieldRule): string[] {
    if (typeof value !== 'string') return [`${label} must be a string`];

    switch (rule.kind) {
        case 'empty':
            return value === '' ? [] : [`${label} must remain intentionally empty`];
        case 'exact':
            return value === rule.value ? [] : [`${label} must equal ${JSON.stringify(rule.value)}`];
        case 'text': {
            const minimumLength = rule.minimumLength ?? 1;
            return value.trim().length >= minimumLength
                ? []
                : [`${label} must contain at least ${minimumLength} non-whitespace characters`];
        }
        case 'url':
            return validateUrl(label, value);
        case 'pattern':
            return rule.value.test(value) ? [] : [`${label} must be ${rule.description}; received ${JSON.stringify(value)}`];
        case 'number':
            return validateNumber(label, value, rule.minimum, rule.maximum);
    }
}

function validateUrl(label: string, value: string): string[] {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? []
            : [`${label} must use HTTP or HTTPS`];
    } catch {
        return [`${label} must be a valid URL; received ${JSON.stringify(value)}`];
    }
}

function validateNumber(label: string, value: string, minimum: number, maximum?: number): string[] {
    const match = /-?\d+(?:\.\d+)?/.exec(value.replaceAll(',', ''));
    if (!match) return [`${label} must contain a number; received ${JSON.stringify(value)}`];

    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return [`${label} must contain a finite number`];
    if (parsed < minimum) return [`${label} must be at least ${minimum}; received ${parsed}`];
    if (maximum !== undefined && parsed > maximum) {
        return [`${label} must be at most ${maximum}; received ${parsed}`];
    }
    return [];
}

function summarizeFields(metadata: ScrapedMetadata): string {
    const baseFields = ['title', 'description', 'coverImageUrl'];
    if (metadata.contentType !== undefined) baseFields.push('contentType');
    const extraFields = Object.keys(metadata.extraData)
        .sort((left, right) => left.localeCompare(right))
        .map(key => `extraData.${key}`);
    return [...baseFields, ...extraFields].join(', ');
}

function buildReport(results: HealthResult[]): string {
    const lines = [
        '## Daily importer infrastructure health',
        '',
        '| Importer | Status | Attempts | Returned fields | Detail |',
        '| --- | --- | ---: | --- | --- |',
    ];

    for (const result of results) {
        lines.push(
            `| ${tableCell(result.name)} | ${result.status} | ${result.attempts} | ` +
            `${tableCell(result.returnedFields)} | ${tableCell(result.detail)} |`,
        );
    }

    return lines.join('\n');
}

function tableCell(value: string): string {
    return value.replaceAll('|', String.raw`\|`).replaceAll(/\s+/g, ' ').trim();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

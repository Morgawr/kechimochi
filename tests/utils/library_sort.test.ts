import { describe, expect, it } from 'vitest';
import {
    applyLibrarySort,
    buildExtraDataIndex,
    getUniqueExtraFieldNames,
    inferExtraFieldValueType,
    parseLeadingNumber,
    type LibrarySortOptions,
    type LibrarySortStage,
} from '../../src/media/sorting/library_sort';
import type { Media } from '../../src/types';
import type { LibraryActivityMetrics } from '../../src/media/library_types';

function makeMedia(overrides: Partial<Media> & { id: number }): Media {
    return {
        uid: `uid-${overrides.id}`,
        title: 'Untitled',
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Manga',
        tracking_status: 'Ongoing',
        ...overrides,
    };
}

function baseSortOptions(overrides: Partial<LibrarySortOptions> = {}): LibrarySortOptions {
    return {
        stages: [],
        keepOngoingFirst: false,
        keepArchivedLast: false,
        metricsByMediaId: {},
        extraDataIndex: new Map(),
        contentTypeOrder: ['Manga', 'Novel', 'Visual Novel'],
        trackingStatusOrder: ['Ongoing', 'Complete', 'Paused', 'Dropped'],
        ...overrides,
    };
}

function extraFieldStage(fieldName: string, direction: LibrarySortStage['direction'] = 'ascending'): LibrarySortStage {
    return { field: { kind: 'extra', fieldName }, direction };
}

describe('parseLeadingNumber', () => {
    it('should parse thousands-separated character counts', () => {
        expect(parseLeadingNumber('50,000')).toBe(50000);
        expect(parseLeadingNumber('9,000')).toBe(9000);
    });

    it('should parse a leading decimal ratio and ignore the trailing denominator', () => {
        expect(parseLeadingNumber('3.42/5')).toBe(3.42);
        expect(parseLeadingNumber('4.10/5')).toBe(4.1);
    });

    it('should parse a leading decimal and ignore trailing unit text', () => {
        expect(parseLeadingNumber('4.5 Stars')).toBe(4.5);
        expect(parseLeadingNumber('1,234.56 kg')).toBe(1234.56);
    });

    it('should parse a leading negative number', () => {
        expect(parseLeadingNumber('-1.2 x')).toBe(-1.2);
    });

    it('should return null for non-numeric or empty text', () => {
        expect(parseLeadingNumber('advanced')).toBeNull();
        expect(parseLeadingNumber('')).toBeNull();
        expect(parseLeadingNumber('N/A')).toBeNull();
    });
});

describe('inferExtraFieldValueType', () => {
    it('should infer numeric when every non-empty value parses as a leading number', () => {
        expect(inferExtraFieldValueType(['50,000', '9,000', '1,234'])).toBe('numeric');
    });

    it('should infer text when any non-empty value fails to parse', () => {
        expect(inferExtraFieldValueType(['50,000', 'advanced'])).toBe('text');
    });

    it('should ignore empty values when inferring the type', () => {
        expect(inferExtraFieldValueType(['50,000', ''])).toBe('numeric');
    });
});

describe('buildExtraDataIndex', () => {
    it('should parse and normalize extra data keyed by media id', () => {
        const mediaList = [
            makeMedia({ id: 1, extra_data: JSON.stringify({ 'Jiten Difficulty': '3.42/5' }) }),
        ];

        const index = buildExtraDataIndex(mediaList);
        expect(index.get(1)).toEqual({ 'Jiten Difficulty': '3.42/5' });
    });

    it('should skip a malformed extra data row without breaking the rest of the index', () => {
        const mediaList = [
            makeMedia({ id: 1, extra_data: '{not valid json' }),
            makeMedia({ id: 2, extra_data: JSON.stringify({ Author: 'Someone' }) }),
        ];

        const index = buildExtraDataIndex(mediaList);
        expect(index.has(1)).toBe(false);
        expect(index.get(2)).toEqual({ Author: 'Someone' });
    });

    it('should skip rows with no id', () => {
        const mediaList: Media[] = [{ ...makeMedia({ id: 1 }), id: undefined }];
        const index = buildExtraDataIndex(mediaList);
        expect(index.size).toBe(0);
    });

    it('should skip a row whose extra data is a JSON string instead of an object', () => {
        const mediaList = [makeMedia({ id: 1, extra_data: JSON.stringify('hello') })];
        const index = buildExtraDataIndex(mediaList);
        expect(index.has(1)).toBe(false);
    });

    it('should skip a row whose extra data is a JSON number instead of an object', () => {
        const mediaList = [makeMedia({ id: 1, extra_data: JSON.stringify(123) })];
        const index = buildExtraDataIndex(mediaList);
        expect(index.has(1)).toBe(false);
    });

    it('should skip a row whose extra data is a JSON array instead of an object', () => {
        const mediaList = [makeMedia({ id: 1, extra_data: JSON.stringify([1, 2]) })];
        const index = buildExtraDataIndex(mediaList);
        expect(index.has(1)).toBe(false);
    });

    it('should skip a row whose extra data is JSON null instead of an object', () => {
        const mediaList = [makeMedia({ id: 1, extra_data: JSON.stringify(null) })];
        const index = buildExtraDataIndex(mediaList);
        expect(index.has(1)).toBe(false);
    });

    it('should not surface bogus field names when non-object extra data rows are skipped', () => {
        const mediaList = [
            makeMedia({ id: 1, extra_data: JSON.stringify('hello') }),
            makeMedia({ id: 2, extra_data: JSON.stringify({ Author: 'Someone' }) }),
        ];
        const index = buildExtraDataIndex(mediaList);
        expect(getUniqueExtraFieldNames(index)).toEqual(['Author']);
    });
});

describe('getUniqueExtraFieldNames', () => {
    it('should case-fold duplicate keys and keep the first-seen casing', () => {
        const index = buildExtraDataIndex([
            makeMedia({ id: 1, extra_data: JSON.stringify({ 'Jiten Difficulty': '3.42/5' }) }),
            makeMedia({ id: 2, extra_data: JSON.stringify({ 'jiten difficulty': '4.10/5' }) }),
        ]);

        expect(getUniqueExtraFieldNames(index)).toEqual(['Jiten Difficulty']);
    });

    it('should sort field names locale-aware', () => {
        const index = buildExtraDataIndex([
            makeMedia({ id: 1, extra_data: JSON.stringify({ Zebra: 'a', Author: 'b' }) }),
        ]);

        expect(getUniqueExtraFieldNames(index)).toEqual(['Author', 'Zebra']);
    });
});

describe('applyLibrarySort - extra field values', () => {
    it('should sort "50,000" ahead of "9,000" numerically', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Small' }),
            makeMedia({ id: 2, title: 'Big' }),
        ];
        const extraDataIndex = new Map([
            [1, { 'Character Count': '9,000' }],
            [2, { 'Character Count': '50,000' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Character Count')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Small', 'Big']);
    });

    it('should sort formatted difficulty ratios numerically', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Harder' }),
            makeMedia({ id: 2, title: 'Easier' }),
        ];
        const extraDataIndex = new Map([
            [1, { 'Jiten Difficulty': '4.10/5' }],
            [2, { 'Jiten Difficulty': '3.42/5' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Jiten Difficulty')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Easier', 'Harder']);
    });

    it('should parse formatted star ratings numerically', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Better' }),
            makeMedia({ id: 2, title: 'Worse' }),
        ];
        const extraDataIndex = new Map([
            [1, { Rating: '4.5 Stars' }],
            [2, { Rating: '2.0 Stars' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Rating', 'descending')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Better', 'Worse']);
    });

    it('should match an extra field case-insensitively', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A' }),
            makeMedia({ id: 2, title: 'B' }),
        ];
        const extraDataIndex = new Map<number, Record<string, string>>([
            [1, { 'jiten difficulty': '4.10/5' }],
            [2, { 'Jiten Difficulty': '3.42/5' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Jiten Difficulty')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['B', 'A']);
    });

    it('should fall back to numeric-aware text collation for a non-numeric field', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A' }),
            makeMedia({ id: 2, title: 'B' }),
        ];
        const extraDataIndex = new Map([
            [1, { Author: 'Item 10' }],
            [2, { Author: 'Item 9' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Author')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['B', 'A']);
    });

    it('should sort missing, empty, and unparseable values last in ascending order', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Has value' }),
            makeMedia({ id: 2, title: 'Missing' }),
            makeMedia({ id: 3, title: 'Empty' }),
        ];
        const extraDataIndex = new Map([
            [1, { 'Character Count': '9,000' }],
            [3, { 'Character Count': '' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Character Count', 'ascending')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Has value', 'Missing', 'Empty']);
    });

    it('should sort missing, empty, and unparseable values last in descending order too', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Has value' }),
            makeMedia({ id: 2, title: 'Missing' }),
            makeMedia({ id: 3, title: 'Empty' }),
        ];
        const extraDataIndex = new Map([
            [1, { 'Character Count': '9,000' }],
            [3, { 'Character Count': '' }],
        ]);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Character Count', 'descending')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Has value', 'Missing', 'Empty']);
    });

    it('should not let a malformed extra data row break sorting', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Bad JSON', extra_data: '{not valid json' }),
            makeMedia({ id: 2, title: 'Good JSON', extra_data: JSON.stringify({ 'Character Count': '9,000' }) }),
        ];
        const extraDataIndex = buildExtraDataIndex(mediaList);

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [extraFieldStage('Character Count')],
            extraDataIndex,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Good JSON', 'Bad JSON']);
    });
});

describe('applyLibrarySort - builtin fields', () => {
    it('should return the input order unchanged for the default field', () => {
        const mediaList = [
            makeMedia({ id: 3, title: 'C' }),
            makeMedia({ id: 1, title: 'A' }),
            makeMedia({ id: 2, title: 'B' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'default' }, direction: 'ascending' }],
        }));

        expect(sorted).toEqual(mediaList);
    });

    it('should preserve incoming order as a stable tiebreak', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Same', content_type: 'Manga' }),
            makeMedia({ id: 2, title: 'Same', content_type: 'Manga' }),
            makeMedia({ id: 3, title: 'Same', content_type: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'ascending' }],
        }));

        expect(sorted.map(media => media.id)).toEqual([1, 2, 3]);
    });

    it('should let a later stage break ties left by an earlier stage', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Same', content_type: 'Novel' }),
            makeMedia({ id: 2, title: 'Same', content_type: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [
                { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
                { field: { kind: 'builtin', key: 'contentType' }, direction: 'ascending' },
            ],
        }));

        expect(sorted.map(media => media.content_type)).toEqual(['Manga', 'Novel']);
    });

    it('should sort by last activity date using the provided metrics', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Recent' }),
            makeMedia({ id: 2, title: 'Older' }),
        ];
        const metricsByMediaId: Record<number, LibraryActivityMetrics> = {
            1: { firstActivityDate: '2024-01-01', lastActivityDate: '2024-06-01', totalMinutes: 120, totalCharacters: 5000 },
            2: { firstActivityDate: '2023-01-01', lastActivityDate: '2023-06-01', totalMinutes: 60, totalCharacters: 2000 },
        };

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'lastActivity' }, direction: 'descending' }],
            metricsByMediaId,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Recent', 'Older']);
    });

    it('should sort by total characters using the provided metrics, including a real zero', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'ZeroChars' }),
            makeMedia({ id: 2, title: 'SomeChars' }),
            makeMedia({ id: 3, title: 'MostChars' }),
        ];
        const metricsByMediaId: Record<number, LibraryActivityMetrics> = {
            1: { firstActivityDate: '2024-01-01', lastActivityDate: '2024-01-01', totalMinutes: 30, totalCharacters: 0 },
            2: { firstActivityDate: '2024-01-01', lastActivityDate: '2024-01-01', totalMinutes: 30, totalCharacters: 500 },
            3: { firstActivityDate: '2024-01-01', lastActivityDate: '2024-01-01', totalMinutes: 30, totalCharacters: 5000 },
        };

        const sortedAscending = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'totalCharacters' }, direction: 'ascending' }],
            metricsByMediaId,
        }));
        expect(sortedAscending.map(media => media.title)).toEqual(['ZeroChars', 'SomeChars', 'MostChars']);

        const sortedDescending = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'totalCharacters' }, direction: 'descending' }],
            metricsByMediaId,
        }));
        expect(sortedDescending.map(media => media.title)).toEqual(['MostChars', 'SomeChars', 'ZeroChars']);
    });

    it('should sort media with no logged activity last regardless of direction when sorting by total characters', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'NeverLogged' }),
            makeMedia({ id: 2, title: 'HasChars' }),
        ];
        const metricsByMediaId: Record<number, LibraryActivityMetrics> = {
            2: { firstActivityDate: '2024-01-01', lastActivityDate: '2024-01-01', totalMinutes: 30, totalCharacters: 500 },
        };

        const sortedAscending = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'totalCharacters' }, direction: 'ascending' }],
            metricsByMediaId,
        }));
        expect(sortedAscending.map(media => media.title)).toEqual(['HasChars', 'NeverLogged']);

        const sortedDescending = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'totalCharacters' }, direction: 'descending' }],
            metricsByMediaId,
        }));
        expect(sortedDescending.map(media => media.title)).toEqual(['HasChars', 'NeverLogged']);
    });
});

describe('applyLibrarySort - tier stages', () => {
    it('should reproduce the ongoing-first / archived-last SQL CASE ranking when both switches are on', () => {
        const ongoingActive = makeMedia({ id: 1, title: 'Ongoing', status: 'Active', tracking_status: 'Ongoing' });
        const otherActive = makeMedia({ id: 2, title: 'Paused', status: 'Active', tracking_status: 'Paused' });
        const archived = makeMedia({ id: 3, title: 'Archived', status: 'Archived', tracking_status: 'Ongoing' });

        const sorted = applyLibrarySort([archived, otherActive, ongoingActive], baseSortOptions({
            keepOngoingFirst: true,
            keepArchivedLast: true,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Ongoing', 'Paused', 'Archived']);
    });

    it('should apply only the archived-last tier when ongoing-first is off', () => {
        const ongoingActive = makeMedia({ id: 1, title: 'Ongoing', status: 'Active', tracking_status: 'Ongoing' });
        const archived = makeMedia({ id: 2, title: 'Archived', status: 'Archived', tracking_status: 'Ongoing' });

        const sorted = applyLibrarySort([archived, ongoingActive], baseSortOptions({
            keepArchivedLast: true,
        }));

        expect(sorted.map(media => media.title)).toEqual(['Ongoing', 'Archived']);
    });
});
describe('applyLibrarySort - variant tiebreak', () => {
    it('should order entries sharing a title by variant, with the base entry first', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Umineko', variant: 'Manga' }),
            makeMedia({ id: 2, title: 'Umineko', variant: '' }),
            makeMedia({ id: 3, title: 'Umineko', variant: 'Anime' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'ascending' }],
        }));

        expect(sorted.map(media => media.variant)).toEqual(['', 'Anime', 'Manga']);
    });

    it('should reverse the variant order when the title sort is descending', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Umineko', variant: '' }),
            makeMedia({ id: 2, title: 'Umineko', variant: 'Manga' }),
            makeMedia({ id: 3, title: 'Umineko', variant: 'Anime' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'descending' }],
        }));

        expect(sorted.map(media => media.variant)).toEqual(['Manga', 'Anime', '']);
    });

    it('should not let the variant outrank the title', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Beta', variant: 'Anime' }),
            makeMedia({ id: 2, title: 'Alpha', variant: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'ascending' }],
        }));

        expect(sorted.map(media => media.title)).toEqual(['Alpha', 'Beta']);
    });

    it('should treat a missing variant as an empty one', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Umineko', variant: 'Manga' }),
            makeMedia({ id: 2, title: 'Umineko' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'ascending' }],
        }));

        expect(sorted.map(media => media.id)).toEqual([2, 1]);
    });

    it('should leave incoming order untouched when a non-title sort ties', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Umineko', variant: 'Manga', content_type: 'Manga' }),
            makeMedia({ id: 2, title: 'Umineko', variant: '', content_type: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [{ field: { kind: 'builtin', key: 'contentType' }, direction: 'ascending' }],
        }));

        expect(sorted.map(media => media.id)).toEqual([1, 2]);
    });

    it('should let a later stage outrank the variant tiebreak', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Higurashi', variant: '', content_type: 'Visual Novel' }),
            makeMedia({ id: 2, title: 'Higurashi', variant: 'Manga', content_type: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [
                { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
                { field: { kind: 'builtin', key: 'contentType' }, direction: 'ascending' },
            ],
        }));

        expect(sorted.map(media => media.id)).toEqual([2, 1]);
    });

    it('should fall back to the variant tiebreak when every stage ties', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Higurashi', variant: 'Manga', content_type: 'Manga' }),
            makeMedia({ id: 2, title: 'Higurashi', variant: '', content_type: 'Manga' }),
        ];

        const sorted = applyLibrarySort(mediaList, baseSortOptions({
            stages: [
                { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
                { field: { kind: 'builtin', key: 'contentType' }, direction: 'ascending' },
            ],
        }));

        expect(sorted.map(media => media.id)).toEqual([2, 1]);
    });
});

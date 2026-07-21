import { describe, expect, it } from 'vitest';
import {
    buildLibraryRows,
    flattenLibraryRows,
    groupMediaByType,
    toLibraryItemRows,
    type LibraryTypeGroup,
} from '../../src/media/sorting/library_rows';
import type { Media } from '../../src/types';

function makeMedia(overrides: Partial<Media> & { id: number }): Media {
    return {
        uid: `uid-${overrides.id}`,
        title: 'Untitled',
        media_type: 'Book',
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

describe('grouping and flattening', () => {
    it('should group media by content type in the given order, omitting empty types', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A', content_type: 'Novel' }),
            makeMedia({ id: 2, title: 'B', content_type: 'Manga' }),
            makeMedia({ id: 3, title: 'C', content_type: 'Manga' }),
        ];

        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);

        expect(groups.map(group => group.contentType)).toEqual(['Manga', 'Novel']);
        expect(groups[0].items.map(media => media.title)).toEqual(['B', 'C']);
        expect(groups[1].items.map(media => media.title)).toEqual(['A']);
    });

    it('should keep media with an empty, whitespace-only, or unrecognized content type instead of dropping it', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Empty', content_type: '' }),
            makeMedia({ id: 2, title: 'Whitespace', content_type: '   ' }),
            makeMedia({ id: 3, title: 'Legacy', content_type: 'Light Novel' }),
            makeMedia({ id: 4, title: 'Recognized', content_type: 'Manga' }),
        ];

        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);
        const allGroupedTitles = groups.flatMap(group => group.items.map(media => media.title));

        expect(allGroupedTitles).toEqual(expect.arrayContaining(['Empty', 'Whitespace', 'Legacy', 'Recognized']));
    });

    it('should render an unrecognized content type as a trailing group after the ordered ones', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Legacy', content_type: 'Light Novel' }),
            makeMedia({ id: 2, title: 'Novel item', content_type: 'Novel' }),
            makeMedia({ id: 3, title: 'Manga item', content_type: 'Manga' }),
        ];

        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);

        expect(groups.map(group => group.contentType)).toEqual(['Manga', 'Novel', 'Light Novel']);
    });

    it('should order multiple unrecognized content types alphabetically after the ordered ones', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Zebra type', content_type: 'Zebra Comics' }),
            makeMedia({ id: 2, title: 'Audio item', content_type: 'Audiobook' }),
            makeMedia({ id: 3, title: 'Manga item', content_type: 'Manga' }),
        ];

        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);

        expect(groups.map(group => group.contentType)).toEqual(['Manga', 'Audiobook', 'Zebra Comics']);
    });

    it('should treat empty and whitespace-only content types as Unknown for grouping', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Empty', content_type: '' }),
            makeMedia({ id: 2, title: 'Whitespace', content_type: '   ' }),
        ];

        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);

        expect(groups).toEqual([{ contentType: 'Unknown', items: [mediaList[0], mediaList[1]] }]);
    });

    it('should produce no header for a content type absent from the media list', () => {
        const mediaList = [makeMedia({ id: 1, title: 'A', content_type: 'Manga' })];
        const groups = groupMediaByType(mediaList, ['Manga', 'Novel', 'Visual Novel']);

        expect(groups.map(group => group.contentType)).toEqual(['Manga']);
    });

    it('should flatten groups into a header/item stream in group order', () => {
        const groups: LibraryTypeGroup[] = [
            { contentType: 'Manga', items: [makeMedia({ id: 1, title: 'A' }), makeMedia({ id: 2, title: 'B' })] },
            { contentType: 'Novel', items: [makeMedia({ id: 3, title: 'C' })] },
        ];

        const rows = flattenLibraryRows(groups);

        expect(rows).toEqual([
            { kind: 'header', contentType: 'Manga' },
            { kind: 'item', media: groups[0].items[0] },
            { kind: 'item', media: groups[0].items[1] },
            { kind: 'header', contentType: 'Novel' },
            { kind: 'item', media: groups[1].items[0] },
        ]);
    });

    it('should produce zero header rows for a flat list of item rows', () => {
        const mediaList = [makeMedia({ id: 1, title: 'A' }), makeMedia({ id: 2, title: 'B' })];
        const rows = toLibraryItemRows(mediaList);

        expect(rows.every(row => row.kind === 'item')).toBe(true);
        expect(rows.map(row => (row as { media: Media }).media.title)).toEqual(['A', 'B']);
    });
});

describe('toLibraryItemRows', () => {
    it('should wrap each media entry as an item row in the same order', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A' }),
            makeMedia({ id: 2, title: 'B' }),
        ];

        expect(toLibraryItemRows(mediaList)).toEqual([
            { kind: 'item', media: mediaList[0] },
            { kind: 'item', media: mediaList[1] },
        ]);
    });

    it('should return an empty array for an empty media list', () => {
        expect(toLibraryItemRows([])).toEqual([]);
    });
});

describe('buildLibraryRows', () => {
    it('should return grouped rows with headers when grouping is on', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A', content_type: 'Novel' }),
            makeMedia({ id: 2, title: 'B', content_type: 'Manga' }),
        ];

        const rows = buildLibraryRows(mediaList, ['Manga', 'Novel']);

        expect(rows).toEqual([
            { kind: 'header', contentType: 'Manga' },
            { kind: 'item', media: mediaList[1] },
            { kind: 'header', contentType: 'Novel' },
            { kind: 'item', media: mediaList[0] },
        ]);
    });

    it('should return flat item rows with no headers when grouping is off', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'A', content_type: 'Novel' }),
            makeMedia({ id: 2, title: 'B', content_type: 'Manga' }),
        ];

        const rows = buildLibraryRows(mediaList, null);

        expect(rows).toEqual([
            { kind: 'item', media: mediaList[0] },
            { kind: 'item', media: mediaList[1] },
        ]);
    });
});
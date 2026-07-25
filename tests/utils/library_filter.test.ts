import { describe, expect, it } from 'vitest';
import {
    filterMediaByExtraData,
    getLibraryExtraDataFacets,
    getLibraryExtraFieldValueKind,
    revalidateLibraryFilterRules,
    type LibraryFilterRule,
} from '../../src/media/filtering/library_filter';
import { buildExtraDataIndex } from '../../src/media/sorting/library_sort';
import type { Media } from '../../src/types';

function makeMedia(id: number, title: string, extraData: Record<string, string>): Media {
    return {
        id,
        uid: `uid-${id}`,
        title,
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: JSON.stringify(extraData),
        content_type: 'Visual Novel',
        tracking_status: 'Ongoing',
    };
}

describe('library extra-data facets', () => {
    it('derives valued fields and boolean tags from the current media library', () => {
        const index = buildExtraDataIndex([
            makeMedia(1, 'One', { 'Character Count': '70,000', Amazing: '' }),
            makeMedia(2, 'Two', { 'character count': '50,000', Platform: 'PS1', Favorite: '' }),
            makeMedia(3, 'Three', { Amazing: 'Yes' }),
        ]);

        expect(getLibraryExtraDataFacets(index)).toEqual({
            valuedFieldNames: ['Amazing', 'Character Count', 'Platform'],
            booleanTagNames: ['Amazing', 'Favorite'],
        });
        expect(getLibraryExtraFieldValueKind(index, 'character count')).toBe('numeric');
        expect(getLibraryExtraFieldValueKind(index, 'Platform')).toBe('text');
    });
});

describe('filterMediaByExtraData', () => {
    const mediaList = [
        makeMedia(1, 'Match', {
            'Character Count': '70,000 characters',
            Platform: 'PC / PS1',
            Amazing: '',
        }),
        makeMedia(2, 'Too short', {
            'Character Count': '50,000',
            Platform: 'PS1',
            Amazing: '',
        }),
        makeMedia(3, 'Wrong platform', {
            'Character Count': '80,000',
            Platform: 'Switch',
            Favorite: '',
        }),
        makeMedia(4, 'No valued fields', {
            Amazing: '',
        }),
    ];
    const index = buildExtraDataIndex(mediaList);

    it('ANDs numeric and case-insensitive text rules', () => {
        const rules: LibraryFilterRule[] = [
            {
                kind: 'extra',
                fieldName: 'Character Count',
                operator: 'greaterThan',
                value: '60,000',
                join: 'and',
                negated: false,
            },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'ps1',
                join: 'and',
                negated: false,
            },
        ];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['Match']);
    });

    it('supports OR across boolean tags and valued fields', () => {
        const rules: LibraryFilterRule[] = [
            { kind: 'booleanTag', tagName: 'Favorite', join: 'and', negated: false },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'PS1',
                join: 'or',
                negated: false,
            },
        ];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['Match', 'Too short', 'Wrong platform']);
    });

    it('supports NOT on either kind of rule', () => {
        const rules: LibraryFilterRule[] = [
            { kind: 'booleanTag', tagName: 'Amazing', join: 'and', negated: false },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'PS1',
                join: 'and',
                negated: true,
            },
        ];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['No valued fields']);
    });

    it('evaluates AND before OR', () => {
        const rules: LibraryFilterRule[] = [
            { kind: 'booleanTag', tagName: 'Amazing', join: 'and', negated: false },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'Switch',
                join: 'or',
                negated: false,
            },
            {
                kind: 'extra',
                fieldName: 'Character Count',
                operator: 'greaterThan',
                value: '60,000',
                join: 'and',
                negated: false,
            },
        ];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['Match', 'Too short', 'Wrong platform', 'No valued fields']);
    });

    it('requires a valued field to exist for a negative comparison operator', () => {
        const rules: LibraryFilterRule[] = [{
            kind: 'extra',
            fieldName: 'Platform',
            operator: 'notContains',
            value: 'PS1',
            join: 'and',
            negated: false,
        }];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['Wrong platform']);
    });

    it('ignores unfinished or invalid numeric rules while the user is entering a value', () => {
        const unfinished: LibraryFilterRule[] = [{
            kind: 'extra',
            fieldName: 'Character Count',
            operator: 'greaterThan',
            value: '',
            join: 'and',
            negated: false,
        }];
        const invalid: LibraryFilterRule[] = [{
            kind: 'extra',
            fieldName: 'Character Count',
            operator: 'greaterThan',
            value: 'not a number',
            join: 'and',
            negated: false,
        }];

        expect(filterMediaByExtraData(mediaList, unfinished, index)).toEqual(mediaList);
        expect(filterMediaByExtraData(mediaList, invalid, index)).toEqual(mediaList);
    });
});

describe('revalidateLibraryFilterRules', () => {
    it('canonicalizes current rules and drops fields or tags no longer present', () => {
        const index = buildExtraDataIndex([
            makeMedia(1, 'One', { Platform: 'PS1', Amazing: '' }),
        ]);

        expect(revalidateLibraryFilterRules(
            [
                {
                    kind: 'extra',
                    fieldName: 'platform',
                    operator: 'contains',
                    value: 'PS1',
                    join: 'or',
                    negated: true,
                },
                {
                    kind: 'extra',
                    fieldName: 'Gone',
                    operator: 'contains',
                    value: 'x',
                    join: 'and',
                    negated: false,
                },
                {
                    kind: 'booleanTag',
                    tagName: 'amazing',
                    join: 'and',
                    negated: false,
                },
                {
                    kind: 'booleanTag',
                    tagName: 'Gone',
                    join: 'and',
                    negated: false,
                },
            ],
            index,
        )).toEqual([
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'PS1',
                join: 'or',
                negated: true,
            },
            {
                kind: 'booleanTag',
                tagName: 'Amazing',
                join: 'and',
                negated: false,
            },
        ]);
    });

    it('resets an operator that no longer matches the field type', () => {
        const index = buildExtraDataIndex([
            makeMedia(1, 'One', { Score: '10' }),
        ]);

        expect(revalidateLibraryFilterRules(
            [{
                kind: 'extra',
                fieldName: 'Score',
                operator: 'contains',
                value: '1',
                join: 'and',
                negated: false,
            }],
            index,
        )).toEqual([
            {
                kind: 'extra',
                fieldName: 'Score',
                operator: 'greaterThan',
                value: '1',
                join: 'and',
                negated: false,
            },
        ]);
    });
});

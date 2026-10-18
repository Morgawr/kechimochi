import { describe, expect, it } from 'vitest';
import {
    appendRuleGroup,
    appendRuleToGroup,
    filterMediaByExtraData,
    getLibraryExtraDataFacets,
    getLibraryExtraFieldValueKind,
    groupLibraryFilterRules,
    removeLibraryFilterRule,
    removeLibraryFilterRuleGroup,
    revalidateLibraryFilterRules,
    stripNonNumericFilterValueCharacters,
    toggleLibraryFilterRuleJoin,
    type LibraryFilterRule,
} from '../../src/media/filtering/library_filter';
import { buildExtraDataIndex } from '../../src/media/sorting/library_sort';
import type { Media } from '../../src/types';

function tagRule(tagName: string, join: 'and' | 'or'): LibraryFilterRule {
    return { kind: 'booleanTag', tagName, join, negated: false };
}

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

    it('evaluates each OR group independently even when a group\'s first rule is not ready', () => {
        const rules: LibraryFilterRule[] = [
            { kind: 'booleanTag', tagName: 'Amazing', join: 'and', negated: false },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'PS1',
                join: 'and',
                negated: false,
            },
            {
                kind: 'extra',
                fieldName: 'Character Count',
                operator: 'greaterThan',
                value: '',
                join: 'or',
                negated: false,
            },
            {
                kind: 'extra',
                fieldName: 'Platform',
                operator: 'contains',
                value: 'Switch',
                join: 'and',
                negated: false,
            },
        ];

        expect(filterMediaByExtraData(mediaList, rules, index).map(media => media.title))
            .toEqual(['Match', 'Too short', 'Wrong platform']);
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

describe('groupLibraryFilterRules', () => {
    it('groups AND-joined rules together and starts a new group on OR', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'and'), tagRule('c', 'or'), tagRule('d', 'and')];

        expect(groupLibraryFilterRules(rules)).toEqual([
            [{ rule: rules[0], ruleIndex: 0 }, { rule: rules[1], ruleIndex: 1 }],
            [{ rule: rules[2], ruleIndex: 2 }, { rule: rules[3], ruleIndex: 3 }],
        ]);
    });

    it('treats the first rule as starting a group even when its own join is or', () => {
        const rules = [tagRule('a', 'or')];

        expect(groupLibraryFilterRules(rules)).toEqual([[{ rule: rules[0], ruleIndex: 0 }]]);
    });
});

describe('appendRuleToGroup', () => {
    it('inserts the rule right after the group\'s last rule, joined with and', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'or')];

        expect(appendRuleToGroup(rules, 0, tagRule('new', 'or'))).toEqual([
            tagRule('a', 'and'),
            tagRule('new', 'and'),
            tagRule('b', 'or'),
        ]);
    });

    it('leaves the rules unchanged for an out-of-range group index', () => {
        const rules = [tagRule('a', 'and')];

        expect(appendRuleToGroup(rules, 5, tagRule('new', 'and'))).toBe(rules);
    });
});

describe('appendRuleGroup', () => {
    it('appends the rule as a new OR-joined group at the end', () => {
        const rules = [tagRule('a', 'and')];

        expect(appendRuleGroup(rules, tagRule('new', 'and'))).toEqual([
            tagRule('a', 'and'),
            tagRule('new', 'or'),
        ]);
    });
});

describe('removeLibraryFilterRule', () => {
    it('promotes the following rule to or when the removed rule started a group', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'and'), tagRule('c', 'or'), tagRule('d', 'and')];

        expect(removeLibraryFilterRule(rules, 0)).toEqual([
            tagRule('b', 'or'),
            tagRule('c', 'or'),
            tagRule('d', 'and'),
        ]);
    });

    it('leaves later joins untouched when the removed rule did not start a group', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'and'), tagRule('c', 'or'), tagRule('d', 'and')];

        expect(removeLibraryFilterRule(rules, 1)).toEqual([
            tagRule('a', 'and'),
            tagRule('c', 'or'),
            tagRule('d', 'and'),
        ]);
    });
});

describe('toggleLibraryFilterRuleJoin', () => {
    it('splits an and-joined rule into its own OR group', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'and')];

        expect(toggleLibraryFilterRuleJoin(rules, 1)).toEqual([tagRule('a', 'and'), tagRule('b', 'or')]);
    });

    it('merges an or-joined rule back into the previous group', () => {
        const rules = [tagRule('a', 'and'), tagRule('b', 'or')];

        expect(toggleLibraryFilterRuleJoin(rules, 1)).toEqual([tagRule('a', 'and'), tagRule('b', 'and')]);
    });
});

describe('removeLibraryFilterRuleGroup', () => {
    const rules = [
        tagRule('a', 'and'), tagRule('b', 'and'),
        tagRule('c', 'or'), tagRule('d', 'and'),
        tagRule('e', 'or'), tagRule('f', 'and'),
    ];

    it('removes the first group', () => {
        expect(removeLibraryFilterRuleGroup(rules, 0)).toEqual([
            tagRule('c', 'or'), tagRule('d', 'and'),
            tagRule('e', 'or'), tagRule('f', 'and'),
        ]);
    });

    it('removes a middle group', () => {
        expect(removeLibraryFilterRuleGroup(rules, 1)).toEqual([
            tagRule('a', 'and'), tagRule('b', 'and'),
            tagRule('e', 'or'), tagRule('f', 'and'),
        ]);
    });

    it('removes the last group', () => {
        expect(removeLibraryFilterRuleGroup(rules, 2)).toEqual([
            tagRule('a', 'and'), tagRule('b', 'and'),
            tagRule('c', 'or'), tagRule('d', 'and'),
        ]);
    });

    it('leaves the rules unchanged for an out-of-range group index', () => {
        expect(removeLibraryFilterRuleGroup(rules, 5)).toBe(rules);
    });
});

describe('stripNonNumericFilterValueCharacters', () => {
    it('keeps signed decimals with a thousands separator', () => {
        expect(stripNonNumericFilterValueCharacters('-1,500.5')).toBe('-1,500.5');
    });

    it('strips letters and spaces', () => {
        expect(stripNonNumericFilterValueCharacters('1 500 characters')).toBe('1500');
    });
});

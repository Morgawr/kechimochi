import { describe, expect, it } from 'vitest';
import {
    fromSortFieldOptionValue,
    parseLibrarySortStages,
    reconcileEnumOrder,
    serializeLibrarySortStages,
    toSortFieldOptionValue,
} from '../../src/media/sorting/sort_settings';
import type { LibrarySortStage } from '../../src/media/sorting/library_sort';

describe('toSortFieldOptionValue / fromSortFieldOptionValue', () => {
    it('should round-trip a builtin field', () => {
        const value = toSortFieldOptionValue({ kind: 'builtin', key: 'title' });
        expect(fromSortFieldOptionValue(value, [])).toEqual({ kind: 'builtin', key: 'title' });
    });

    it('should round-trip an extra field name containing a colon', () => {
        const fieldName = 'weird:name';
        const value = toSortFieldOptionValue({ kind: 'extra', fieldName });
        expect(fromSortFieldOptionValue(value, [fieldName])).toEqual({ kind: 'extra', fieldName });
    });

    it('should round-trip an extra field literally named title without colliding with the builtin', () => {
        const value = toSortFieldOptionValue({ kind: 'extra', fieldName: 'title' });
        expect(value).toBe('extra:title');
        expect(fromSortFieldOptionValue(value, ['title'])).toEqual({ kind: 'extra', fieldName: 'title' });
    });

    it('should reject an unknown builtin key', () => {
        expect(fromSortFieldOptionValue('builtin:notReal', [])).toBeNull();
    });

    it('should reject an extra field not present in the available names', () => {
        expect(fromSortFieldOptionValue('extra:missing', ['present'])).toBeNull();
    });

    it('should resolve an extra field case-insensitively and re-canonicalize to the current casing', () => {
        expect(fromSortFieldOptionValue('extra:jiten difficulty', ['Jiten Difficulty']))
            .toEqual({ kind: 'extra', fieldName: 'Jiten Difficulty' });
    });
});

describe('serialize/parse library sort stages', () => {
    it('should round-trip a list of stages', () => {
        const stages: LibrarySortStage[] = [
            { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
            { field: { kind: 'extra', fieldName: 'Jiten Difficulty' }, direction: 'descending' },
        ];

        const serialized = serializeLibrarySortStages(stages);
        expect(parseLibrarySortStages(serialized, ['Jiten Difficulty'])).toEqual(stages);
    });

    it('should persist the field structurally rather than as a flat string', () => {
        const stages: LibrarySortStage[] = [
            { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
        ];

        const serialized = serializeLibrarySortStages(stages);
        expect(JSON.parse(serialized)).toEqual([
            { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
        ]);
    });

    it('should drop stages referencing an extra field that is no longer available', () => {
        const stages: LibrarySortStage[] = [
            { field: { kind: 'builtin', key: 'title' }, direction: 'ascending' },
            { field: { kind: 'extra', fieldName: 'Gone' }, direction: 'descending' },
        ];

        const serialized = serializeLibrarySortStages(stages);
        expect(parseLibrarySortStages(serialized, [])).toEqual([stages[0]]);
    });

    it('should reject a stage with an unknown builtin key', () => {
        const serialized = JSON.stringify([
            { field: { kind: 'builtin', key: 'notReal' }, direction: 'ascending' },
        ]);
        expect(parseLibrarySortStages(serialized, [])).toEqual([]);
    });

    it('should reject a stage whose direction is not ascending or descending', () => {
        const serialized = JSON.stringify([
            { field: { kind: 'builtin', key: 'title' }, direction: 'sideways' },
        ]);
        expect(parseLibrarySortStages(serialized, [])).toEqual([]);
    });

    it('should resolve a stored extra field case-insensitively and re-canonicalize to the current casing', () => {
        const serialized = JSON.stringify([
            { field: { kind: 'extra', fieldName: 'jiten difficulty' }, direction: 'ascending' },
        ]);
        expect(parseLibrarySortStages(serialized, ['Jiten Difficulty'])).toEqual([
            { field: { kind: 'extra', fieldName: 'Jiten Difficulty' }, direction: 'ascending' },
        ]);
    });

    it('should return an empty array for malformed JSON', () => {
        expect(parseLibrarySortStages('not json', [])).toEqual([]);
    });
});

describe('reconcileEnumOrder', () => {
    const declarationOrder = ['Anime', 'Manga', 'Novel', 'Unknown'] as const;

    it('should resolve to the declaration order verbatim when the saved value is unset', () => {
        expect(reconcileEnumOrder(null, declarationOrder)).toEqual([...declarationOrder]);
        expect(reconcileEnumOrder(undefined, declarationOrder)).toEqual([...declarationOrder]);
    });

    it('should resolve to the declaration order verbatim when the saved value is invalid JSON', () => {
        expect(reconcileEnumOrder('not json', declarationOrder)).toEqual([...declarationOrder]);
    });

    it('should resolve to the declaration order verbatim when the saved value is not an array', () => {
        expect(reconcileEnumOrder('{"foo":"bar"}', declarationOrder)).toEqual([...declarationOrder]);
    });

    it('should keep the saved relative order for known values', () => {
        const saved = JSON.stringify(['Novel', 'Anime', 'Manga', 'Unknown']);
        expect(reconcileEnumOrder(saved, declarationOrder)).toEqual(['Novel', 'Anime', 'Manga', 'Unknown']);
    });

    it('should append missing values in declaration order after the saved order', () => {
        const saved = JSON.stringify(['Novel', 'Anime']);
        expect(reconcileEnumOrder(saved, declarationOrder)).toEqual(['Novel', 'Anime', 'Manga', 'Unknown']);
    });

    it('should drop saved values no longer present in the declaration order', () => {
        const saved = JSON.stringify(['Light Novel', 'Novel', 'Anime']);
        expect(reconcileEnumOrder(saved, declarationOrder)).toEqual(['Novel', 'Anime', 'Manga', 'Unknown']);
    });

    it('should drop duplicate entries in the saved order', () => {
        const saved = JSON.stringify(['Novel', 'Novel', 'Anime']);
        expect(reconcileEnumOrder(saved, declarationOrder)).toEqual(['Novel', 'Anime', 'Manga', 'Unknown']);
    });
});
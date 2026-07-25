import { describe, expect, it } from 'vitest';
import { getCharacterCountFromExtraData, getExtraDataValue, mergeExtraData, normalizeExtraData, renameExtraDataKey, upsertExtraDataValue } from '../../src/extra_data';

describe('extra_data utils', () => {
    it('should find extra data values case-insensitively', () => {
        expect(getExtraDataValue({ 'Character Count': '10,000' }, 'character count')).toBe('10,000');
    });

    it('should resolve duplicate keys using the normalized latest value', () => {
        expect(getExtraDataValue({ 'Character count': '100', 'character COUNT': '200' }, 'character count')).toBe('200');
    });

    it('should parse character counts case-insensitively', () => {
        expect(getCharacterCountFromExtraData({ 'CHARACTER COUNT': '10,000' })).toBe(10000);
    });

    it('should return null for invalid character counts', () => {
        expect(getCharacterCountFromExtraData({ 'Character count': 'abc' })).toBeNull();
    });

    it('should normalize duplicate keys case-insensitively while keeping the first casing', () => {
        expect(normalizeExtraData({ 'Character count': '100', 'character COUNT': '200' })).toEqual({ 'Character count': '200' });
    });

    it('should normalize non-string JSON values without throwing', () => {
        expect(normalizeExtraData({
            Count: 42,
            Enabled: true,
            Nested: { value: 1 },
            Empty: null,
        })).toEqual({
            Count: '42',
            Enabled: 'true',
            Nested: '{"value":1}',
            Empty: '',
        });
    });

    it('should normalize unserializable objects without default object stringification', () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;

        expect(normalizeExtraData({ Circular: circular })).toEqual({ Circular: '' });
    });

    it('should treat prototype-like keys as ordinary data', () => {
        const input = JSON.parse('{"__proto__":"safe","constructor":"also safe"}');
        const normalized = normalizeExtraData(input);

        expect(normalized['__proto__']).toBe('safe');
        expect(normalized.constructor).toBe('also safe');
        expect(Object.getPrototypeOf(normalized)).toBeNull();
    });

    it('should upsert duplicate keys without adding a second entry', () => {
        expect(upsertExtraDataValue({ 'Author': 'Writer' }, 'author', 'Rewriter')).toEqual({ 'Author': 'Rewriter' });
    });

    it('should allow renaming a key casing variant', () => {
        expect(renameExtraDataKey({ 'author': 'Writer' }, 'author', 'Author')).toEqual({ 'Author': 'Writer' });
    });

    it('should merge updates case-insensitively', () => {
        expect(mergeExtraData({ 'Genre': 'Old' }, { 'genre': 'New' })).toEqual({ 'Genre': 'New' });
    });
});

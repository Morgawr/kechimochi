import { describe, it, expect } from 'vitest';
import * as countFormatting from '../../src/counts/count_formatting';

describe('count_formatting.ts', () => {
    describe('formatCount', () => {
        it('should use the singular noun for exactly one', () => {
            expect(countFormatting.formatCount(1, 'char')).toBe('1 char');
            expect(countFormatting.formatCount(1, 'session')).toBe('1 session');
        });

        it('should pluralize and group every other value', () => {
            expect(countFormatting.formatCount(0, 'char')).toBe('0 chars');
            expect(countFormatting.formatCount(2, 'day')).toBe('2 days');
            expect(countFormatting.formatCount(92431, 'char')).toBe('92,431 chars');
        });
    });

    describe('formatOptionalCount', () => {
        it('should format a positive value', () => {
            expect(countFormatting.formatOptionalCount(4200, 'char')).toBe('4,200 chars');
        });

        it('should render nothing at zero', () => {
            expect(countFormatting.formatOptionalCount(0, 'char')).toBe('');
        });
    });

    describe('formatOptionalNumber', () => {
        it('should group a positive value without a unit noun', () => {
            expect(countFormatting.formatOptionalNumber(92431)).toBe('92,431');
        });

        it('should render nothing at zero', () => {
            expect(countFormatting.formatOptionalNumber(0)).toBe('');
        });
    });
});
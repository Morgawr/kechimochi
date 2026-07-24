import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../src/time/duration_parsing';

const parsedMinutes = (rawInput: string): number | null => {
    const result = parseDuration(rawInput);
    return result.status === 'parsed' ? result.minutes : null;
};

describe('duration_parsing.ts', () => {
    describe('parseDuration', () => {
        it('should parse empty input as 0 minutes', () => {
            expect(parsedMinutes('')).toBe(0);
            expect(parsedMinutes('   ')).toBe(0);
        });

        it('should parse a bare number as minutes', () => {
            expect(parsedMinutes('0')).toBe(0);
            expect(parsedMinutes('18')).toBe(18);
            expect(parsedMinutes('120')).toBe(120);
        });

        it('should trim surrounding whitespace around a bare number', () => {
            expect(parsedMinutes('  18  ')).toBe(18);
        });

        it('should parse a single unit', () => {
            expect(parsedMinutes('2h')).toBe(120);
            expect(parsedMinutes('90m')).toBe(90);
            expect(parsedMinutes('1d')).toBe(1440);
            expect(parsedMinutes('45s')).toBe(1);
            expect(parsedMinutes('15s')).toBe(0);
            expect(parsedMinutes('30s')).toBe(1);
        });

        it('should parse combined units regardless of spacing', () => {
            expect(parsedMinutes('4h30m')).toBe(270);
            expect(parsedMinutes('2h 15m')).toBe(135);
            expect(parsedMinutes('1d2h 30m4s')).toBe(1590);
            expect(parsedMinutes('2h 15m 30s')).toBe(136);
        });

        it('should read a trailing unitless number as minutes', () => {
            expect(parsedMinutes('1h30')).toBe(90);
            expect(parsedMinutes('1h 30')).toBe(90);
            expect(parsedMinutes('2h 15')).toBe(135);
            expect(parsedMinutes('1d2h30')).toBe(1590);
        });

        it('should reject a trailing unitless number when minutes are already given', () => {
            expect(parsedMinutes('2h15m3')).toBeNull();
        });

        it('should reject anything following a trailing unitless number', () => {
            expect(parsedMinutes('2h 15 30')).toBeNull();
            expect(parsedMinutes('1 2m')).toBeNull();
        });

        it('should parse units case-insensitively', () => {
            expect(parsedMinutes('2H15M')).toBe(135);
            expect(parsedMinutes('1D')).toBe(1440);
        });

        it('should reject the min unit', () => {
            expect(parsedMinutes('4h30min')).toBeNull();
        });

        it('should reject a number separated from its unit by whitespace', () => {
            expect(parsedMinutes('2 h')).toBeNull();
        });

        it('should reject a dash-separated range', () => {
            expect(parsedMinutes('15-20')).toBeNull();
        });

        it('should reject a clock-formatted time', () => {
            expect(parsedMinutes('12:20')).toBeNull();
        });

        it('should reject a negative number', () => {
            expect(parsedMinutes('-1')).toBeNull();
        });

        it('should reject a decimal number', () => {
            expect(parsedMinutes('1.5h')).toBeNull();
        });

        it('should reject non-numeric input', () => {
            expect(parsedMinutes('abc')).toBeNull();
        });

        it('should reject a repeated unit', () => {
            expect(parsedMinutes('2h2h')).toBeNull();
        });

        it('should reject a unit letter with no number', () => {
            expect(parsedMinutes('h')).toBeNull();
        });

        it('should reject an unrecognized unit letter', () => {
            expect(parsedMinutes('2x')).toBeNull();
        });

        it('should reject scientific notation', () => {
            expect(parsedMinutes('1e3')).toBeNull();
        });

        it('should accept large durations', () => {
            expect(parsedMinutes('1000001')).toBe(1000001);
            expect(parsedMinutes('9999d')).toBe(9999 * 24 * 60);
        });

        it('should report notation mistakes as unrecognized', () => {
            expect(parseDuration('abc')).toEqual({ status: 'unrecognized' });
            expect(parseDuration('12:20')).toEqual({ status: 'unrecognized' });
        });

        it('should report values beyond safe integer precision as too large', () => {
            expect(parseDuration('99999999999999999999')).toEqual({ status: 'tooLarge' });
            expect(parseDuration('99999999999999d')).toEqual({ status: 'tooLarge' });
        });

        it('should report a digit run too long to tokenize as unrecognized', () => {
            expect(parseDuration('99999999999999999999d')).toEqual({ status: 'unrecognized' });
        });
    });
});
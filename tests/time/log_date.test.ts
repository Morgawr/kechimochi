import { describe, it, expect } from 'vitest';
import {
    canonicalAnchor,
    logDateKey,
    effectiveEnd,
    isContainedInBucket,
    formatReducedDate,
    formatLogDate,
    type DateAnchor,
    type DateScope,
} from '../../src/time';

describe('log_date.ts', () => {
    describe('canonicalAnchor', () => {
        it.each<[string, DateScope, string]>([
            // Narrowing a full anchor to a coarser scope.
            ['2026-08-17', 'day', '2026-08-17'],
            ['2026-08-17', 'month', '2026-08-01'],
            ['2026-08-17', 'year', '2026-01-01'],
            // Narrowing a month key to a coarser or equal scope.
            ['2026-08', 'month', '2026-08-01'],
            ['2026-08', 'year', '2026-01-01'],
            // Widening: no month/day in the input, so both default to the 1st.
            ['2026-08', 'day', '2026-08-01'],
            ['2019', 'day', '2019-01-01'],
            ['2019', 'month', '2019-01-01'],
            ['2019', 'year', '2019-01-01'],
        ])('canonicalAnchor(%s, %s) -> %s', (input, scope, expected) => {
            expect(canonicalAnchor(input, scope)).toBe(expected);
        });

        it('should be the identity function for an already-canonical day anchor', () => {
            expect(canonicalAnchor('2026-08-01', 'day')).toBe('2026-08-01');
        });
    });

    describe('logDateKey', () => {
        it('should return the full date for a day-precision log', () => {
            expect(logDateKey({ date: '2026-08-17', date_precision: 'day' })).toBe('2026-08-17');
        });

        it('should return the year-month prefix for a month-precision log', () => {
            expect(logDateKey({ date: '2026-08-01', date_precision: 'month' })).toBe('2026-08');
        });

        it('should return the year prefix for a year-precision log', () => {
            expect(logDateKey({ date: '2026-01-01', date_precision: 'year' })).toBe('2026');
        });
    });

    describe('effectiveEnd', () => {
        it('should equal the anchor for a day-precision log', () => {
            expect(effectiveEnd({ date: '2026-08-17', date_precision: 'day' })).toBe('2026-08-17');
        });

        it('should compute the last day of the month for a month-precision log', () => {
            expect(effectiveEnd({ date: '2026-08-01', date_precision: 'month' })).toBe('2026-08-31');
            expect(effectiveEnd({ date: '2026-02-01', date_precision: 'month' })).toBe('2026-02-28');
        });

        it('should stay in the first century instead of mapping onto the 1900s', () => {
            expect(effectiveEnd({ date: '0050-03-01', date_precision: 'month' })).toBe('0050-03-31');
            expect(effectiveEnd({ date: '0050-01-01', date_precision: 'year' })).toBe('0050-12-31');
            expect(effectiveEnd({ date: '0001-01-01', date_precision: 'year' })).toBe('0001-12-31');
        });

        it('should compute the last day of a leap-year February for a month-precision log', () => {
            expect(effectiveEnd({ date: '2024-02-01', date_precision: 'month' })).toBe('2024-02-29');
        });

        it('should not drift when the anchor is not truncated to the 1st', () => {
            expect(effectiveEnd({ date: '2024-01-31', date_precision: 'month' })).toBe('2024-01-31');
            expect(effectiveEnd({ date: '2023-04-15', date_precision: 'month' })).toBe('2023-04-30');
        });

        it('should compute the last day of the year for a year-precision log', () => {
            expect(effectiveEnd({ date: '2026-06-15', date_precision: 'year' })).toBe('2026-12-31');
        });

        it('should fall back to 9999-12-31 when a year rolls over past the representable range', () => {
            expect(effectiveEnd({ date: '9999-12-01', date_precision: 'month' })).toBe('9999-12-31');
            expect(effectiveEnd({ date: '9999-01-01', date_precision: 'year' })).toBe('9999-12-31');
        });
    });

    describe('isContainedInBucket', () => {
        it('should contain a log whose key starts with the bucket key', () => {
            expect(isContainedInBucket({ date: '2026-08-03', date_precision: 'day' }, '2026-08')).toBe(true);
            expect(isContainedInBucket({ date: '2026-08-01', date_precision: 'month' }, '2026')).toBe(true);
        });

        it('should not contain a log whose key does not start with the bucket key', () => {
            expect(isContainedInBucket({ date: '2026-09-03', date_precision: 'day' }, '2026-08')).toBe(false);
        });

        it('should not contain a log coarser than the bucket', () => {
            expect(isContainedInBucket({ date: '2026-01-01', date_precision: 'year' }, '2026-08')).toBe(false);
        });
    });

    describe('formatReducedDate', () => {
        it('should format a day-precision key in UTC', () => {
            expect(formatReducedDate('2026-08-03')).toBe('August 3, 2026');
        });

        it('should format a month-precision key in UTC', () => {
            expect(formatReducedDate('2026-08')).toBe('August 2026');
        });

        it('should format a year-precision key as-is', () => {
            expect(formatReducedDate('2026')).toBe('2026');
        });

        it('should not shift a day near a timezone boundary', () => {
            // A local-zone formatter would render this a day earlier west of UTC.
            expect(formatReducedDate('2026-01-01')).toBe('January 1, 2026');
            expect(formatReducedDate('2026-12-31')).toBe('December 31, 2026');
        });

        it('should throw on an unrecognized length', () => {
            expect(() => formatReducedDate('2026-08-0')).toThrow();
        });
    });

    describe('formatLogDate', () => {
        it('should format each precision through logDateKey', () => {
            expect(formatLogDate({ date: '2026-08-03', date_precision: 'day' })).toBe('August 3, 2026');
            expect(formatLogDate({ date: '2026-08-01', date_precision: 'month' })).toBe('August 2026');
            expect(formatLogDate({ date: '2026-01-01', date_precision: 'year' })).toBe('2026');
        });
    });

    it('canonicalAnchor should still satisfy DateAnchor callers without a further cast', () => {
        const anchor: DateAnchor = canonicalAnchor('2019', 'day');
        expect(anchor).toBe('2019-01-01');
    });
});

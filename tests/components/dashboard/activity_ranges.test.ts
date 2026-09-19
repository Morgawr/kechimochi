import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ACTIVITY_TIME_RANGES,
    buildAllTimeRangeSeeds,
    getActivityRange,
    getDashboardBucket,
    getOffsetForDate,
    getUtcWeekStart,
} from '../../../src/dashboard/activity_ranges';

describe('getActivityRange — monthly', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('produces one daily bucket for every day in a 30-day month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toEqual(Array.from(
            { length: 30 },
            (_, index) => `2026-06-${String(index + 1).padStart(2, '0')}`,
        ));
        expect(range.unit).toBe('day');
        expect(range.period).toBe('month');
    });

    it('maps June 2026 dates to correct bucket indexes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.getBucketIndex('2026-06-01')).toBe(0);
        expect(range.getBucketIndex('2026-06-07')).toBe(6);
        expect(range.getBucketIndex('2026-06-08')).toBe(7);
        expect(range.getBucketIndex('2026-06-14')).toBe(13);
        expect(range.getBucketIndex('2026-06-30')).toBe(29);
        expect(range.getBucketIndex('2026-05-31')).toBe(-1);
        expect(range.getBucketIndex('2026-07-01')).toBe(-1);
    });

    it('produces 31 daily buckets for a 31-day month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toHaveLength(31);
        expect(range.labels[0]).toBe('2026-07-01');
        expect(range.labels[30]).toBe('2026-07-31');
        expect(range.getBucketIndex('2026-07-31')).toBe(30);
    });

    it('produces 28 daily buckets for February in a common year', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toHaveLength(28);
        expect(range.labels[27]).toBe('2026-02-28');
        expect(range.getBucketIndex('2026-02-28')).toBe(27);
    });

    it('produces 29 daily buckets for February in a leap year', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-02-15T12:00:00'));

        const range = getActivityRange(ACTIVITY_TIME_RANGES.MONTHLY, 0);

        expect(range.labels).toHaveLength(29);
        expect(range.labels[28]).toBe('2024-02-29');
        expect(range.getBucketIndex('2024-02-29')).toBe(28);
    });
});

describe('getUtcWeekStart', () => {
    it('rolls a mid-week date back to a Monday week start', () => {
        // 2026-06-10 is a Wednesday.
        expect(getUtcWeekStart('2026-06-10', 1)).toBe(Date.UTC(2026, 5, 8));
    });

    it('leaves a date that already is the week start unchanged', () => {
        expect(getUtcWeekStart('2026-06-08', 1)).toBe(Date.UTC(2026, 5, 8));
    });

    it('honours a Sunday week start', () => {
        // 2026-06-10 is a Wednesday; the preceding Sunday is 2026-06-07.
        expect(getUtcWeekStart('2026-06-10', 0)).toBe(Date.UTC(2026, 5, 7));
    });

    it('falls back an out-of-range week start day to Monday', () => {
        expect(getUtcWeekStart('2026-06-10', 9)).toBe(getUtcWeekStart('2026-06-10', 1));
    });
});

describe('getOffsetForDate', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts whole months back for the Monthly range', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        expect(getOffsetForDate('2026-06-01', ACTIVITY_TIME_RANGES.MONTHLY, 1)).toBe(0);
        expect(getOffsetForDate('2026-04-30', ACTIVITY_TIME_RANGES.MONTHLY, 1)).toBe(2);
    });

    it('counts whole years back for the Yearly range', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        expect(getOffsetForDate('2026-01-01', ACTIVITY_TIME_RANGES.YEARLY, 1)).toBe(0);
        expect(getOffsetForDate('2023-12-31', ACTIVITY_TIME_RANGES.YEARLY, 1)).toBe(3);
    });

    it('counts whole weeks back by default, honouring the week start day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        expect(getOffsetForDate('2026-06-08', ACTIVITY_TIME_RANGES.WEEKLY, 1)).toBe(0);
        expect(getOffsetForDate('2026-06-01', ACTIVITY_TIME_RANGES.WEEKLY, 1)).toBe(1);
    });

    it('never returns a negative offset for a future date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));

        expect(getOffsetForDate('2026-07-01', ACTIVITY_TIME_RANGES.MONTHLY, 1)).toBe(0);
        expect(getOffsetForDate('2027-01-01', ACTIVITY_TIME_RANGES.YEARLY, 1)).toBe(0);
    });
});

describe('buildAllTimeRangeSeeds', () => {
    it('seeds one dated entry per year the profile covers, inclusive', () => {
        const seeds = buildAllTimeRangeSeeds('2023-05-01', '2026-02-01');

        expect(seeds.map(seed => seed.date)).toEqual([
            '2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01',
        ]);
        expect(seeds.every(seed => seed.duration_minutes === 0 && seed.characters === 0)).toBe(true);
    });

    it('seeds a single entry when the profile spans one year', () => {
        expect(buildAllTimeRangeSeeds('2026-03-01', '2026-11-01').map(seed => seed.date))
            .toEqual(['2026-01-01']);
    });

    it('returns no seeds when either bound is missing', () => {
        expect(buildAllTimeRangeSeeds(null, '2026-01-01')).toEqual([]);
        expect(buildAllTimeRangeSeeds('2026-01-01', null)).toEqual([]);
        expect(buildAllTimeRangeSeeds(null, null)).toEqual([]);
    });
});

describe('getDashboardBucket', () => {
    it('maps day and month units through unchanged', () => {
        expect(getDashboardBucket('day')).toBe('day');
        expect(getDashboardBucket('month')).toBe('month');
    });

    it('maps year, and any other unit, to year', () => {
        expect(getDashboardBucket('year')).toBe('year');
        expect(getDashboardBucket('week')).toBe('year');
    });
});

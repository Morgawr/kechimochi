import { describe, it, expect, vi, afterEach } from 'vitest';
import { getActivityRange, ACTIVITY_TIME_RANGES } from '../../../src/dashboard/activity_ranges';

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

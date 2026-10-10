import { describe, it, expect } from 'vitest';
import * as timelineBuckets from '../src/timeline/timeline_buckets';
import type { TimelineBucket } from '../src/types';

function buildBucket(overrides: Partial<TimelineBucket> = {}): TimelineBucket {
    return {
        key: '2024-03',
        startDate: '2024-03-01',
        startedCount: 0,
        finishedCount: 0,
        pausedCount: 0,
        droppedCount: 0,
        milestoneCount: 0,
        loggedMinutes: 0,
        loggedCharacters: 0,
        highlights: [],
        distinctMediaCount: 0,
        ...overrides,
    };
}

describe('timeline_buckets.ts', () => {
    describe('getTimelineBucketKindCounts', () => {
        it('should keep zero counts', () => {
            const bucket = buildBucket({ startedCount: 6, finishedCount: 2, milestoneCount: 3 });
            expect(timelineBuckets.getTimelineBucketKindCounts(bucket)).toEqual([
                { kind: 'started', count: 6, noun: 'started', label: '6 started' },
                { kind: 'finished', count: 2, noun: 'completed', label: '2 completed' },
                { kind: 'paused', count: 0, noun: 'paused', label: '0 paused' },
                { kind: 'dropped', count: 0, noun: 'dropped', label: '0 dropped' },
                { kind: 'milestone', count: 3, noun: 'milestones', label: '3 milestones' },
            ]);
        });

        it('should singularize the milestone label at a count of one', () => {
            const bucket = buildBucket({ milestoneCount: 1 });
            expect(timelineBuckets.getTimelineBucketKindCounts(bucket).at(-1)).toEqual(
                { kind: 'milestone', count: 1, noun: 'milestone', label: '1 milestone' },
            );
        });

        it('should list every kind in a stable order', () => {
            expect(timelineBuckets.getTimelineBucketKindCounts(buildBucket()).map(entry => entry.kind)).toEqual([
                'started',
                'finished',
                'paused',
                'dropped',
                'milestone',
            ]);
        });
    });

    describe('getTimelineBucketTotals', () => {
        it('should return logged time and characters separately', () => {
            const bucket = buildBucket({ loggedMinutes: 860, loggedCharacters: 92431 });
            expect(timelineBuckets.getTimelineBucketTotals(bucket))
                .toEqual({ time: '14h 20m', characters: '92,431 chars' });
        });

        it('should return empty values for an empty bucket', () => {
            expect(timelineBuckets.getTimelineBucketTotals(buildBucket())).toEqual({ time: '', characters: '' });
        });

        it('should leave characters empty when only time is logged', () => {
            const bucket = buildBucket({ loggedMinutes: 120, loggedCharacters: 0 });
            expect(timelineBuckets.getTimelineBucketTotals(bucket)).toEqual({ time: '2h 00m', characters: '' });
        });

        it('should leave time empty when only characters are logged', () => {
            const bucket = buildBucket({ loggedMinutes: 0, loggedCharacters: 4200 });
            expect(timelineBuckets.getTimelineBucketTotals(bucket)).toEqual({ time: '', characters: '4,200 chars' });
        });

        it('should use the singular noun for a single character', () => {
            const bucket = buildBucket({ loggedMinutes: 0, loggedCharacters: 1 });
            expect(timelineBuckets.getTimelineBucketTotals(bucket).characters).toBe('1 char');
        });
    });

    describe('formatTimelineBucketCoverOverflowLabel', () => {
        it('should format a positive overflow as an added title count when a cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(12, true)).toBe('+12 titles');
        });

        it('should return null when there is no overflow, whether or not a cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(0, true)).toBeNull();
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(0, false)).toBeNull();
        });

        it('should spell out the title count without a plus when no cover is visible', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(7, false)).toBe('7 titles');
        });

        it('should singularize the title count at a count of one', () => {
            expect(timelineBuckets.formatTimelineBucketCoverOverflowLabel(1, true)).toBe('+1 title');
        });
    });

    describe('getTimelineBucketCoverColumnCount', () => {
        it('should fit as many minimum-width covers as the row holds, gaps included', () => {
            expect(timelineBuckets.getTimelineBucketCoverColumnCount(410, 64, 8)).toBe(5);
        });

        it('should count a cover that fits exactly without a trailing gap', () => {
            expect(timelineBuckets.getTimelineBucketCoverColumnCount(352, 64, 8)).toBe(5);
        });

        it('should keep one column in a row narrower than a single cover', () => {
            expect(timelineBuckets.getTimelineBucketCoverColumnCount(40, 64, 8)).toBe(1);
        });

        it('should fall back to one column when the minimum width is unknown', () => {
            expect(timelineBuckets.getTimelineBucketCoverColumnCount(410, 0, 0)).toBe(1);
        });
    });

    describe('fitTimelineBucketCovers', () => {
        const baseFit = {
            perRow: 7,
            maxRows: 1,
            renderedCount: 7,
            distinctMediaCount: 7,
        };

        it('should show every cover when they all fit', () => {
            expect(timelineBuckets.fitTimelineBucketCovers(baseFit)).toEqual({
                visibleCount: 7,
                overflowCount: 0,
            });
        });

        it('should give up a slot to the overflow tile when the row is full', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({ ...baseFit, perRow: 4 }),
            ).toEqual({ visibleCount: 3, overflowCount: 4 });
        });

        it('should fit twice as many covers across two rows', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({
                    ...baseFit,
                    perRow: 4,
                    maxRows: 2,
                }),
            ).toEqual({ visibleCount: 7, overflowCount: 0 });
        });

        it('should count media the backend never sent as overflow', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({
                    ...baseFit,
                    renderedCount: 7,
                    distinctMediaCount: 30,
                }),
            ).toEqual({ visibleCount: 6, overflowCount: 24 });
        });

        it('should keep at least one cover in an impossibly narrow card', () => {
            expect(
                timelineBuckets.fitTimelineBucketCovers({ ...baseFit, perRow: 1 }),
            ).toEqual({ visibleCount: 1, overflowCount: 6 });
        });
    });

    describe('formatTimelineBucketLabel', () => {
        it('should format a month bucket as its full month name', () => {
            const bucket = buildBucket({ key: '2024-03', startDate: '2024-03-01' });
            expect(timelineBuckets.formatTimelineBucketLabel(bucket, 'month')).toBe('March');
        });

        it('should format a year bucket as its bare key', () => {
            const bucket = buildBucket({ key: '2024', startDate: '2024-01-01' });
            expect(timelineBuckets.formatTimelineBucketLabel(bucket, 'year')).toBe('2024');
        });
    });
});
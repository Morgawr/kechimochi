import { describe, it, expect } from 'vitest';
import { aggregateTimeByCategory, formatDurationHm } from '../../../src/profile/reportcard/report_card_data';
import type { ActivitySummary, Media } from '../../../src/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function buildMedia(overrides: Partial<Media> = {}): Media {
    return {
        id: 1,
        uid: 'uid-1',
        title: 'Title',
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'ja',
        description: '',
        cover_image: '',
        extra_data: '',
        content_type: 'Novel',
        tracking_status: '',
        ...overrides,
    };
}

function buildLog(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
    return {
        id: 1,
        media_id: 1,
        title: 'Title',
        activity_type: 'Reading',
        duration_minutes: 60,
        characters: 0,
        date: '2024-03-31',
        language: 'ja',
        ...overrides,
    };
}

// ── aggregateTimeByCategory: activity ─────────────────────────────────────────

describe('aggregateTimeByCategory (activity)', () => {
    it('sums minutes per activity type, sorted descending', () => {
        const logs = [
            buildLog({ media_id: 1, activity_type: 'Reading', duration_minutes: 100 }),
            buildLog({ media_id: 2, activity_type: 'Watching', duration_minutes: 50 }),
            buildLog({ media_id: 1, activity_type: 'Reading', duration_minutes: 20 }),
        ];
        const slices = aggregateTimeByCategory(logs, [], 'activity');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 120, percent: 71 },
            { label: 'Watching', minutes: 50, percent: 29 },
        ]);
    });

    it('drops "None" and empty activity buckets', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 60 }),
            buildLog({ activity_type: 'None', duration_minutes: 999 }),
            buildLog({ activity_type: '', duration_minutes: 999 }),
        ];
        const slices = aggregateTimeByCategory(logs, [], 'activity');
        expect(slices.map(slice => slice.label)).toEqual(['Reading']);
    });

    it('uses log.activity_type and does not require the media list', () => {
        const logs = [buildLog({ activity_type: 'Listening', duration_minutes: 30 })];
        const slices = aggregateTimeByCategory(logs, [], 'activity');
        expect(slices).toEqual([{ label: 'Listening', minutes: 30, percent: 100 }]);
    });

    it('drops zero-minute buckets', () => {
        const logs = [buildLog({ activity_type: 'Reading', duration_minutes: 0 })];
        expect(aggregateTimeByCategory(logs, [], 'activity')).toEqual([]);
    });
});

// ── aggregateTimeByCategory: content ──────────────────────────────────────────

describe('aggregateTimeByCategory (content)', () => {
    it('groups by the joined media content_type', () => {
        const media = [
            buildMedia({ id: 1, content_type: 'Manga' }),
            buildMedia({ id: 2, content_type: 'Visual Novel' }),
        ];
        const logs = [
            buildLog({ media_id: 1, duration_minutes: 90 }),
            buildLog({ media_id: 2, duration_minutes: 30 }),
        ];
        const slices = aggregateTimeByCategory(logs, media, 'content');
        expect(slices).toEqual([
            { label: 'Manga', minutes: 90, percent: 75 },
            { label: 'Visual Novel', minutes: 30, percent: 25 },
        ]);
    });

    it('falls back to default_activity_type then "Unknown" when content_type is absent', () => {
        const media = [
            buildMedia({ id: 1, content_type: '', default_activity_type: 'Reading' }),
        ];
        const logs = [
            buildLog({ media_id: 1, activity_type: 'Reading', duration_minutes: 10 }),
            buildLog({ media_id: 99, activity_type: '', duration_minutes: 5 }),
        ];
        const slices = aggregateTimeByCategory(logs, media, 'content');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 10, percent: 67 },
            { label: 'Unknown', minutes: 5, percent: 33 },
        ]);
    });

    it('keeps five categories as-is without an "Other" bucket', () => {
        const media = Array.from({ length: 5 }, (_unused, index) =>
            buildMedia({ id: index + 1, content_type: `Type${index + 1}` }));
        const logs = media.map((_entry, index) =>
            buildLog({ media_id: index + 1, duration_minutes: (5 - index) * 10 }));
        const slices = aggregateTimeByCategory(logs, media, 'content');
        expect(slices).toHaveLength(5);
        expect(slices.map(slice => slice.label)).not.toContain('Other');
    });

    it('rolls the tail beyond the top four into "Other" when there are six or more categories', () => {
        const media = Array.from({ length: 6 }, (_unused, index) =>
            buildMedia({ id: index + 1, content_type: `Type${index + 1}` }));
        // Minutes: 60, 50, 40, 30, 20, 10 → top 4 kept, last two (20+10) become Other.
        const logs = media.map((_entry, index) =>
            buildLog({ media_id: index + 1, duration_minutes: 60 - index * 10 }));
        const slices = aggregateTimeByCategory(logs, media, 'content');
        expect(slices.map(slice => slice.label)).toEqual(['Type1', 'Type2', 'Type3', 'Type4', 'Other']);
        expect(slices[4].minutes).toBe(30);
    });

    it('does not exclude "None" for the content dimension', () => {
        const media = [buildMedia({ id: 1, content_type: 'None' })];
        const logs = [buildLog({ media_id: 1, duration_minutes: 15 })];
        const slices = aggregateTimeByCategory(logs, media, 'content');
        expect(slices).toEqual([{ label: 'None', minutes: 15, percent: 100 }]);
    });
});

// ── formatDurationHm ──────────────────────────────────────────────────────────

describe('formatDurationHm', () => {
    it('formats hours and minutes together', () => {
        expect(formatDurationHm(620)).toBe('10h 20m');
    });

    it('omits hours when under an hour', () => {
        expect(formatDurationHm(45)).toBe('45m');
    });

    it('omits minutes when on the hour', () => {
        expect(formatDurationHm(180)).toBe('3h');
    });

    it('formats zero as 0m', () => {
        expect(formatDurationHm(0)).toBe('0m');
    });

    it('rounds fractional minutes and clamps negatives', () => {
        expect(formatDurationHm(59.6)).toBe('1h');
        expect(formatDurationHm(-30)).toBe('0m');
    });
});

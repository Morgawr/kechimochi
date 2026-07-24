import { describe, it, expect } from 'vitest';
import { aggregateCategorySlices, formatCharacters, formatDurationHm } from '../../../src/profile/reportcard/report_card_data';
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
        notes: '',
        ...overrides,
    };
}

// ── aggregateCategorySlices: activity ─────────────────────────────────────────

describe('aggregateCategorySlices (activity)', () => {
    it('sums minutes per activity type, sorted descending', () => {
        const logs = [
            buildLog({ media_id: 1, activity_type: 'Reading', duration_minutes: 100 }),
            buildLog({ media_id: 2, activity_type: 'Watching', duration_minutes: 50 }),
            buildLog({ media_id: 1, activity_type: 'Reading', duration_minutes: 20 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 120, characters: 0, percent: 71 },
            { label: 'Watching', minutes: 50, characters: 0, percent: 29 },
        ]);
    });

    it('drops "None" and empty activity buckets', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 60 }),
            buildLog({ activity_type: 'None', duration_minutes: 999 }),
            buildLog({ activity_type: '', duration_minutes: 999 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity');
        expect(slices.map(slice => slice.label)).toEqual(['Reading']);
    });

    it('uses log.activity_type and does not require the media list', () => {
        const logs = [buildLog({ activity_type: 'Listening', duration_minutes: 30 })];
        const slices = aggregateCategorySlices(logs, [], 'activity');
        expect(slices).toEqual([{ label: 'Listening', minutes: 30, characters: 0, percent: 100 }]);
    });

    it('drops buckets with neither minutes nor characters', () => {
        const logs = [buildLog({ activity_type: 'Reading', duration_minutes: 0, characters: 0 })];
        expect(aggregateCategorySlices(logs, [], 'activity')).toEqual([]);
    });

    it('sums characters per activity type alongside minutes', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 60, characters: 2000 }),
            buildLog({ activity_type: 'Reading', duration_minutes: 30, characters: 500 }),
            buildLog({ activity_type: 'Watching', duration_minutes: 20, characters: 0 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 90, characters: 2500, percent: 82 },
            { label: 'Watching', minutes: 20, characters: 0, percent: 18 },
        ]);
    });

    it('keeps a zero-minute category visible under metric=time when it has characters', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 60, characters: 1000 }),
            buildLog({ activity_type: 'Watching', duration_minutes: 0, characters: 500 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity', 'time');
        expect(slices.map(slice => slice.label)).toEqual(['Reading', 'Watching']);
    });

    it('keeps a zero-character category visible (e.g. Anime) under metric=time', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 60, characters: 1000 }),
            buildLog({ activity_type: 'Anime', duration_minutes: 30, characters: 0 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity', 'time');
        expect(slices.map(slice => slice.label)).toEqual(['Reading', 'Anime']);
    });

    it('sorts and percentages by characters when metric=characters', () => {
        const logs = [
            buildLog({ activity_type: 'Reading', duration_minutes: 90, characters: 1000 }),
            buildLog({ activity_type: 'Anime', duration_minutes: 120, characters: 0 }),
        ];
        const slices = aggregateCategorySlices(logs, [], 'activity', 'characters');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 90, characters: 1000, percent: 100 },
            { label: 'Anime', minutes: 120, characters: 0, percent: 0 },
        ]);
    });
});

// ── aggregateCategorySlices: content ──────────────────────────────────────────

describe('aggregateCategorySlices (content)', () => {
    it('groups by the joined media content_type', () => {
        const media = [
            buildMedia({ id: 1, content_type: 'Manga' }),
            buildMedia({ id: 2, content_type: 'Visual Novel' }),
        ];
        const logs = [
            buildLog({ media_id: 1, duration_minutes: 90 }),
            buildLog({ media_id: 2, duration_minutes: 30 }),
        ];
        const slices = aggregateCategorySlices(logs, media, 'content');
        expect(slices).toEqual([
            { label: 'Manga', minutes: 90, characters: 0, percent: 75 },
            { label: 'Visual Novel', minutes: 30, characters: 0, percent: 25 },
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
        const slices = aggregateCategorySlices(logs, media, 'content');
        expect(slices).toEqual([
            { label: 'Reading', minutes: 10, characters: 0, percent: 67 },
            { label: 'Unknown', minutes: 5, characters: 0, percent: 33 },
        ]);
    });

    it('keeps five categories as-is without an "Other" bucket', () => {
        const media = Array.from({ length: 5 }, (_unused, index) =>
            buildMedia({ id: index + 1, content_type: `Type${index + 1}` }));
        const logs = media.map((_entry, index) =>
            buildLog({ media_id: index + 1, duration_minutes: (5 - index) * 10 }));
        const slices = aggregateCategorySlices(logs, media, 'content');
        expect(slices).toHaveLength(5);
        expect(slices.map(slice => slice.label)).not.toContain('Other');
    });

    it('rolls the tail beyond the top four into "Other" when there are six or more categories', () => {
        const media = Array.from({ length: 6 }, (_unused, index) =>
            buildMedia({ id: index + 1, content_type: `Type${index + 1}` }));
        // Minutes: 60, 50, 40, 30, 20, 10 → top 4 kept, last two (20+10) become Other.
        const logs = media.map((_entry, index) =>
            buildLog({ media_id: index + 1, duration_minutes: 60 - index * 10 }));
        const slices = aggregateCategorySlices(logs, media, 'content');
        expect(slices.map(slice => slice.label)).toEqual(['Type1', 'Type2', 'Type3', 'Type4', 'Other']);
        expect(slices[4].minutes).toBe(30);
    });

    it('sums both minutes and characters of the tail into the "Other" bucket', () => {
        const media = Array.from({ length: 6 }, (_unused, index) =>
            buildMedia({ id: index + 1, content_type: `Type${index + 1}` }));
        const logs = media.map((_entry, index) =>
            buildLog({ media_id: index + 1, duration_minutes: 60 - index * 10, characters: (index + 1) * 100 }));
        const slices = aggregateCategorySlices(logs, media, 'content');
        const other = slices.find(slice => slice.label === 'Other');
        // Tail entries are Type5 (index 4, 500 chars) and Type6 (index 5, 600 chars).
        expect(other?.characters).toBe(1100);
    });

    it('does not exclude "None" for the content dimension', () => {
        const media = [buildMedia({ id: 1, content_type: 'None' })];
        const logs = [buildLog({ media_id: 1, duration_minutes: 15 })];
        const slices = aggregateCategorySlices(logs, media, 'content');
        expect(slices).toEqual([{ label: 'None', minutes: 15, characters: 0, percent: 100 }]);
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

    it('adds comma thousands-separators to hour counts of 1000 or more', () => {
        expect(formatDurationHm(60_000)).toBe('1,000h');
        expect(formatDurationHm(7_407_419)).toBe('123,456h 59m');
    });
});

// ── formatCharacters ──────────────────────────────────────────────────────────

describe('formatCharacters', () => {
    it('formats a character count with comma thousands-separators', () => {
        expect(formatCharacters(2_967_144)).toBe('2,967,144ch');
    });

    it('formats zero as 0ch', () => {
        expect(formatCharacters(0)).toBe('0ch');
    });

    it('formats a 10-digit character count', () => {
        expect(formatCharacters(9_999_999_999)).toBe('9,999,999,999ch');
    });

    it('rounds fractional values and clamps negatives', () => {
        expect(formatCharacters(1234.6)).toBe('1,235ch');
        expect(formatCharacters(-5)).toBe('0ch');
    });
});
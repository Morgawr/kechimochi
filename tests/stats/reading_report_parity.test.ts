import { describe, it, expect } from 'vitest';
import { summarizeMediaReading } from '../../src/stats/reading_speed';
import type { ReadingReportWindow } from '../../src/stats/reading_speed';
import type { ActivitySummary, Media } from '../../src/types';
import fixture from '../fixtures/reading_report_parity.json';

interface FixtureMedia {
    id: number;
    title: string;
    content_type: string;
    tracking_status: string;
    extra_data: string;
    default_activity_type: string;
}

interface FixtureLog {
    media_id: number;
    activity_type: string;
    duration_minutes: number;
    characters: number;
    date: string;
    date_precision: 'day' | 'month' | 'year';
}

interface FixtureExpectedAggregate {
    media_id: number;
    content_type: string;
    tracking_status: string;
    extra_data: string;
    immersion_minutes: number;
    has_dual: boolean;
    has_characters_only: boolean;
    window_dual_characters: number;
    window_dual_minutes: number;
    window_timed_minutes: number;
    window_characters_only_characters: number;
}

function toMedia(entry: FixtureMedia): Media {
    return {
        id: entry.id,
        title: entry.title,
        default_activity_type: entry.default_activity_type,
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: entry.extra_data,
        content_type: entry.content_type,
        tracking_status: entry.tracking_status,
    };
}

function toLog(entry: FixtureLog, id: number): ActivitySummary {
    return {
        id,
        media_id: entry.media_id,
        title: '',
        activity_type: entry.activity_type,
        duration_minutes: entry.duration_minutes,
        characters: entry.characters,
        date: entry.date,
        date_precision: entry.date_precision,
        language: 'Japanese',
        notes: '',
    };
}

describe('reading report cross-language parity (TS side)', () => {
    const window: ReadingReportWindow = fixture.window as unknown as ReadingReportWindow;
    const mediaList = (fixture.media as unknown as FixtureMedia[]).map(toMedia);
    const logs = (fixture.logs as unknown as FixtureLog[]).map((entry, index) => toLog(entry, index + 1));
    const expectedAggregates = fixture.expected_aggregates as unknown as FixtureExpectedAggregate[];

    it('reproduces every expected aggregate row exactly, on the integer columns the query computes', () => {
        for (const expected of expectedAggregates) {
            const media = mediaList.find(candidate => candidate.id === expected.media_id)!;
            const mediaLogs = logs.filter(log => log.media_id === expected.media_id);
            const actual = summarizeMediaReading(media, mediaLogs, window);

            expect(actual, `media ${expected.media_id} should qualify`).not.toBeNull();
            expect(actual!.mediaId).toBe(expected.media_id);
            expect(actual!.contentType).toBe(expected.content_type);
            expect(actual!.trackingStatus).toBe(expected.tracking_status);
            expect(actual!.extraData).toBe(expected.extra_data);
            expect(actual!.immersionMinutes).toBe(expected.immersion_minutes);
            expect(actual!.hasDual).toBe(expected.has_dual);
            expect(actual!.hasCharactersOnly).toBe(expected.has_characters_only);
            expect(actual!.windowDualCharacters).toBe(expected.window_dual_characters);
            expect(actual!.windowDualMinutes).toBe(expected.window_dual_minutes);
            expect(actual!.windowTimedMinutes).toBe(expected.window_timed_minutes);
            expect(actual!.windowCharactersOnlyCharacters).toBe(expected.window_characters_only_characters);
        }
    });

    it('excludes every media id absent from the expected aggregates, including the year-only-evidence and non-reading-type cases', () => {
        const expectedIds = new Set(expectedAggregates.map(row => row.media_id));
        const excludedMedia = mediaList.filter(media => !expectedIds.has(media.id!));
        expect(excludedMedia.length).toBeGreaterThan(0);

        for (const media of excludedMedia) {
            const mediaLogs = logs.filter(log => log.media_id === media.id);
            expect(summarizeMediaReading(media, mediaLogs, window)).toBeNull();
        }
    });
});

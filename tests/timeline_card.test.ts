import { describe, it, expect } from 'vitest';
import {
    buildTimelineCardStats,
    getTimelineCardVariantLabel,
    getTimelineDisambiguationLabel,
    getTimelineEventProgress,
} from '../src/timeline/timeline_card';
import type { TimelineEvent } from '../src/types';

const FORMATTED_DATE = 'Mar 15, 2024';

function buildEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
    return {
        kind: 'finished',
        date: '2024-03-15',
        mediaId: 1,
        mediaTitle: 'Novel A',
        mediaVariant: '',
        coverImage: '',
        activityType: 'Reading',
        contentType: 'Novel',
        trackingStatus: 'Complete',
        milestoneName: null,
        milestoneId: null,
        firstDate: '2024-03-01',
        lastDate: '2024-03-15',
        totalMinutes: 300,
        totalCharacters: 12_000,
        milestoneMinutes: 45,
        milestoneCharacters: 3_000,
        sameDayTerminal: false,
        ...overrides,
    };
}

function statPairs(event: TimelineEvent): [string, string][] {
    return buildTimelineCardStats(event, FORMATTED_DATE).map(stat => [stat.key, stat.value]);
}

describe('timeline_card.ts', () => {
    describe('buildTimelineCardStats', () => {
        it('should show date, total time, total characters and type for a completed event', () => {
            expect(statPairs(buildEvent())).toEqual([
                ['date', FORMATTED_DATE],
                ['time', '5h'],
                ['characters', '12,000'],
                ['type', 'Novel'],
            ]);
        });

        it.each(['paused', 'dropped'] as const)('should show the media totals for a %s event', kind => {
            expect(statPairs(buildEvent({ kind })).map(([key]) => key)).toEqual(['date', 'time', 'characters', 'type']);
        });

        it('should show the milestone time and characters instead of the media totals', () => {
            expect(statPairs(buildEvent({ kind: 'milestone' }))).toEqual([
                ['date', FORMATTED_DATE],
                ['time', '45m'],
                ['characters', '3,000'],
                ['type', 'Novel'],
            ]);
        });

        it('should show only date and type for a started event', () => {
            expect(statPairs(buildEvent({ kind: 'started' }))).toEqual([
                ['date', FORMATTED_DATE],
                ['type', 'Novel'],
            ]);
        });

        it('should drop zero time, zero characters and a blank type', () => {
            expect(statPairs(buildEvent({ totalMinutes: 0, totalCharacters: 0, contentType: '  ' }))).toEqual([
                ['date', FORMATTED_DATE],
            ]);
        });

        it('should label time and characters the same for every kind', () => {
            const labels = buildTimelineCardStats(buildEvent(), FORMATTED_DATE).map(stat => stat.label);
            const milestoneLabels = buildTimelineCardStats(buildEvent({ kind: 'milestone' }), FORMATTED_DATE)
                .map(stat => stat.label);
            expect(labels).toEqual(['Date', 'Time', 'Characters', 'Type']);
            expect(milestoneLabels).toEqual(labels);
        });
    });

    describe('getTimelineEventProgress', () => {
        it.each(['finished', 'paused', 'dropped'] as const)('should return the media totals for a %s event', kind => {
            expect(getTimelineEventProgress(buildEvent({ kind }))).toEqual({ minutes: 300, characters: 12_000 });
        });

        it('should return the milestone time and characters for a milestone event', () => {
            expect(getTimelineEventProgress(buildEvent({ kind: 'milestone' }))).toEqual({ minutes: 45, characters: 3_000 });
        });

        it('should return nothing for a started event', () => {
            expect(getTimelineEventProgress(buildEvent({ kind: 'started' }))).toBeNull();
        });
    });

    describe('getTimelineCardVariantLabel', () => {
        it('should return the variant of a media whose title is unique', () => {
            expect(getTimelineCardVariantLabel({ mediaTitle: 'Novel A', mediaVariant: ' Web ' }, [])).toBe('Web');
        });

        it('should return nothing for a unique title without a variant', () => {
            expect(getTimelineCardVariantLabel({ mediaTitle: 'Novel A', mediaVariant: '' }, [])).toBeNull();
        });

        it('should mark a shared title without a variant as having no variant', () => {
            expect(getTimelineCardVariantLabel({ mediaTitle: 'Novel A', mediaVariant: '' }, ['Novel A'])).toBe('(no variant)');
        });
    });

    describe('getTimelineDisambiguationLabel', () => {
        it('should return nothing for a unique title even when it has a variant', () => {
            expect(getTimelineDisambiguationLabel({ mediaTitle: 'Novel A', mediaVariant: 'Web' }, [])).toBeNull();
        });

        it('should return the variant of a shared title', () => {
            expect(getTimelineDisambiguationLabel({ mediaTitle: 'Novel A', mediaVariant: 'Web' }, ['Novel A'])).toBe('Web');
        });
    });
});

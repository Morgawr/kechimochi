/**
 * Pure bucket-row formatting for the `month` / `year` timeline zoom levels. No DOM.
 */
import type { TimelineBucket, TimelineBucketGranularity, TimelineEventKind, TimelineSummary } from '../types';
import { formatOptionalCount } from '../counts';
import { formatOptionalAlignedStatsDuration } from '../time';

export const EMPTY_TIMELINE_SUMMARY: TimelineSummary = {
    total_minutes: 0,
    completed_titles: 0,
    total_characters: 0,
    filtered_media_count: 0,
};

const BUCKET_MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
});

export interface TimelineBucketKindCount {
    kind: TimelineEventKind;
    count: number;
    noun: string;
    label: string;
}

interface TimelineBucketKindNoun {
    kind: TimelineEventKind;
    count: number;
    singular: string;
    plural: string;
}

function buildTimelineBucketKindNouns(bucket: TimelineBucket): TimelineBucketKindNoun[] {
    return [
        { kind: 'started', count: bucket.startedCount, singular: 'started', plural: 'started' },
        { kind: 'finished', count: bucket.finishedCount, singular: 'completed', plural: 'completed' },
        { kind: 'paused', count: bucket.pausedCount, singular: 'paused', plural: 'paused' },
        { kind: 'dropped', count: bucket.droppedCount, singular: 'dropped', plural: 'dropped' },
        { kind: 'milestone', count: bucket.milestoneCount, singular: 'milestone', plural: 'milestones' },
    ];
}

export function getTimelineBucketKindCounts(bucket: TimelineBucket): TimelineBucketKindCount[] {
    return buildTimelineBucketKindNouns(bucket).map(entry => {
        const noun = entry.count === 1 ? entry.singular : entry.plural;
        return {
            kind: entry.kind,
            count: entry.count,
            noun,
            label: `${entry.count} ${noun}`,
        };
    });
}

export interface TimelineBucketTotals {
    time: string;
    characters: string;
}

export function getTimelineBucketTotals(bucket: TimelineBucket): TimelineBucketTotals {
    return {
        time: formatOptionalAlignedStatsDuration(bucket.loggedMinutes),
        characters: formatOptionalCount(bucket.loggedCharacters, 'char'),
    };
}

export function formatTimelineBucketCoverOverflowLabel(overflowCount: number, anyCoverVisible: boolean): string | null {
    if (overflowCount <= 0) {
        return null;
    }
    const titleCount = `${overflowCount} ${overflowCount === 1 ? 'title' : 'titles'}`;
    return anyCoverVisible ? `+${titleCount}` : titleCount;
}

export const TIMELINE_BUCKET_COVER_ROWS: Record<TimelineBucketGranularity, number> = {
    month: 1,
    year: 2,
};

export function getTimelineBucketCoverColumnCount(availableWidth: number, minCoverWidth: number, coverGap: number): number {
    const slotWidth = minCoverWidth + coverGap;
    if (slotWidth <= 0) {
        return 1;
    }
    return Math.max(1, Math.floor((availableWidth + coverGap) / slotWidth));
}

export interface TimelineBucketCoverFitInput {
    perRow: number;
    maxRows: number;
    renderedCount: number;
    distinctMediaCount: number;
}

export interface TimelineBucketCoverFit {
    visibleCount: number;
    overflowCount: number;
}

export function fitTimelineBucketCovers(input: TimelineBucketCoverFitInput): TimelineBucketCoverFit {
    const capacity = Math.max(1, Math.max(1, input.perRow) * Math.max(1, input.maxRows));

    let visibleCount = Math.min(input.renderedCount, input.distinctMediaCount, capacity);
    let overflowCount = Math.max(0, input.distinctMediaCount - visibleCount);
    if (overflowCount > 0 && visibleCount + 1 > capacity) {
        visibleCount = Math.min(input.renderedCount, Math.max(1, capacity - 1));
        overflowCount = input.distinctMediaCount - visibleCount;
    }
    return { visibleCount, overflowCount };
}

export function formatTimelineBucketLabel(bucket: TimelineBucket, granularity: TimelineBucketGranularity): string {
    if (granularity === 'year') {
        return bucket.key;
    }
    return BUCKET_MONTH_LABEL_FORMATTER.format(new Date(`${bucket.startDate}T00:00:00Z`));
}

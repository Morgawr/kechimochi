/**
 * Pure bucket-row formatting for the `month` / `year` timeline zoom levels. No DOM.
 */
import type { TimelineBucket, TimelineBucketGranularity, TimelineEventKind, TimelineSummary } from '../types';
import { formatOptionalCount } from '../counts';
import { formatOptionalStatsDuration } from '../time';

export const EMPTY_TIMELINE_SUMMARY: TimelineSummary = {
    total_minutes: 0,
    completed_titles: 0,
    total_characters: 0,
    filtered_media_count: 0,
};

const BUCKET_MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});

export interface TimelineBucketPip {
    kind: TimelineEventKind;
    count: number;
    label: string;
}

interface TimelineBucketPipNoun {
    kind: TimelineEventKind;
    count: number;
    singular: string;
    plural: string;
}

function buildTimelineBucketPipNouns(bucket: TimelineBucket): TimelineBucketPipNoun[] {
    return [
        { kind: 'started', count: bucket.startedCount, singular: 'started', plural: 'started' },
        { kind: 'finished', count: bucket.finishedCount, singular: 'completed', plural: 'completed' },
        { kind: 'paused', count: bucket.pausedCount, singular: 'paused', plural: 'paused' },
        { kind: 'dropped', count: bucket.droppedCount, singular: 'dropped', plural: 'dropped' },
        { kind: 'milestone', count: bucket.milestoneCount, singular: 'milestone', plural: 'milestones' },
    ];
}

export function getTimelineBucketPips(bucket: TimelineBucket): TimelineBucketPip[] {
    return buildTimelineBucketPipNouns(bucket)
        .filter(pip => pip.count > 0)
        .map(pip => ({
            kind: pip.kind,
            count: pip.count,
            label: `${pip.count} ${pip.count === 1 ? pip.singular : pip.plural}`,
        }));
}

export function getTimelineBucketDominantKind(bucket: TimelineBucket): TimelineEventKind | null {
    let dominant: TimelineBucketPipNoun | null = null;
    for (const candidate of buildTimelineBucketPipNouns(bucket)) {
        if (candidate.count > 0 && (dominant === null || candidate.count > dominant.count)) {
            dominant = candidate;
        }
    }
    return dominant?.kind ?? null;
}

export function buildTimelineBucketTotalsParts(bucket: TimelineBucket): string[] {
    const loggedCharacters = formatOptionalCount(bucket.loggedCharacters, 'char');
    return [
        formatOptionalStatsDuration(bucket.loggedMinutes),
        loggedCharacters ? `${loggedCharacters} logged` : '',
    ].filter(part => part.length > 0);
}

export function formatTimelineBucketCoverOverflowLabel(overflowCount: number, anyCoverVisible: boolean): string | null {
    if (overflowCount <= 0) {
        return null;
    }
    if (anyCoverVisible) {
        return `+${overflowCount}`;
    }
    return `${overflowCount} ${overflowCount === 1 ? 'title' : 'titles'}`;
}

export const TIMELINE_BUCKET_COVER_ROWS: Record<TimelineBucketGranularity, number> = {
    month: 1,
    year: 2,
};

export interface TimelineBucketCoverFitInput {
    availableWidth: number;
    coverWidth: number;
    coverGap: number;
    maxRows: number;
    renderedCount: number;
    distinctMediaCount: number;
}

export interface TimelineBucketCoverFit {
    visibleCount: number;
    overflowCount: number;
}

export function fitTimelineBucketCovers(input: TimelineBucketCoverFitInput): TimelineBucketCoverFit {
    const slotWidth = input.coverWidth + input.coverGap;
    const perRow = slotWidth > 0
        ? Math.max(1, Math.floor((input.availableWidth + input.coverGap) / slotWidth))
        : 1;
    const capacity = Math.max(1, perRow * Math.max(1, input.maxRows));

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

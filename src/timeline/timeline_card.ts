import { formatOptionalNumber } from '../counts';
import { formatOptionalStatsDuration } from '../time';
import type { TimelineEvent, TimelineEventKind } from '../types';

export type TimelineCardStatKey = keyof typeof TIMELINE_CARD_STAT_LABELS;

export interface TimelineCardStat {
    key: TimelineCardStatKey;
    label: string;
    value: string;
}

export interface TimelineEventProgress {
    minutes: number;
    characters: number;
}

interface TimelineVariantEntity {
    mediaTitle: string;
    mediaVariant: string;
}

export const TIMELINE_CARD_STAT_LABELS = {
    date: 'Date',
    time: 'Time',
    characters: 'Characters',
    type: 'Type',
} as const;

const TIMELINE_CARD_STAT_KEYS: readonly TimelineCardStatKey[] = ['date', 'time', 'characters', 'type'];

const NO_VARIANT_LABEL = '(no variant)';

const TERMINAL_EVENT_KINDS: ReadonlySet<TimelineEventKind> = new Set<TimelineEventKind>([
    'finished',
    'paused',
    'dropped',
]);

export function getTimelineEventProgress(event: TimelineEvent): TimelineEventProgress | null {
    if (event.kind === 'milestone') {
        return { minutes: event.milestoneMinutes, characters: event.milestoneCharacters };
    }
    if (TERMINAL_EVENT_KINDS.has(event.kind)) {
        return { minutes: event.totalMinutes, characters: event.totalCharacters };
    }
    return null;
}

export function buildTimelineCardStats(event: TimelineEvent, formattedDate: string): TimelineCardStat[] {
    const progress = getTimelineEventProgress(event);
    const values: Record<TimelineCardStatKey, string> = {
        date: formattedDate,
        time: progress ? formatOptionalStatsDuration(progress.minutes) : '',
        characters: progress ? formatOptionalNumber(progress.characters) : '',
        type: event.contentType.trim(),
    };

    return TIMELINE_CARD_STAT_KEYS
        .map(key => ({ key, label: TIMELINE_CARD_STAT_LABELS[key], value: values[key] }))
        .filter(stat => stat.value.length > 0);
}

export function getTimelineDisambiguationLabel(
    entity: TimelineVariantEntity,
    ambiguousTitles: readonly string[],
): string | null {
    if (!ambiguousTitles.includes(entity.mediaTitle)) {
        return null;
    }
    return entity.mediaVariant.trim() || NO_VARIANT_LABEL;
}

export function getTimelineCardVariantLabel(
    entity: TimelineVariantEntity,
    ambiguousTitles: readonly string[],
): string | null {
    const variant = entity.mediaVariant.trim();
    if (variant.length > 0) {
        return variant;
    }
    return getTimelineDisambiguationLabel(entity, ambiguousTitles);
}

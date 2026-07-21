import type { ActivitySummary, Media } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportCardDimension = 'activity' | 'content';

/** One labelled slice of time, used for both the legend rows and the donut. */
export interface CategorySlice {
    label: string;
    minutes: number;
    percent: number; // share of the dimension total, 0-100, rounded
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Content-type cards keep the top N categories and roll the rest into "Other". */
const MAX_CONTENT_CATEGORIES = 4;
const OTHER_LABEL = 'Other';

/** Activity labels that represent "no activity" and are excluded from the card. */
const EXCLUDED_ACTIVITY_LABELS = new Set(['', 'None']);

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Aggregates all-time minutes per category for the requested dimension.
 *
 * - `activity`: groups by activity type (Reading / Watching / Playing / Listening),
 *   which `ActivitySummary.activity_type` already holds; drops `None`/empty buckets.
 * - `content`: groups by the media's content type (joined via `media_id`, with the
 *   same fallback chain the dashboard uses), then keeps the top
 *   `MAX_CONTENT_CATEGORIES` and rolls any remaining categories into "Other".
 *
 * Result is sorted by minutes descending, with zero-minute buckets dropped and a
 * `percent` share of the dimension total attached to each slice.
 */
export function aggregateTimeByCategory(
    logs: ActivitySummary[],
    mediaList: Media[],
    dimension: ReportCardDimension,
): CategorySlice[] {
    const mediaById = new Map(
        mediaList.filter(media => media.id !== undefined).map(media => [media.id, media]),
    );
    const minutesByLabel = new Map<string, number>();

    for (const log of logs) {
        let label: string;
        if (dimension === 'activity') {
            label = (log.activity_type || '').trim();
            if (EXCLUDED_ACTIVITY_LABELS.has(label)) continue;
        } else {
            const media = mediaById.get(log.media_id);
            label = (media?.content_type || media?.default_activity_type || log.activity_type || 'Unknown').trim() || 'Unknown';
        }
        minutesByLabel.set(label, (minutesByLabel.get(label) ?? 0) + log.duration_minutes);
    }

    let entries = Array.from(minutesByLabel.entries())
        .filter(([, minutes]) => minutes > 0)
        .sort((a, b) => b[1] - a[1]);

    // Content cards roll the long tail into "Other" so we never exceed the five
    // available chart colors. With exactly five categories we show them as-is.
    if (dimension === 'content' && entries.length > MAX_CONTENT_CATEGORIES + 1) {
        const top = entries.slice(0, MAX_CONTENT_CATEGORIES);
        const otherMinutes = entries
            .slice(MAX_CONTENT_CATEGORIES)
            .reduce((sum, [, minutes]) => sum + minutes, 0);
        entries = otherMinutes > 0 ? [...top, [OTHER_LABEL, otherMinutes]] : top;
    }

    const totalMinutes = entries.reduce((sum, [, minutes]) => sum + minutes, 0);
    return entries.map(([label, minutes]) => ({
        label,
        minutes,
        percent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
    }));
}

/**
 * Formats a minute count as `<total minutes divided by 60>h <total minutes mod 60>m` (e.g. 620 → "10h 20m"),
 * collapsing the parts that are zero ("45m", "3h", "0m").
 */
export function formatDurationHm(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const leftoverMinutes = safeMinutes % 60;
    if (hours === 0) return `${leftoverMinutes}m`;
    if (leftoverMinutes === 0) return `${hours}h`;
    return `${hours}h ${leftoverMinutes}m`;
}

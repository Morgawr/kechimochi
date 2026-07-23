import type { ActivitySummary, Media } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportCardDimension = 'activity' | 'content';

/** Which value drives the percentage share, sort order, and donut for a card. */
export type ReportCardMetric = 'time' | 'characters';

/** One labelled slice of time/characters, used for both the legend rows and the donut. */
export interface CategorySlice {
    label: string;
    minutes: number;
    characters: number;
    percent: number; // share of the dimension total for the active metric, 0-100, rounded
}

/** Running per-category totals accumulated while aggregating. */
interface CategoryTotals {
    minutes: number;
    characters: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Content-type cards keep the top N categories and roll the rest into "Other". */
const MAX_CONTENT_CATEGORIES = 4;
const OTHER_LABEL = 'Other';

/** Activity labels that represent "no activity" and are excluded from the card. */
const EXCLUDED_ACTIVITY_LABELS = new Set(['', 'None']);

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Aggregates all-time minutes and characters per category for the requested
 * dimension, sorted and percentaged according to the active metric.
 *
 * - `activity`: groups by activity type (Reading / Watching / Playing / Listening),
 *   which `ActivitySummary.activity_type` already holds; drops `None`/empty buckets.
 * - `content`: groups by the media's content type (joined via `media_id`, with the
 *   same fallback chain the dashboard uses), then keeps the top
 *   `MAX_CONTENT_CATEGORIES` and rolls any remaining categories into "Other".
 *
 * Both `minutes` and `characters` are always summed per category, regardless of
 * `metric`; only `metric` decides which value drives sort order, the "Other"
 * cutoff, and `percent`. A category is kept when it has minutes or characters,
 * so it isn't dropped just because the active metric happens to be zero for it.
 */
export function aggregateCategorySlices(
    logs: ActivitySummary[],
    mediaList: Media[],
    dimension: ReportCardDimension,
    metric: ReportCardMetric = 'time',
): CategorySlice[] {
    const mediaById = new Map(
        mediaList.filter(media => media.id !== undefined).map(media => [media.id, media]),
    );
    const totalsByLabel = new Map<string, CategoryTotals>();

    for (const log of logs) {
        let label: string;
        if (dimension === 'activity') {
            label = (log.activity_type || '').trim();
            if (EXCLUDED_ACTIVITY_LABELS.has(label)) continue;
        } else {
            const media = mediaById.get(log.media_id);
            label = (media?.content_type || media?.default_activity_type || log.activity_type || 'Unknown').trim() || 'Unknown';
        }
        const totals = totalsByLabel.get(label) ?? { minutes: 0, characters: 0 };
        totals.minutes += log.duration_minutes;
        totals.characters += log.characters;
        totalsByLabel.set(label, totals);
    }

    const valueOf = (totals: CategoryTotals): number =>
        metric === 'time' ? totals.minutes : totals.characters;

    let entries = Array.from(totalsByLabel.entries())
        .filter(([, totals]) => totals.minutes > 0 || totals.characters > 0)
        .sort((a, b) => valueOf(b[1]) - valueOf(a[1]));

    // Content cards roll the long tail into "Other" so we never exceed the five
    // available chart colors. With exactly five categories we show them as-is.
    if (dimension === 'content' && entries.length > MAX_CONTENT_CATEGORIES + 1) {
        const top = entries.slice(0, MAX_CONTENT_CATEGORIES);
        const otherTotals = entries.slice(MAX_CONTENT_CATEGORIES).reduce(
            (sum, [, totals]) => ({ minutes: sum.minutes + totals.minutes, characters: sum.characters + totals.characters }),
            { minutes: 0, characters: 0 },
        );
        entries = otherTotals.minutes > 0 || otherTotals.characters > 0
            ? [...top, [OTHER_LABEL, otherTotals] as [string, CategoryTotals]]
            : top;
    }

    const total = entries.reduce((sum, [, totals]) => sum + valueOf(totals), 0);
    return entries.map(([label, totals]) => ({
        label,
        minutes: totals.minutes,
        characters: totals.characters,
        percent: total > 0 ? Math.round((valueOf(totals) / total) * 100) : 0,
    }));
}

/**
 * Formats a minute count as `<total minutes divided by 60>h <total minutes mod 60>m` (e.g. 620 → "10h 20m"),
 * collapsing the parts that are zero ("45m", "3h", "0m"). The hours part gets
 * comma thousands-separators (`123,456h 59m`) in a pinned `en-US` locale so the
 * shareable PNG renders consistently regardless of the user's locale.
 */
export function formatDurationHm(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const leftoverMinutes = safeMinutes % 60;
    if (hours === 0) return `${leftoverMinutes}m`;
    const formattedHours = hours.toLocaleString('en-US');
    if (leftoverMinutes === 0) return `${formattedHours}h`;
    return `${formattedHours}h ${leftoverMinutes}m`;
}

/**
 * Formats a character count with comma thousands-separators in a pinned
 * `en-US` locale, e.g. `2,967,144ch`, `0ch`.
 */
export function formatCharacters(characters: number): string {
    return `${Math.max(0, Math.round(characters)).toLocaleString('en-US')}ch`;
}

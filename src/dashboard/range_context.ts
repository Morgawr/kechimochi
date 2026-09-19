import { ActivitySummary, DashboardRangeResponse, Media } from '../api';
import { getActivityRange, getLocalISODate, resolveRangeLogs, type ActivityRange } from './activity_ranges';

export interface Totals {
    minutes: number;
    characters: number;
}

export interface RangeContext {
    range: ActivityRange;
    isTodayInRange: boolean;
    categoryTotals: Array<[string, Totals]>;
    timeRangeDays: number;
    timeRangeOffset: number;
    weekStartDay: number;
}

export interface RangeContextParams {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    timeRangeDays: number;
    timeRangeOffset: number;
    weekStartDay: number;
}

/**
 * Feeds Period Stats' table, Categories and the Highlights "Top Category" entry.
 * Computed once per range update and handed to all three.
 */
export function computeRangeContext(params: RangeContextParams): RangeContext {
    const rangeLogs = resolveRangeLogs(params.logs, params.rangeData);
    const range = getActivityRange(params.timeRangeDays, params.timeRangeOffset, rangeLogs, params.weekStartDay);
    const today = getLocalISODate(new Date());
    const isTodayInRange = today >= range.validStart && today <= range.validEnd;
    const categoryTotals = getCategoryTotals(range.validStart, range.validEnd, params.rangeData, params.mediaList, params.logs);

    return {
        range,
        isTodayInRange,
        categoryTotals,
        timeRangeDays: params.timeRangeDays,
        timeRangeOffset: params.timeRangeOffset,
        weekStartDay: params.weekStartDay,
    };
}

function getCategoryTotals(
    validStart: string,
    validEnd: string,
    rangeData: DashboardRangeResponse | undefined,
    mediaList: Media[] | undefined,
    logs: ActivitySummary[] | undefined,
): Array<[string, Totals]> {
    if (rangeData) {
        return rangeData.category_totals.map(total => [total.label, {
            minutes: total.total_minutes,
            characters: total.total_characters,
        }]);
    }

    const mediaById = new Map((mediaList ?? []).filter(media => media.id !== undefined).map(media => [media.id, media]));
    const totalsByCategory = new Map<string, Totals>();

    for (const log of logs ?? []) {
        if (log.date < validStart || log.date > validEnd) continue;
        const media = mediaById.get(log.media_id);
        const category = media?.content_type || media?.default_activity_type || log.activity_type || 'Unknown';
        const current = totalsByCategory.get(category) || { minutes: 0, characters: 0 };
        totalsByCategory.set(category, {
            minutes: current.minutes + log.duration_minutes,
            characters: current.characters + (log.characters || 0),
        });
    }

    return Array.from(totalsByCategory.entries())
        .sort((a, b) => b[1].minutes - a[1].minutes || b[1].characters - a[1].characters);
}

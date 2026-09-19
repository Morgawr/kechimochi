import { HEATMAP_CARD } from './cards/Heatmap';
import { ACTIVITY_FLOW_CARD } from './cards/ActivityFlow';
import { ACTIVITY_MIX_CARD } from './cards/ActivityMix';
import { WEEKDAY_RHYTHM_CARD } from './cards/WeekdayRhythm';
import { PERIOD_STATS_CARD } from './cards/PeriodStats';
import { CATEGORIES_CARD } from './cards/Categories';
import { HIGHLIGHTS_CARD } from './cards/Highlights';
import { RECENT_ACTIVITY_CARD } from './cards/RecentActivity';

export const DASHBOARD_CARD_ORDER = [
    HEATMAP_CARD,
    ACTIVITY_FLOW_CARD,
    ACTIVITY_MIX_CARD,
    WEEKDAY_RHYTHM_CARD,
    PERIOD_STATS_CARD,
    CATEGORIES_CARD,
    HIGHLIGHTS_CARD,
    RECENT_ACTIVITY_CARD,
] as const;

export type DashboardCardId = typeof DASHBOARD_CARD_ORDER[number]['id'];

export function parseHiddenDashboardCards(raw: string | null): Set<DashboardCardId> {
    if (!raw) return new Set();

    let parsedValue: unknown;
    try {
        parsedValue = JSON.parse(raw);
    } catch {
        return new Set();
    }

    if (!Array.isArray(parsedValue)) return new Set();

    const declaredIds = new Set<string>(DASHBOARD_CARD_ORDER.map(card => card.id));
    const hiddenIds = new Set<DashboardCardId>();
    for (const entry of parsedValue) {
        if (typeof entry !== 'string') continue;
        if (!declaredIds.has(entry)) continue;

        hiddenIds.add(entry as DashboardCardId);
    }

    return hiddenIds;
}

export function serializeHiddenDashboardCards(hiddenCards: ReadonlySet<DashboardCardId>): string {
    const canonicalHiddenIds = DASHBOARD_CARD_ORDER
        .map(card => card.id)
        .filter(id => hiddenCards.has(id));
    return JSON.stringify(canonicalHiddenIds);
}

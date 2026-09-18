import { HEATMAP_CARD } from './cards/HeatmapView';
import { ACTIVITY_BREAKDOWN_CARD, ACTIVITY_VISUALIZATION_CARD } from './cards/ActivityCharts';
import { WEEKDAY_DISTRIBUTION_CARD, PERIOD_STATS_CARD, CATEGORIES_CARD, HIGHLIGHTS_CARD } from './cards/ActivityTotals';
import { RECENT_ACTIVITY_CARD } from './cards/RecentActivity';

export const DASHBOARD_CARD_ORDER = [
    HEATMAP_CARD,
    ACTIVITY_BREAKDOWN_CARD,
    ACTIVITY_VISUALIZATION_CARD,
    WEEKDAY_DISTRIBUTION_CARD,
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

    const declaredIds: readonly DashboardCardId[] = DASHBOARD_CARD_ORDER.map(card => card.id);
    const hiddenIds = new Set<DashboardCardId>();
    for (const entry of parsedValue) {
        if (typeof entry !== 'string') continue;
        if (!declaredIds.includes(entry as DashboardCardId)) continue;

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

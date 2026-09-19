// 12 divides by 2, 3, 4 and 6, so halves, thirds and quarters are all whole columns. Every
// tier uses the same twelve; a tier is a set of spans, not a column count. The narrowest
// tier is CSS-only, since every card is full width there.
export const DASHBOARD_GRID_COLUMNS = 12;

export const DASHBOARD_DATA_SOURCES = ['heatmap', 'weekdayDistribution', 'recentLogs', 'range'] as const;
export type DashboardDataSource = typeof DASHBOARD_DATA_SOURCES[number];

export interface DashboardCardDescriptor {
    readonly id: string;
    readonly label: string;
    readonly spans: Record<'wide' | 'medium', number>;
    readonly dataSources: readonly DashboardDataSource[];
}

interface PackedCard {
    id: string;
    span: number;
}

function clampSpan(span: number, columns: number): number {
    if (!Number.isFinite(span) || !Number.isInteger(span)) return columns;
    return Math.min(columns, Math.max(1, span));
}

function widenRow(row: PackedCard[], columns: number, used: number): void {
    const exactSpans = row.map(card => (card.span * columns) / used);
    const flooredSpans = exactSpans.map(exactSpan => Math.floor(exactSpan));
    const leftoverColumns = columns - flooredSpans.reduce((sum, span) => sum + span, 0);

    const remainders = exactSpans
        .map((exactSpan, index) => ({ index, fraction: exactSpan - flooredSpans[index] }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

    for (let i = 0; i < leftoverColumns; i++) {
        flooredSpans[remainders[i].index] += 1;
    }

    row.forEach((card, index) => {
        card.span = flooredSpans[index];
    });
}

export function packCards(
    cards: readonly { id: string; span: number }[],
    columns: number,
): Map<string, number> {
    const remaining: PackedCard[] = cards.map(card => ({ id: card.id, span: clampSpan(card.span, columns) }));
    const result = new Map<string, number>();

    while (remaining.length > 0) {
        const seed = remaining.shift()!;
        const row: PackedCard[] = [seed];
        let used = seed.span;

        while (used < columns && remaining.length > 0 && remaining[0].span <= columns - used) {
            const picked = remaining.shift()!;
            row.push(picked);
            used += picked.span;
        }

        if (used < columns) widenRow(row, columns, used);

        for (const card of row) {
            result.set(card.id, card.span);
        }
    }

    return result;
}

export function reconcileDashboardCards(
    grid: HTMLElement,
    descriptorsById: ReadonlyMap<string, DashboardCardDescriptor>,
    hiddenCards: ReadonlySet<string>,
): void {
    const hosts = Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-dashboard-card]'));

    const visibleHosts: { host: HTMLElement; id: string }[] = [];
    for (const host of hosts) {
        const id = host.dataset.dashboardCard;
        if (id === undefined) continue;

        const isAbsent = hiddenCards.has(id) || host.querySelector('.card') === null;
        host.hidden = isAbsent;
        if (!isAbsent) visibleHosts.push({ host, id });
    }

    for (const tier of ['wide', 'medium'] as const) {
        const property = tier === 'wide' ? '--dashboard-card-span-wide' : '--dashboard-card-span-medium';

        const cards = visibleHosts.map(({ id }) => {
            const descriptor = descriptorsById.get(id);
            return { id, span: descriptor ? descriptor.spans[tier] : DASHBOARD_GRID_COLUMNS };
        });
        const spans = packCards(cards, DASHBOARD_GRID_COLUMNS);

        for (const { host, id } of visibleHosts) {
            host.style.setProperty(property, `span ${spans.get(id) ?? DASHBOARD_GRID_COLUMNS}`);
        }
    }
}

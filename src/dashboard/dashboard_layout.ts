export const DASHBOARD_GRID_TIERS = {
    // >1024px. 12 divides by 2, 3, 4 and 6, so halves, thirds and quarters are all whole columns.
    wide: 12,
    // 769-1024px. 6 keeps halves and thirds whole at the width where thirds stop fitting.
    medium: 6,
    // <=768px. Single column; CSS overrides spans entirely.
    narrow: 1,
} as const;

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

        while (used < columns) {
            const gap = columns - used;
            const exactFitIndex = remaining.findIndex(card => card.span === gap);
            const pickIndex = exactFitIndex !== -1 ? exactFitIndex : remaining.findIndex(card => card.span < gap);
            if (pickIndex === -1) break;

            const [picked] = remaining.splice(pickIndex, 1);
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
        const columns = DASHBOARD_GRID_TIERS[tier];
        const property = tier === 'wide' ? '--dashboard-card-span-wide' : '--dashboard-card-span-medium';

        const cards = visibleHosts.map(({ id }) => {
            const descriptor = descriptorsById.get(id);
            return { id, span: descriptor ? descriptor.spans[tier] : columns };
        });
        const spans = packCards(cards, columns);

        for (const { host, id } of visibleHosts) {
            host.style.setProperty(property, `span ${spans.get(id) ?? columns}`);
        }
    }
}

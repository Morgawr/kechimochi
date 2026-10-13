import { Component } from '../../component';
import type { Totals } from '../range_context';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataEmptyState } from '../card_shell';
import { getTotalsColumns, hasVisibleTotals, renderTotalsTable, type BucketRow } from '../totals_table';

export const CATEGORIES_CARD = {
    id: 'categories',
    label: 'Categories',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

interface CategoriesState {
    categoryTotals: ReadonlyArray<[string, Totals]>;
    elapsedPeriodDays: number | null;
}

export class Categories extends Component<CategoriesState> {
    public setState(newState: Partial<CategoriesState>): void {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    render(): void {
        this.clear();
        const categoryRows: BucketRow[] = this.state.categoryTotals.map(([category, totals]) => ({
            key: category,
            label: category,
            subject: category,
            totals,
            isCurrent: false,
            isSelected: false,
            selectable: false,
        }));

        this.container.insertAdjacentHTML('beforeend', this.renderCategoriesPanel(categoryRows, this.state.elapsedPeriodDays));
    }

    private renderCategoriesPanel(categoryRows: BucketRow[], elapsedPeriodDays: number | null): string {
        const columns = getTotalsColumns(categoryRows);
        const body = hasVisibleTotals(columns)
            ? renderTotalsTable('Title', categoryRows, columns)
            : renderNoPeriodDataEmptyState(elapsedPeriodDays);

        return renderDashboardCardShell({ title: CATEGORIES_CARD.label, body });
    }
}

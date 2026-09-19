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
    isTodayInRange: boolean;
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

        this.container.insertAdjacentHTML('beforeend', this.renderCategoriesPanel(categoryRows, this.state.isTodayInRange));
    }

    private renderCategoriesPanel(categoryRows: BucketRow[], isTodayInRange: boolean): string {
        const columns = getTotalsColumns(categoryRows);
        const body = hasVisibleTotals(columns)
            ? renderTotalsTable('Title', categoryRows, columns)
            : renderNoPeriodDataEmptyState(isTodayInRange);

        return renderDashboardCardShell({ title: CATEGORIES_CARD.label, body });
    }
}

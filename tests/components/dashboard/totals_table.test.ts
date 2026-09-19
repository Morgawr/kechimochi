import { describe, expect, it } from 'vitest';
import { renderTotalsTable, type BucketRow } from '../../../src/dashboard/totals_table';

function row(overrides: Partial<BucketRow> & { key: string; label: string }): BucketRow {
    return {
        subject: overrides.subject ?? overrides.label,
        totals: overrides.totals ?? { minutes: 30, characters: 100 },
        isCurrent: overrides.isCurrent ?? false,
        isSelected: overrides.isSelected ?? false,
        selectable: overrides.selectable ?? true,
        ...overrides,
    };
}

describe('renderTotalsTable', () => {
    it('keeps the header and Total rows as siblings of the scrolling rows container, not inside it', () => {
        const container = document.createElement('div');
        container.innerHTML = renderTotalsTable('Day', [
            row({ key: 'a', label: 'Day 1' }),
            row({ key: 'b', label: 'Day 2' }),
        ], { showCharacters: true, showHours: true });

        const scroller = container.querySelector('.dashboard-stats-rows')!;
        expect(scroller).not.toBeNull();
        expect(scroller.querySelector('.dashboard-stats-row-header')).toBeNull();
        expect(scroller.querySelector('.dashboard-stats-row-total')).toBeNull();

        const table = container.querySelector('.dashboard-stats-table')!;
        const tableChildClasses = Array.from(table.children).map(child => child.className);
        expect(tableChildClasses.some(className => className.includes('dashboard-stats-row-header'))).toBe(true);
        expect(tableChildClasses.some(className => className.includes('dashboard-stats-row-total'))).toBe(true);
        expect(scroller.children).toHaveLength(2);
    });

    it('renders nothing for an empty row set', () => {
        expect(renderTotalsTable('Day', [], { showCharacters: true, showHours: true })).toBe('');
    });

    it('renders nothing when no row has a visible total', () => {
        const rows = [row({ key: 'a', label: 'Day 1', totals: { minutes: 0, characters: 0 } })];
        expect(renderTotalsTable('Day', rows, { showCharacters: false, showHours: false })).toBe('');
    });
});

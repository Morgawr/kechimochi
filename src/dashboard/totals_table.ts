import { escapeHTML } from '../html';
import { formatStatsDuration } from '../time';
import type { Totals } from './range_context';

export interface BucketRow {
    key: string;
    label: string;
    subject: string;
    dayOfMonth?: string;
    weekday?: string;
    startsWeek?: boolean;
    totals: Totals;
    isCurrent: boolean;
    isSelected: boolean;
    selectable: boolean;
    spansLabel?: boolean;
}

export interface TotalsColumns {
    showCharacters: boolean;
    showHours: boolean;
}

export function getTotalsColumns(rows: Array<{ totals: Totals }>): TotalsColumns {
    return {
        showCharacters: rows.some(row => row.totals.characters > 0),
        showHours: rows.some(row => row.totals.minutes > 0),
    };
}

export function hasVisibleTotals(columns: TotalsColumns): boolean {
    return columns.showCharacters || columns.showHours;
}

/**
 * Shared by Period Stats (selectable day/week/month rows, optionally
 * day-split into two columns) and Categories (plain, unselectable rows).
 */
export function renderTotalsTable(
    headerLabel: string,
    rows: BucketRow[],
    columns: TotalsColumns,
    splitDayLabel = false,
): string {
    if (rows.length === 0 || !hasVisibleTotals(columns)) return '';

    const gridTemplateColumns = getTotalsGridTemplate(columns, splitDayLabel);
    const tableClasses = [
        'dashboard-stats-table',
        splitDayLabel ? 'dashboard-stats-table-days' : '',
    ].filter(Boolean).join(' ');

    return `
        <div class="${tableClasses}">
            <div class="dashboard-stats-row dashboard-stats-row-header" style="grid-template-columns: ${gridTemplateColumns};">
                ${splitDayLabel
            ? '<span>Day</span><span>Weekday</span>'
            : `<span>${escapeHTML(headerLabel)}</span>`}
                ${columns.showCharacters ? '<span class="dashboard-stats-row-value">Chars</span>' : ''}
                ${columns.showHours ? '<span class="dashboard-stats-row-value">Hours</span>' : ''}
            </div>
            <div class="dashboard-stats-rows">
                ${rows.map((row, index) => renderTotalsRow(row, row.selectable ? index : null, columns, gridTemplateColumns, splitDayLabel)).join('')}
            </div>
            <div class="dashboard-stats-row dashboard-stats-row-total" style="grid-template-columns: ${gridTemplateColumns};">
                <span class="${splitDayLabel ? 'dashboard-stats-row-total-label' : ''}">Total</span>
                ${columns.showCharacters ? `<span class="dashboard-stats-row-value">${escapeHTML(getRowsTotal(rows, 'characters'))}</span>` : ''}
                ${columns.showHours ? `<span class="dashboard-stats-row-value">${escapeHTML(getRowsTotal(rows, 'hours'))}</span>` : ''}
            </div>
        </div>
    `;
}

function renderTotalsRow(
    row: BucketRow,
    index: number | null,
    columns: TotalsColumns,
    gridTemplateColumns: string,
    splitDayLabel: boolean,
): string {
    const classes = [
        'dashboard-stats-row',
        row.isCurrent ? 'is-current' : '',
        row.isSelected ? 'is-selected' : '',
        index === null ? '' : 'is-selectable',
        row.startsWeek ? 'is-week-start' : '',
    ].filter(Boolean).join(' ');
    const useSplitLabel = splitDayLabel && !row.spansLabel;
    const spanningLabelClass = splitDayLabel ? ' dashboard-stats-row-total-label' : '';
    const rowContent = `
        ${useSplitLabel
            ? `<span class="dashboard-stats-row-label dashboard-stats-row-day">${escapeHTML(row.dayOfMonth ?? '')}</span>
               <span class="dashboard-stats-row-label dashboard-stats-row-weekday">${escapeHTML(row.weekday ?? '')}</span>`
            : `<span class="dashboard-stats-row-label${spanningLabelClass}">${escapeHTML(row.label)}</span>`}
        ${columns.showCharacters ? `<span class="dashboard-stats-row-value">${escapeHTML(row.totals.characters.toLocaleString())}</span>` : ''}
        ${columns.showHours ? `<span class="dashboard-stats-row-value">${escapeHTML(formatStatsDuration(row.totals.minutes))}</span>` : ''}
    `;

    if (index === null) {
        const unbucketedAttribute = row.spansLabel ? ' data-dashboard-unbucketed-row' : '';
        return `<div class="${classes}"${unbucketedAttribute} style="grid-template-columns: ${gridTemplateColumns};">${rowContent}</div>`;
    }

    return `<button type="button" class="${classes}" style="grid-template-columns: ${gridTemplateColumns};" data-dashboard-total-index="${index}">${rowContent}</button>`;
}

function getTotalsGridTemplate(columns: TotalsColumns, splitDayLabel: boolean): string {
    const characterColumn = splitDayLabel ? 'minmax(3.75rem, max-content)' : 'minmax(5rem, max-content)';
    const hourColumn = splitDayLabel ? 'minmax(3.75rem, max-content)' : 'minmax(4.25rem, max-content)';
    const metricColumns = [
        columns.showCharacters ? characterColumn : '',
        columns.showHours ? hourColumn : '',
    ].filter(Boolean);
    const labelColumns = splitDayLabel
        ? ['1.75rem', 'minmax(0, 1fr)']
        : ['minmax(0, 1fr)'];

    return [...labelColumns, ...metricColumns].join(' ');
}

function getRowsTotal(rows: Array<{ totals: Totals }>, metric: 'characters' | 'hours'): string {
    const totals = rows.reduce<Totals>((acc, row) => ({
        minutes: acc.minutes + row.totals.minutes,
        characters: acc.characters + row.totals.characters,
    }), { minutes: 0, characters: 0 });

    return metric === 'characters' ? totals.characters.toLocaleString() : formatStatsDuration(totals.minutes);
}

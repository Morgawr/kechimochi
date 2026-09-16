/**
 * A DOM-light labelled-cell grid, controlled and single-select. Has no knowledge of dates or
 * periods — the caller supplies rows of cells (or `null` for a blank slot) and absolute keys.
 */
import { escapeHTML, escapeAttribute } from '../html';

export interface CalendarGridCell {
    key: string;
    label: string;
    accessibleName: string;
    className?: string;
}

export type CalendarGridRow = (CalendarGridCell | null)[];

export interface CalendarGridColumnHeader {
    label: string;
    className?: string;
}

export interface CalendarGridOptions {
    ariaLabel: string;
    cellClassName: string;
    dataAttributeName: string;
    columnHeaders?: CalendarGridColumnHeader[];
    rows: CalendarGridRow[];
    selectedKey: string | null;
    focusedKey?: string | null;
    restoreFocus?: boolean;
    onSelect: (key: string) => void;
}

function buildHeaderRow(columnHeaders: CalendarGridColumnHeader[]): string {
    const headerCells = columnHeaders
        .map(header => {
            const className = ['calendar-grid-column-header', header.className].filter(Boolean).join(' ');
            return `<th scope="col" class="${className}">${escapeHTML(header.label)}</th>`;
        })
        .join('');
    return `<thead><tr>${headerCells}</tr></thead>`;
}

function buildBodyCell(cell: CalendarGridCell | null, options: CalendarGridOptions): string {
    if (!cell) return `<td class="calendar-grid-blank" aria-hidden="true"></td>`;

    const isSelected = cell.key === options.selectedKey;
    const className = [options.cellClassName, cell.className].filter(Boolean).join(' ');
    return `<td><button type="button" class="${className}" data-${options.dataAttributeName}="${escapeAttribute(cell.key)}" data-calendar-cell aria-pressed="${isSelected}" aria-label="${escapeAttribute(cell.accessibleName)}">${escapeHTML(cell.label)}</button></td>`;
}

export function renderCalendarGrid(container: HTMLElement, options: CalendarGridOptions): void {
    const headerHtml = options.columnHeaders ? buildHeaderRow(options.columnHeaders) : '';
    const bodyHtml = options.rows
        .map(row => `<tr>${row.map(cell => buildBodyCell(cell, options)).join('')}</tr>`)
        .join('');
    container.innerHTML = `<table class="calendar-grid" role="grid" aria-label="${escapeAttribute(options.ariaLabel)}">${headerHtml}<tbody>${bodyHtml}</tbody></table>`;

    const dataAttribute = `data-${options.dataAttributeName}`;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-calendar-cell]'));
    if (buttons.length === 0) return;

    const findByKey = (key: string | null | undefined) =>
        key ? buttons.find(button => button.getAttribute(dataAttribute) === key) : undefined;
    const firstInsideCell = buttons.find(button => !button.classList.contains('cal-day-outside'));
    const focusTarget = findByKey(options.focusedKey) ?? findByKey(options.selectedKey) ?? firstInsideCell ?? buttons[0];
    if (options.restoreFocus) focusTarget.focus();

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const key = button.getAttribute(dataAttribute);
            if (key) options.onSelect(key);
        });
    });

}

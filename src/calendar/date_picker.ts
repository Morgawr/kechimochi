/**
 * `DatePicker` — the prev/next-navigable header over `grid.ts`, for one of three scopes:
 * `day` (7-column month grid), `month` (JAN…DEC grid) or `year` (a 12-year block grid).
 */
import { escapeHTML, escapeAttribute } from '../html';
import {
    formatReducedDate,
    formatUtcIsoDate,
    localTodayAnchor,
    precisionKeyLength,
    utcDateFromParts,
    type DateAnchor,
    type DateKey,
    type DateScope,
} from '../time';
import { renderCalendarGrid, type CalendarGridCell, type CalendarGridColumnHeader, type CalendarGridRow } from './grid';

export interface DatePicker {
    setValue(value: DateKey): void;
    getViewAnchor(): DateAnchor;
    focus(): void;
    destroy(): void;
}

export interface BuildCalendarOptions {
    scope?: DateScope;
    weekStartDay?: number;
    viewAnchor?: DateAnchor;
}

const DEFAULT_WEEK_START_DAY = 1;

export function normalizeWeekStartDay(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return DEFAULT_WEEK_START_DAY;
    if (typeof value === 'string' && value.trim() === '') return DEFAULT_WEEK_START_DAY;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) return DEFAULT_WEEK_START_DAY;
    return parsed;
}

export function supportsNativeMonthInput(): boolean {
    const input = document.createElement('input');
    input.type = 'month';
    return input.type === 'month';
}

const WEEKDAY_ABBREVIATIONS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const WEEK_COLUMNS = 7;
const MAXIMUM_LEADING_OFFSET = WEEK_COLUMNS - 1;
const MAXIMUM_DAYS_IN_MONTH = 31;
const DAY_GRID_ROWS = Math.ceil((MAXIMUM_LEADING_OFFSET + MAXIMUM_DAYS_IN_MONTH) / WEEK_COLUMNS);
const DAY_GRID_CELL_COUNT = DAY_GRID_ROWS * WEEK_COLUMNS;

const MINIMUM_YEAR = 1;
const MAXIMUM_YEAR = 9999;

const WEEKEND_HEADER_CLASSES: Readonly<Record<number, string>> = {
    0: 'calendar-grid-column-header-sunday',
    6: 'calendar-grid-column-header-saturday',
};
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBREVIATIONS_UPPER = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const MONTHS_PER_YEAR = 12;
const COARSE_GRID_COLUMNS = 4;
const COARSE_GRID_ROWS = 3;
export const YEAR_BLOCK_SIZE = COARSE_GRID_COLUMNS * COARSE_GRID_ROWS;

interface Period {
    year: number;
    month: number;
    blockOrigin: number;
}

interface ScopeContent {
    cellClassName: string;
    dataAttributeName: string;
    columnHeaders?: CalendarGridColumnHeader[];
    rows: CalendarGridRow[];
    periodLabel: string;
    gridAriaLabel: string;
    previousLabel: string;
    nextLabel: string;
}

function chunkIntoRows(cells: (CalendarGridCell | null)[], columns: number): CalendarGridRow[] {
    const rows: CalendarGridRow[] = [];
    for (let index = 0; index < cells.length; index += columns) {
        rows.push(cells.slice(index, index + columns));
    }
    const lastRow = rows[rows.length - 1];
    while (lastRow && lastRow.length < columns) lastRow.push(null);
    return rows;
}

function describeMonthYear(year: number, month: number): string {
    const normalizedMonth = ((month % 12) + 12) % 12;
    const yearOffset = Math.floor(month / 12);
    return `${MONTH_NAMES[normalizedMonth]} ${year + yearOffset}`;
}

function describeYearBlock(blockOrigin: number): string {
    const start = Math.max(blockOrigin, 1);
    const end = Math.min(blockOrigin + YEAR_BLOCK_SIZE - 1, MAXIMUM_YEAR);
    return `${start} – ${end}`;
}

function buildDayScopeContent(period: Period, weekStartDay: number): ScopeContent {
    const monthStart = utcDateFromParts(period.year, period.month, 1);
    const referenceYear = monthStart.getUTCFullYear();
    const referenceMonth = monthStart.getUTCMonth();
    const leadingOffset = (monthStart.getUTCDay() - weekStartDay + WEEK_COLUMNS) % WEEK_COLUMNS;

    const columnHeaders: CalendarGridColumnHeader[] = Array.from({ length: WEEK_COLUMNS }, (_, index) => {
        const weekday = (weekStartDay + index) % WEEK_COLUMNS;
        return { label: WEEKDAY_ABBREVIATIONS[weekday], className: WEEKEND_HEADER_CLASSES[weekday] };
    });

    const todayKey = localTodayAnchor();
    const cells: (CalendarGridCell | null)[] = [];
    for (let cellIndex = 0; cellIndex < DAY_GRID_CELL_COUNT; cellIndex++) {
        const cellDate = utcDateFromParts(referenceYear, referenceMonth, 1 - leadingOffset + cellIndex);
        const cellYear = cellDate.getUTCFullYear();
        if (cellYear < MINIMUM_YEAR || cellYear > MAXIMUM_YEAR) {
            cells.push(null);
            continue;
        }
        const key = formatUtcIsoDate(cellYear, cellDate.getUTCMonth() + 1, cellDate.getUTCDate());
        const isOutsideMonth = cellYear !== referenceYear || cellDate.getUTCMonth() !== referenceMonth;
        const className = [isOutsideMonth ? 'cal-day-outside' : '', key === todayKey ? 'today' : '']
            .filter(Boolean)
            .join(' ');
        cells.push({
            key,
            label: String(cellDate.getUTCDate()),
            accessibleName: formatReducedDate(key),
            className: className || undefined,
        });
    }

    return {
        cellClassName: 'cal-day',
        dataAttributeName: 'date',
        columnHeaders,
        rows: chunkIntoRows(cells, WEEK_COLUMNS),
        periodLabel: `${period.year} / ${period.month + 1}`,
        gridAriaLabel: describeMonthYear(period.year, period.month),
        previousLabel: `Go to ${describeMonthYear(period.year, period.month - 1)}`,
        nextLabel: `Go to ${describeMonthYear(period.year, period.month + 1)}`,
    };
}

function buildMonthScopeContent(period: Period): ScopeContent {
    const cells: CalendarGridCell[] = MONTH_ABBREVIATIONS_UPPER.map((label, index) => {
        const key = `${String(period.year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
        return { key, label, accessibleName: formatReducedDate(key) };
    });

    return {
        cellClassName: 'cal-month',
        dataAttributeName: 'month',
        rows: chunkIntoRows(cells, COARSE_GRID_COLUMNS),
        periodLabel: String(period.year),
        gridAriaLabel: String(period.year),
        previousLabel: `Go to ${period.year - 1}`,
        nextLabel: `Go to ${period.year + 1}`,
    };
}

function buildYearScopeContent(period: Period): ScopeContent {
    const cells: (CalendarGridCell | null)[] = [];
    for (let offset = 0; offset < YEAR_BLOCK_SIZE; offset++) {
        const year = period.blockOrigin + offset;
        if (year < MINIMUM_YEAR || year > MAXIMUM_YEAR) {
            cells.push(null);
            continue;
        }
        const key = String(year);
        cells.push({ key, label: key, accessibleName: formatReducedDate(key) });
    }

    const blockLabel = describeYearBlock(period.blockOrigin);
    return {
        cellClassName: 'cal-year',
        dataAttributeName: 'year',
        rows: chunkIntoRows(cells, COARSE_GRID_COLUMNS),
        periodLabel: blockLabel,
        gridAriaLabel: blockLabel,
        previousLabel: `Go to ${describeYearBlock(period.blockOrigin - YEAR_BLOCK_SIZE)}`,
        nextLabel: `Go to ${describeYearBlock(period.blockOrigin + YEAR_BLOCK_SIZE)}`,
    };
}

function buildScopeContent(scope: DateScope, period: Period, weekStartDay: number): ScopeContent {
    switch (scope) {
        case 'day':
            return buildDayScopeContent(period, weekStartDay);
        case 'month':
            return buildMonthScopeContent(period);
        case 'year':
            return buildYearScopeContent(period);
    }
}

function derivePeriod(scope: DateScope, key: string): Period {
    if (key.length !== precisionKeyLength(scope)) {
        throw new Error(`DatePicker: key "${key}" does not match scope "${scope}"`);
    }
    const year = Number(key.slice(0, 4));
    if (scope === 'day') return { year, month: Number(key.slice(5, 7)) - 1, blockOrigin: 0 };
    if (scope === 'month') return { year, month: 0, blockOrigin: 0 };
    return { year, month: 0, blockOrigin: Math.floor(year / YEAR_BLOCK_SIZE) * YEAR_BLOCK_SIZE };
}

function viewAnchorOf(scope: DateScope, period: Period): DateAnchor {
    if (scope === 'day') return formatUtcIsoDate(period.year, period.month + 1, 1) as DateAnchor;
    if (scope === 'month') return formatUtcIsoDate(period.year, 1, 1) as DateAnchor;
    return formatUtcIsoDate(Math.max(period.blockOrigin, MINIMUM_YEAR), 1, 1) as DateAnchor;
}

function periodFromAnchor(scope: DateScope, anchor: string): Period {
    return derivePeriod(scope, anchor.slice(0, precisionKeyLength(scope)));
}

function canStepPeriod(scope: DateScope, period: Period, direction: 1 | -1): boolean {
    const stepped = stepPeriod(scope, period, direction);
    if (scope === 'year') {
        return stepped.blockOrigin + YEAR_BLOCK_SIZE > MINIMUM_YEAR && stepped.blockOrigin <= MAXIMUM_YEAR;
    }
    return stepped.year >= MINIMUM_YEAR && stepped.year <= MAXIMUM_YEAR;
}

function stepPeriod(scope: DateScope, period: Period, direction: 1 | -1): Period {
    if (scope === 'day') {
        const totalMonths = period.year * MONTHS_PER_YEAR + period.month + direction;
        return {
            ...period,
            year: Math.floor(totalMonths / MONTHS_PER_YEAR),
            month: ((totalMonths % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR,
        };
    }
    if (scope === 'month') return { ...period, year: period.year + direction };
    return { ...period, blockOrigin: period.blockOrigin + direction * YEAR_BLOCK_SIZE };
}

function computeEquivalentKey(scope: DateScope, previousKey: string, previousPeriod: Period, newPeriod: Period): string {
    if (scope === 'day') {
        const day = Number(previousKey.slice(8, 10));
        const daysInNewMonth = utcDateFromParts(newPeriod.year, newPeriod.month + 1, 0).getUTCDate();
        return formatUtcIsoDate(newPeriod.year, newPeriod.month + 1, Math.min(day, daysInNewMonth));
    }
    if (scope === 'month') return `${String(newPeriod.year).padStart(4, '0')}-${previousKey.slice(5, 7)}`;

    const rawOffset = Number(previousKey) - previousPeriod.blockOrigin;
    const offsetInBlock = Math.min(Math.max(rawOffset, 0), YEAR_BLOCK_SIZE - 1);
    return String(newPeriod.blockOrigin + offsetInBlock);
}

export function buildCalendar(
    container: HTMLElement,
    initialValue: string,
    onSelect: (value: string) => void,
    options: BuildCalendarOptions = {},
): DatePicker {
    const scope: DateScope = options.scope ?? 'day';
    const weekStartDay = normalizeWeekStartDay(options.weekStartDay);

    let selectedKey = initialValue;
    let focusedKey: string | null = null;
    let period = options.viewAnchor
        ? periodFromAnchor(scope, options.viewAnchor)
        : derivePeriod(scope, selectedKey);

    const handleSelect = (key: string) => {
        selectedKey = key;
        focusedKey = key;
        period = derivePeriod(scope, key);
        render(true);
        onSelect(key);
    };

    const render = (restoreFocus: boolean) => {
        const content = buildScopeContent(scope, period, weekStartDay);
        container.innerHTML = `
            <div class="calendar-date-picker">
                <div class="calendar-date-picker-header">
                    <button type="button" class="btn btn-ghost cal-nav-prev" aria-label="${escapeAttribute(content.previousLabel)}">&lsaquo;</button>
                    <span class="calendar-date-picker-label">${escapeHTML(content.periodLabel)}</span>
                    <button type="button" class="btn btn-ghost cal-nav-next" aria-label="${escapeAttribute(content.nextLabel)}">&rsaquo;</button>
                </div>
                <div class="calendar-date-picker-grid"></div>
            </div>
        `;

        const previousButton = container.querySelector<HTMLButtonElement>('.cal-nav-prev')!;
        const nextButton = container.querySelector<HTMLButtonElement>('.cal-nav-next')!;
        previousButton.disabled = !canStepPeriod(scope, period, -1);
        nextButton.disabled = !canStepPeriod(scope, period, 1);
        previousButton.addEventListener('click', () => step(-1));
        nextButton.addEventListener('click', () => step(1));

        const gridContainer = container.querySelector<HTMLElement>('.calendar-date-picker-grid')!;
        renderCalendarGrid(gridContainer, {
            ariaLabel: content.gridAriaLabel,
            cellClassName: content.cellClassName,
            dataAttributeName: content.dataAttributeName,
            columnHeaders: content.columnHeaders,
            rows: content.rows,
            selectedKey,
            focusedKey,
            restoreFocus,
            onSelect: handleSelect,
        });
    };

    const step = (direction: 1 | -1) => {
        const previousPeriod = period;
        const previousKey = focusedKey ?? selectedKey;
        period = stepPeriod(scope, period, direction);
        focusedKey = computeEquivalentKey(scope, previousKey, previousPeriod, period);
        render(false);
        const navigationSelector = direction < 0 ? '.cal-nav-prev' : '.cal-nav-next';
        const navigationButton = container.querySelector<HTMLButtonElement>(navigationSelector);
        if (navigationButton && !navigationButton.disabled) navigationButton.focus();
    };

    render(false);

    return {
        setValue(value: DateKey) {
            selectedKey = value;
            focusedKey = value;
            period = derivePeriod(scope, value);
            render(false);
        },
        getViewAnchor() {
            return viewAnchorOf(scope, period);
        },
        focus() {
            const cells = container.querySelectorAll<HTMLButtonElement>('button[data-calendar-cell]');
            const selected = container.querySelector<HTMLButtonElement>('button[data-calendar-cell][aria-pressed="true"]');
            (selected ?? cells[0])?.focus();
        },
        destroy() {
            container.innerHTML = '';
        },
    };
}

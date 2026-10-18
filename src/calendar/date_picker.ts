/**
 * `DatePicker` — the prev/next-navigable header over `grid.ts`, for one of three scopes:
 * `day` (7-column month grid), `month` (JAN…DEC grid) or `year` (a 12-year block grid).
 */
import { escapeHTML, escapeAttribute } from '../html';
import { CHEVRON_LEFT, CHEVRON_RIGHT, DOUBLE_CHEVRON_LEFT, DOUBLE_CHEVRON_RIGHT, renderIcon } from '../icons';
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
    focusScopeTab(): void;
    destroy(): void;
}

export interface BuildCalendarOptions {
    scope?: DateScope;
    scopes?: readonly DateScope[];
    onScopeSelect?: (scope: DateScope) => void;
    weekStartDay?: number;
    viewAnchor?: DateAnchor;
}

const SCOPE_TABS: readonly { scope: DateScope; label: string; tooltip: string }[] = [
    { scope: 'day', label: 'Day', tooltip: 'Pick a day' },
    { scope: 'month', label: 'Month', tooltip: 'Pick a whole month' },
    { scope: 'year', label: 'Year', tooltip: 'Pick a whole year' },
];

const DEFAULT_WEEK_START_DAY = 1;

export function normalizeWeekStartDay(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return DEFAULT_WEEK_START_DAY;
    if (typeof value === 'string' && value.trim() === '') return DEFAULT_WEEK_START_DAY;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) return DEFAULT_WEEK_START_DAY;
    return parsed;
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
const COARSE_GRID_COLUMNS = 3;
const COARSE_GRID_ROWS = 4;
export const YEAR_BLOCK_SIZE = COARSE_GRID_COLUMNS * COARSE_GRID_ROWS;
const COARSE_GRID_CLASS_NAME = 'calendar-grid-coarse';

const LARGE_STEP_SIZES: Readonly<Record<DateScope, number | null>> = {
    day: MONTHS_PER_YEAR,
    month: YEAR_BLOCK_SIZE,
    year: null,
};

interface Period {
    year: number;
    month: number;
    blockOrigin: number;
}

interface ScopeContent {
    cellClassName: string;
    gridClassName?: string;
    dataAttributeName: string;
    columnHeaders?: CalendarGridColumnHeader[];
    rows: CalendarGridRow[];
    periodLabel: string;
}

function chunkIntoRows(cells: (CalendarGridCell | null)[], columns: number): CalendarGridRow[] {
    const rows: CalendarGridRow[] = [];
    for (let index = 0; index < cells.length; index += columns) {
        rows.push(cells.slice(index, index + columns));
    }
    const lastRow = rows.at(-1);
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
    };
}

function buildMonthScopeContent(period: Period): ScopeContent {
    const cells: CalendarGridCell[] = MONTH_ABBREVIATIONS_UPPER.map((label, index) => {
        const key = `${String(period.year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
        return { key, label, accessibleName: formatReducedDate(key) };
    });

    return {
        cellClassName: 'cal-month',
        gridClassName: COARSE_GRID_CLASS_NAME,
        dataAttributeName: 'month',
        rows: chunkIntoRows(cells, COARSE_GRID_COLUMNS),
        periodLabel: String(period.year),
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

    return {
        cellClassName: 'cal-year',
        gridClassName: COARSE_GRID_CLASS_NAME,
        dataAttributeName: 'year',
        rows: chunkIntoRows(cells, COARSE_GRID_COLUMNS),
        periodLabel: describeYearBlock(period.blockOrigin),
    };
}

function describePeriod(scope: DateScope, period: Period): string {
    if (scope === 'day') return describeMonthYear(period.year, period.month);
    if (scope === 'month') return String(period.year);
    return describeYearBlock(period.blockOrigin);
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

function canStepPeriod(scope: DateScope, period: Period, offset: number): boolean {
    const stepped = stepPeriod(scope, period, offset);
    if (scope === 'year') {
        return stepped.blockOrigin + YEAR_BLOCK_SIZE > MINIMUM_YEAR && stepped.blockOrigin <= MAXIMUM_YEAR;
    }
    return stepped.year >= MINIMUM_YEAR && stepped.year <= MAXIMUM_YEAR;
}

function stepPeriod(scope: DateScope, period: Period, offset: number): Period {
    if (scope === 'day') {
        const totalMonths = period.year * MONTHS_PER_YEAR + period.month + offset;
        return {
            ...period,
            year: Math.floor(totalMonths / MONTHS_PER_YEAR),
            month: ((totalMonths % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR,
        };
    }
    if (scope === 'month') return { ...period, year: period.year + offset };
    return { ...period, blockOrigin: period.blockOrigin + offset * YEAR_BLOCK_SIZE };
}

type CalendarNavigation = 'previous-jump' | 'previous' | 'next' | 'next-jump';

interface NavigationButton {
    navigation: CalendarNavigation;
    icon: string;
    offset: number | null;
}

function buildNavigationButtonHtml(scope: DateScope, period: Period, button: NavigationButton): string {
    const isEnabled = button.offset !== null && canStepPeriod(scope, period, button.offset);
    const label = button.offset === null ? '' : `Go to ${describePeriod(scope, stepPeriod(scope, period, button.offset))}`;
    const labelAttributes = label ? ` aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}"` : ' aria-hidden="true"';
    return `<button type="button" class="btn btn-outline btn-icon-small" data-calendar-nav="${button.navigation}"${labelAttributes}${isEnabled ? '' : ' disabled'}>${renderIcon(button.icon)}</button>`;
}

function buildScopeTabsHtml(scopes: readonly DateScope[], activeScope: DateScope): string {
    const tabs = SCOPE_TABS.filter(tab => scopes.includes(tab.scope));
    if (tabs.length < 2) return '';
    const tabsHtml = tabs
        .map(tab => {
            const isActive = tab.scope === activeScope;
            return `<button type="button" role="tab" class="calendar-scope-tab${isActive ? ' is-active' : ''}" data-date-scope="${tab.scope}" aria-selected="${isActive}" title="${escapeAttribute(tab.tooltip)}"><span class="calendar-scope-tab-label">${escapeHTML(tab.label)}</span></button>`;
        })
        .join('');
    return `<div class="calendar-scope-tabs" role="tablist" aria-label="Date precision">${tabsHtml}</div>`;
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
    const scopes = options.scopes ?? [scope];
    const weekStartDay = normalizeWeekStartDay(options.weekStartDay);
    const largeStepSize = LARGE_STEP_SIZES[scope];
    const backwardButtons: readonly NavigationButton[] = [
        { navigation: 'previous-jump', icon: DOUBLE_CHEVRON_LEFT, offset: largeStepSize === null ? null : -largeStepSize },
        { navigation: 'previous', icon: CHEVRON_LEFT, offset: -1 },
    ];
    const forwardButtons: readonly NavigationButton[] = [
        { navigation: 'next', icon: CHEVRON_RIGHT, offset: 1 },
        { navigation: 'next-jump', icon: DOUBLE_CHEVRON_RIGHT, offset: largeStepSize },
    ];

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
                ${buildScopeTabsHtml(scopes, scope)}
                <div class="calendar-date-picker-header">
                    <div class="calendar-nav-group">
                        ${backwardButtons.map(button => buildNavigationButtonHtml(scope, period, button)).join('')}
                    </div>
                    <span class="calendar-date-picker-label">${escapeHTML(content.periodLabel)}</span>
                    <div class="calendar-nav-group">
                        ${forwardButtons.map(button => buildNavigationButtonHtml(scope, period, button)).join('')}
                    </div>
                </div>
                <div class="calendar-date-picker-grid"></div>
            </div>
        `;

        for (const { navigation, offset } of [...backwardButtons, ...forwardButtons]) {
            if (offset === null) continue;
            container.querySelector<HTMLButtonElement>(`[data-calendar-nav="${navigation}"]`)!
                .addEventListener('click', () => step(navigation, offset));
        }

        for (const scopeTab of container.querySelectorAll<HTMLButtonElement>('.calendar-scope-tab')) {
            scopeTab.addEventListener('click', () => {
                const tabScope = SCOPE_TABS.find(tab => tab.scope === scopeTab.dataset.dateScope)?.scope;
                if (tabScope && tabScope !== scope) options.onScopeSelect?.(tabScope);
            });
        }

        const gridContainer = container.querySelector<HTMLElement>('.calendar-date-picker-grid')!;
        renderCalendarGrid(gridContainer, {
            ariaLabel: describePeriod(scope, period),
            cellClassName: content.cellClassName,
            gridClassName: content.gridClassName,
            dataAttributeName: content.dataAttributeName,
            columnHeaders: content.columnHeaders,
            rows: content.rows,
            selectedKey,
            focusedKey,
            restoreFocus,
            onSelect: handleSelect,
        });
    };

    const step = (navigation: CalendarNavigation, offset: number) => {
        const previousPeriod = period;
        const previousKey = focusedKey ?? selectedKey;
        period = stepPeriod(scope, period, offset);
        focusedKey = computeEquivalentKey(scope, previousKey, previousPeriod, period);
        render(false);
        const navigationButton = container.querySelector<HTMLButtonElement>(`[data-calendar-nav="${navigation}"]`);
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
        focusScopeTab() {
            container.querySelector<HTMLButtonElement>('.calendar-scope-tab.is-active')?.focus();
        },
        destroy() {
            container.innerHTML = '';
        },
    };
}

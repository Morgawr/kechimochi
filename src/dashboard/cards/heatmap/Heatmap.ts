import { Component } from '../../../component';
import { html, rawHtml } from '../../../html';
import { DailyHeatmap, getDashboardHeatmapYear } from '../../../api';
import { Logger } from '../../../logger';
import { measureSynchronous } from '../../../performance';
import { renderNavigationChevron } from '../../../icons';
import { getLocalISODate } from '../../activity_ranges';
import type { DashboardCardDescriptor } from '../../dashboard_layout';
import { renderDashboardCardEmptyState, renderDashboardCardShell } from '../../card_shell';
import {
    buildYearColumns,
    getPeriodForDate,
    getRegionOutlineEdges,
    isDateInRange,
    isSameSelection,
    parseMonthKey,
    resolveDisplayedMonth,
    stepMonth,
    type DateRange,
    type DisplayedMonth,
    type HeatmapSelection,
    type HeatmapSlot,
} from './heatmap_layout';
import { IN_SELECTED_PERIOD_CLASS, type HeatmapRenderContext } from './heatmap_day_cell';
import { renderYearGrid } from './heatmap_year_grid';
import { renderMonthCalendar } from './heatmap_month_calendar';

export const HEATMAP_CARD = {
    id: 'heatmap',
    label: 'Heatmap',
    spans: { wide: 12, medium: 12 },
    dataSources: ['heatmap'],
} as const satisfies DashboardCardDescriptor;

const DEFAULT_WEEK_START_DAY = 1;
const INTERACTIVE_CELL_SELECTOR = '.heatmap-cell-interactive[data-date], .heatmap-calendar-day-interactive[data-date]';
const PREVIEW_POINTER_TYPES = new Set(['mouse', 'pen']);

export interface HeatmapSnapshot {
    heatmapData: DailyHeatmap[];
    year: number;
}

export interface HeatmapInitialState extends HeatmapSnapshot {
    selection?: HeatmapSelection | null;
}

interface HeatmapState extends HeatmapSnapshot {
    monthIndex: number;
    selection: HeatmapSelection | null;
}

export interface HeatmapHost {
    nextRequestId(): number;
    currentGeneration(): number;
    isCurrent(generation: number, requestId: number, responseId: number): boolean;
}

export class Heatmap extends Component<HeatmapState> {
    private readonly host: HeatmapHost;
    private readonly onDateSelect?: (dateStr: string) => void;
    private activeYearRequest = 0;

    constructor(
        container: HTMLElement,
        initialState: HeatmapInitialState,
        host: HeatmapHost,
        onDateSelect?: (dateStr: string) => void
    ) {
        super(container, {
            heatmapData: initialState.heatmapData,
            year: initialState.year,
            monthIndex: getInitialMonthIndex(initialState.year),
            selection: initialState.selection ?? null,
        });
        this.host = host;
        this.onDateSelect = onDateSelect;
    }

    get displayedYear(): number {
        return this.state.year;
    }

    public setSelection(selection: HeatmapSelection | null): void {
        const target = this.getFollowTarget(selection);
        const changes = { selection, monthIndex: target.monthIndex };
        if (target.year === this.state.year) {
            this.setState(changes);
        } else {
            this.loadYear(target.year, changes);
        }
    }

    public applySnapshot(snapshot: HeatmapSnapshot, selection: HeatmapSelection | null): void {
        const target = this.getFollowTarget(selection);
        const changes = { selection, monthIndex: target.monthIndex };
        if (target.year === snapshot.year) {
            this.setState({ ...snapshot, ...changes });
        } else {
            this.loadYear(target.year, changes);
        }
    }

    private getFollowTarget(selection: HeatmapSelection | null): DisplayedMonth {
        const displayed = this.getDisplayedMonth();
        return isSameSelection(this.state.selection, selection) ? displayed : resolveDisplayedMonth(displayed, selection);
    }

    private getDisplayedMonth(): DisplayedMonth {
        return { year: this.state.year, monthIndex: this.state.monthIndex };
    }

    private loadYear(year: number, changes: Partial<HeatmapState> = {}): void {
        const generation = this.host.currentGeneration();
        const requestId = this.host.nextRequestId();
        this.activeYearRequest = requestId;
        this.setState({ ...changes, year, heatmapData: [] });

        getDashboardHeatmapYear({ request_id: requestId, year }).then(response => {
            if (requestId !== this.activeYearRequest
                || !this.host.isCurrent(generation, requestId, response.request_id)
                || response.year !== year) return;
            measureSynchronous('render', 'dashboard_heatmap_response', () => {
                this.setState({ year: response.year, heatmapData: response.days });
            });
        }).catch(error => {
            if (requestId === this.activeYearRequest && this.host.isCurrent(generation, requestId, requestId)) {
                Logger.error('Failed to load dashboard heatmap year', error);
            }
        });
    }

    private showMonth(month: DisplayedMonth): void {
        if (month.year === this.state.year) {
            this.setState({ monthIndex: month.monthIndex });
        } else {
            this.loadYear(month.year, { monthIndex: month.monthIndex });
        }
    }

    render() {
        const focusSelector = this.getFocusRestoreSelector();
        this.clear();

        if (Number.isNaN(this.state.year)) {
            this.container.appendChild(html`${rawHtml(renderDashboardCardShell({
                title: HEATMAP_CARD.label,
                body: renderDashboardCardEmptyState('No data recorded yet.'),
            }))}`);
            return;
        }

        const context = this.buildRenderContext();
        const yearColumns = buildYearColumns(this.state.year, context.weekStartDay);
        const card = html`
            <div class="card">
                <div class="heatmap-header heatmap-year-header">
                    <div class="heatmap-title-controls">
                        <button class="btn btn-ghost chart-nav-button" id="btn-heatmap-prev" aria-label="Previous year">
                            ${rawHtml(renderNavigationChevron('previous'))}
                        </button>
                        <h3 class="heatmap-title dashboard-module-title">Heatmap (<span id="heatmap-year-label">${this.state.year}</span>)</h3>
                        <button class="btn btn-ghost chart-nav-button" id="btn-heatmap-next" aria-label="Next year">
                            ${rawHtml(renderNavigationChevron('next'))}
                        </button>
                    </div>
                </div>
                <div class="heatmap-year-frame">
                    ${rawHtml(renderYearGrid(yearColumns, context))}
                </div>
                ${rawHtml(renderMonthCalendar(this.getDisplayedMonth(), context))}
            </div>
        `;

        this.container.appendChild(card);
        this.attachEvents(card, yearColumns);
        this.restoreFocus(focusSelector);
    }

    private buildRenderContext(): HeatmapRenderContext {
        const activityByDate = new Map<string, DailyHeatmap>();
        for (const day of this.state.heatmapData) activityByDate.set(day.date, day);

        const style = getComputedStyle(document.body);
        const getThemeNumber = (property: string) => Number.parseFloat(style.getPropertyValue(property).trim());

        return {
            days: this.state.heatmapData,
            activityByDate,
            theme: {
                hue: style.getPropertyValue('--heatmap-hue').trim(),
                saturationBase: getThemeNumber('--heatmap-sat-base'),
                saturationRange: getThemeNumber('--heatmap-sat-range'),
                lightnessBase: getThemeNumber('--heatmap-light-base'),
                lightnessRange: getThemeNumber('--heatmap-light-range'),
            },
            todayIso: getLocalISODate(new Date()),
            selection: this.state.selection,
            weekStartDay: this.getWeekStartDay(),
        };
    }

    private getWeekStartDay(): number {
        return this.state.selection?.weekStartDay ?? DEFAULT_WEEK_START_DAY;
    }

    private attachEvents(card: HTMLElement, yearColumns: HeatmapSlot[][]): void {
        card.querySelector('#btn-heatmap-prev')?.addEventListener('click', () => this.loadYear(this.state.year - 1));
        card.querySelector('#btn-heatmap-next')?.addEventListener('click', () => this.loadYear(this.state.year + 1));

        for (const button of card.querySelectorAll<HTMLButtonElement>('[data-heatmap-month-step]')) {
            const direction = Number(button.dataset.heatmapMonthStep);
            button.addEventListener('click', () => this.showMonth(stepMonth(this.getDisplayedMonth(), direction)));
        }
        for (const button of card.querySelectorAll<HTMLButtonElement>('[data-heatmap-month]')) {
            const month = parseMonthKey(button.dataset.heatmapMonth!);
            button.addEventListener('click', () => this.showMonth(month));
        }

        this.attachDateSelection(card);
        this.attachPeriodPreview(card, yearColumns);
    }

    private attachDateSelection(card: HTMLElement): void {
        if (!this.onDateSelect) return;

        const activateCell = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return;
            const date = target.closest<HTMLElement>(INTERACTIVE_CELL_SELECTOR)?.dataset.date;
            if (date) this.onDateSelect?.(date);
        };

        card.addEventListener('click', event => activateCell(event.target));
        card.querySelector<HTMLElement>('.heatmap')?.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            activateCell(event.target);
            event.preventDefault();
        });
    }

    private attachPeriodPreview(card: HTMLElement, yearColumns: HeatmapSlot[][]): void {
        const period = this.state.selection?.period ?? null;
        const heatmap = card.querySelector<HTMLElement>('.heatmap');
        if (!heatmap || period === null || period === 'all-time') return;

        const cellsByDate = new Map<string, HTMLElement>();
        for (const cell of heatmap.querySelectorAll<HTMLElement>('.heatmap-cell[data-date]')) {
            cellsByDate.set(cell.dataset.date!, cell);
        }
        let previewKey: string | null = null;
        let previewedCells: HTMLElement[] = [];
        const showPreview = (range: DateRange | null) => {
            const key = range ? `${range.start}/${range.end}` : null;
            if (key === previewKey) return;
            previewKey = key;
            for (const cell of previewedCells) delete cell.dataset.previewEdges;
            previewedCells = [];
            if (!range) return;
            for (const [date, edges] of getRegionOutlineEdges(yearColumns, date => isDateInRange(date, range), 'columns')) {
                const cell = cellsByDate.get(date);
                if (!cell) continue;
                cell.dataset.previewEdges = edges.join(' ');
                previewedCells.push(cell);
            }
        };

        heatmap.addEventListener('pointerover', event => {
            if (!PREVIEW_POINTER_TYPES.has(event.pointerType) || !(event.target instanceof HTMLElement)) return;
            const cell = event.target.closest<HTMLElement>('.heatmap-cell-interactive[data-date]');
            const date = cell && !cell.classList.contains(IN_SELECTED_PERIOD_CLASS) ? cell.dataset.date : undefined;
            showPreview(date ? getPeriodForDate(date, period, this.getWeekStartDay()) : null);
        });
        heatmap.addEventListener('pointerleave', () => showPreview(null));
    }

    private getFocusRestoreSelector(): string | null {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !this.container.contains(active) || !active.matches(':focus-visible')) {
            return null;
        }
        if (active.id) return `#${active.id}`;
        if (active.dataset.heatmapMonthStep) return `[data-heatmap-month-step="${active.dataset.heatmapMonthStep}"]`;
        if (active.dataset.heatmapMonth) return `[data-heatmap-month="${active.dataset.heatmapMonth}"]`;
        if (active.dataset.date) {
            const kind = active.classList.contains('heatmap-cell') ? '.heatmap-cell' : '.heatmap-calendar-day';
            return `${kind}[data-date="${active.dataset.date}"]`;
        }
        return null;
    }

    private restoreFocus(selector: string | null): void {
        if (!selector) return;
        this.container.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }
}

function getInitialMonthIndex(year: number): number {
    const today = new Date();
    return year === today.getFullYear() ? today.getMonth() : 0;
}

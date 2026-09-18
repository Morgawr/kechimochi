import { Component } from '../component';
import { html } from '../html';
import { ACTIVITY_TIME_RANGES, type ActivityRange } from './activity_ranges';
import type { DashboardGroupBy } from '../types';
import { openMultiSelect } from '../multi_select';
import type { DashboardCardId } from './dashboard_cards';

const RANGE_LABEL_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const RANGE_LABEL_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

function parseIsoDate(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00`);
}

function formatRangeLabel(range: ActivityRange): string {
    const start = parseIsoDate(range.validStart);
    switch (range.period) {
        case 'all-time':
            return 'All Time';
        case 'year':
            return start.getFullYear().toString();
        case 'month':
            return RANGE_LABEL_MONTH_FORMATTER.format(start);
        default: {
            const end = parseIsoDate(range.validEnd);
            return `${RANGE_LABEL_DAY_FORMATTER.format(start)} – ${RANGE_LABEL_DAY_FORMATTER.format(end)}, ${end.getFullYear()}`;
        }
    }
}

interface DashboardControlsState {
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: DashboardGroupBy;
    chartType: 'bar' | 'line';
    metric: 'minutes' | 'characters';
}

interface DashboardCardsMenuEntry {
    readonly id: DashboardCardId;
    readonly label: string;
}

export class DashboardControls extends Component<DashboardControlsState> {
    private readonly onChartParamChange: (params: Partial<DashboardControlsState>) => void;
    private readonly cards: readonly DashboardCardsMenuEntry[];
    private readonly getHiddenCards: () => ReadonlySet<DashboardCardId>;
    private readonly onToggleCard: (id: DashboardCardId, isVisible: boolean) => void;
    private readonly createSidePanelToggle: () => HTMLElement;
    private cardElement: HTMLElement | null = null;
    private closeCardsMenu: (() => void) | null = null;

    constructor(
        container: HTMLElement,
        initialState: DashboardControlsState,
        onChartParamChange: (params: Partial<DashboardControlsState>) => void,
        cards: readonly DashboardCardsMenuEntry[],
        getHiddenCards: () => ReadonlySet<DashboardCardId>,
        onToggleCard: (id: DashboardCardId, isVisible: boolean) => void,
        createSidePanelToggle: () => HTMLElement,
    ) {
        super(container, initialState);
        this.onChartParamChange = onChartParamChange;
        this.cards = cards;
        this.getHiddenCards = getHiddenCards;
        this.onToggleCard = onToggleCard;
        this.createSidePanelToggle = createSidePanelToggle;
    }

    public setState(newState: Partial<DashboardControlsState>): void {
        this.syncControlState(newState);
    }

    render(): void {
        if (this.cardElement) {
            this.syncControlState();
            return;
        }

        this.clear();
        const card = html`
            <div class="card dashboard-controls-card">
                <h3 class="dashboard-card-title">Dashboard Controls</h3>
                <div class="dashboard-controls-row">
                    <div class="activity-charts-title-controls dashboard-range-nav">
                        <button class="btn btn-ghost chart-nav-button" id="btn-chart-prev">
                            <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <span class="dashboard-range-label" id="dashboard-range-label"></span>
                        <button class="btn btn-ghost chart-nav-button" id="btn-chart-next">
                            <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="chart-toolbar">
                        <div class="chart-toolbar-group">
                            <span class="toggle-label ${this.state.chartType === 'bar' ? 'active' : ''}">Bar</span>
                            <label class="switch">
                                <input type="checkbox" id="toggle-chart-type" ${this.state.chartType === 'line' ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                            <span class="toggle-label ${this.state.chartType === 'line' ? 'active' : ''}">Line</span>
                        </div>

                        <div class="chart-toolbar-divider" aria-hidden="true"></div>

                        <div class="chart-toolbar-select-shell">
                            <select id="select-time-range" class="chart-toolbar-select">
                                <option value="7" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.WEEKLY ? 'selected' : ''}>Week</option>
                                <option value="30" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.MONTHLY ? 'selected' : ''}>Month</option>
                                <option value="365" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.YEARLY ? 'selected' : ''}>Year</option>
                                <option value="0" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME ? 'selected' : ''}>All Time</option>
                            </select>
                        </div>

                        <div class="chart-toolbar-divider" aria-hidden="true"></div>

                        <div class="chart-toolbar-group">
                            <span class="toggle-label ${this.state.groupByMode === 'activity_type' ? 'active' : ''}">Type</span>
                            <label class="switch">
                                <input type="checkbox" id="toggle-group-by" ${this.state.groupByMode === 'log_name' ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                            <span class="toggle-label ${this.state.groupByMode === 'log_name' ? 'active' : ''}">Name</span>
                        </div>

                        <div class="chart-toolbar-divider" aria-hidden="true"></div>

                        <div class="chart-toolbar-group">
                            <span class="toggle-label ${this.state.metric === 'minutes' ? 'active' : ''}">Time</span>
                            <label class="switch">
                                <input type="checkbox" id="toggle-metric" ${this.state.metric === 'characters' ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                            <span class="toggle-label ${this.state.metric === 'characters' ? 'active' : ''}">Chars</span>
                        </div>
                    </div>
                    ${this.createSidePanelToggle()}
                    <button type="button" class="multi-select-trigger" id="dashboard-cards-menu-button"
                        aria-haspopup="true" aria-expanded="false" aria-label="Cards">
                        <span class="multi-select-trigger-value" id="dashboard-cards-menu-value"></span>
                        <span class="multi-select-trigger-chevron" aria-hidden="true"></span>
                    </button>
                    <p class="dashboard-controls-hint" id="dashboard-controls-hint" hidden>Every card is hidden. Use Cards to bring one back.</p>
                </div>
            </div>
        `;
        this.container.appendChild(card);
        this.cardElement = card;
        this.setupListeners();
        this.setupCardsMenu();
        this.syncControlState();
        this.refreshCardsSummary();
    }

    private setupCardsMenu(): void {
        const button = this.cardElement?.querySelector<HTMLButtonElement>('#dashboard-cards-menu-button');
        button?.addEventListener('click', () => {
            if (this.closeCardsMenu) {
                this.closeCardsMenu();
                return;
            }
            const hiddenCards = this.getHiddenCards();
            const { close } = openMultiSelect<DashboardCardId>({
                anchor: button,
                label: 'Cards',
                items: this.cards.map(card => ({ value: card.id, label: card.label })),
                selectedValues: new Set(this.cards.map(card => card.id).filter(id => !hiddenCards.has(id))),
                onToggle: (value, isSelected) => this.onToggleCard(value, isSelected),
                onClose: () => { this.closeCardsMenu = null; },
            });
            this.closeCardsMenu = close;
        });
    }

    public refreshCardsSummary(): void {
        if (!this.cardElement) return;
        const hiddenCards = this.getHiddenCards();
        const visibleLabels = this.cards.filter(card => !hiddenCards.has(card.id)).map(card => card.label);
        const value = this.cardElement.querySelector<HTMLElement>('#dashboard-cards-menu-value');
        if (value) value.textContent = visibleLabels.length > 0 ? visibleLabels.join(', ') : 'No cards shown';
        const hint = this.cardElement.querySelector<HTMLElement>('#dashboard-controls-hint');
        if (hint) hint.hidden = visibleLabels.length > 0;
    }

    public closeCardsPanel(): void {
        this.closeCardsMenu?.();
    }

    private setupListeners(): void {
        if (!this.cardElement) return;
        this.cardElement.querySelector('#btn-chart-prev')?.addEventListener('click', () => {
            if (this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME) return;
            this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset + 1 });
        });
        this.cardElement.querySelector('#btn-chart-next')?.addEventListener('click', () => {
            if (this.state.timeRangeDays !== ACTIVITY_TIME_RANGES.ALL_TIME && this.state.timeRangeOffset > 0) {
                this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset - 1 });
            }
        });
        const toggleChartType = this.cardElement.querySelector<HTMLInputElement>('#toggle-chart-type');
        toggleChartType?.addEventListener('change', () => {
            this.onChartParamChange({ chartType: toggleChartType.checked ? 'line' : 'bar' });
        });
        const selectTimeRange = this.cardElement.querySelector<HTMLSelectElement>('#select-time-range');
        selectTimeRange?.addEventListener('change', () => {
            const days = Number.parseInt(selectTimeRange.value);
            this.onChartParamChange({ timeRangeDays: days, timeRangeOffset: 0 });
        });
        const toggleGroupBy = this.cardElement.querySelector<HTMLInputElement>('#toggle-group-by');
        toggleGroupBy?.addEventListener('change', () => {
            this.onChartParamChange({ groupByMode: toggleGroupBy.checked ? 'log_name' : 'activity_type' });
        });
        const toggleMetric = this.cardElement.querySelector<HTMLInputElement>('#toggle-metric');
        toggleMetric?.addEventListener('change', () => {
            this.onChartParamChange({ metric: toggleMetric.checked ? 'characters' : 'minutes' });
        });
    }

    private updateNavigationState(): void {
        if (!this.cardElement) return;
        const isAllTime = this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME;
        const prevButton = this.cardElement.querySelector<HTMLButtonElement>('#btn-chart-prev');
        const nextButton = this.cardElement.querySelector<HTMLButtonElement>('#btn-chart-next');

        if (prevButton) prevButton.disabled = isAllTime;
        if (nextButton) nextButton.disabled = isAllTime || this.state.timeRangeOffset === 0;
    }

    private syncToggle(selector: string, checked: boolean): void {
        if (!this.cardElement) return;
        const input = this.cardElement.querySelector<HTMLInputElement>(selector);
        if (!input) return;

        input.checked = checked;
        const labels = input.closest('.chart-toolbar-group')?.querySelectorAll<HTMLElement>('.toggle-label');
        labels?.item(0).classList.toggle('active', !checked);
        labels?.item(1).classList.toggle('active', checked);
    }

    public setRangeLabel(range: ActivityRange): void {
        const label = this.cardElement?.querySelector<HTMLElement>('#dashboard-range-label');
        if (label) label.textContent = formatRangeLabel(range);
    }

    public syncControlState(newState: Partial<DashboardControlsState> = {}): void {
        this.state = { ...this.state, ...newState };
        this.container.dataset.timeRangeDays = String(this.state.timeRangeDays);
        this.container.dataset.timeRangeOffset = String(this.state.timeRangeOffset);
        if (!this.cardElement) return;

        const rangeSelect = this.cardElement.querySelector<HTMLSelectElement>('#select-time-range');
        if (rangeSelect) rangeSelect.value = String(this.state.timeRangeDays);

        this.syncToggle('#toggle-chart-type', this.state.chartType === 'line');
        this.syncToggle('#toggle-group-by', this.state.groupByMode === 'log_name');
        this.syncToggle('#toggle-metric', this.state.metric === 'characters');
        this.updateNavigationState();
    }
}

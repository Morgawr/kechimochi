import { Component } from '../component';
import { html } from '../html';
import { ACTIVITY_TIME_RANGES, type ActivityRange } from './activity_ranges';
import type { DashboardGroupBy } from '../types';
import { createMultiSelectField, type MultiSelectField } from '../multi_select';
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
    private cardsMenuField: MultiSelectField | null = null;

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
        const cardsMenuField = createMultiSelectField<DashboardCardId>({
            id: 'dashboard-cards-menu-button',
            label: 'Cards',
            items: this.cards.map(card => ({ value: card.id, label: card.label })),
            getSelectedValues: () => {
                const hiddenCards = this.getHiddenCards();
                return new Set(this.cards.map(card => card.id).filter(id => !hiddenCards.has(id)));
            },
            onToggle: (value, isSelected) => this.onToggleCard(value, isSelected),
        });
        this.cardsMenuField = cardsMenuField;

        const card = html`
            <div class="card dashboard-controls-card">
                <div class="dashboard-controls-header">
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
                </div>
                <div class="dashboard-controls-fields">
                    <div class="dashboard-controls-cluster">
                        <div class="dashboard-controls-field dashboard-controls-field-stretch">
                            <span class="timeline-filter-label">Cards</span>
                            ${cardsMenuField.element}
                        </div>
                        <div class="dashboard-controls-field dashboard-controls-field-bare">
                            ${this.createSidePanelToggle()}
                        </div>
                    </div>
                    <div class="dashboard-controls-cluster">
                        <label class="dashboard-controls-field dashboard-controls-field-stretch">
                            <span class="timeline-filter-label">Period</span>
                            <select id="select-time-range">
                                <option value="7" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.WEEKLY ? 'selected' : ''}>Week</option>
                                <option value="30" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.MONTHLY ? 'selected' : ''}>Month</option>
                                <option value="365" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.YEARLY ? 'selected' : ''}>Year</option>
                                <option value="0" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME ? 'selected' : ''}>All Time</option>
                            </select>
                        </label>
                        <div class="dashboard-controls-field">
                            <span class="timeline-filter-label" id="toggle-group-by-label">Group By</span>
                            <div class="toggle" role="group" id="toggle-group-by" aria-labelledby="toggle-group-by-label">
                                <button type="button" class="toggle-option" id="toggle-group-by-type" aria-pressed="${this.state.groupByMode === 'activity_type'}">Type</button>
                                <button type="button" class="toggle-option" id="toggle-group-by-name" aria-pressed="${this.state.groupByMode === 'log_name'}">Name</button>
                            </div>
                        </div>
                        <div class="dashboard-controls-field">
                            <span class="timeline-filter-label" id="toggle-metric-label">Measure</span>
                            <div class="toggle" role="group" id="toggle-metric" aria-labelledby="toggle-metric-label">
                                <button type="button" class="toggle-option" id="toggle-metric-time" aria-pressed="${this.state.metric === 'minutes'}">Time</button>
                                <button type="button" class="toggle-option" id="toggle-metric-characters" aria-pressed="${this.state.metric === 'characters'}">Chars</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.container.appendChild(card);
        this.cardElement = card;
        this.setupListeners();
        this.syncControlState();
        this.refreshCardsSummary();
    }

    public refreshCardsSummary(): void {
        this.cardsMenuField?.refresh();
    }

    public closeCardsPanel(): void {
        this.cardsMenuField?.close();
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
        const selectTimeRange = this.cardElement.querySelector<HTMLSelectElement>('#select-time-range');
        selectTimeRange?.addEventListener('change', () => {
            const days = Number.parseInt(selectTimeRange.value);
            this.onChartParamChange({ timeRangeDays: days, timeRangeOffset: 0 });
        });
        this.cardElement.querySelector('#toggle-group-by-type')?.addEventListener('click', () => {
            this.onChartParamChange({ groupByMode: 'activity_type' });
        });
        this.cardElement.querySelector('#toggle-group-by-name')?.addEventListener('click', () => {
            this.onChartParamChange({ groupByMode: 'log_name' });
        });
        this.cardElement.querySelector('#toggle-metric-time')?.addEventListener('click', () => {
            this.onChartParamChange({ metric: 'minutes' });
        });
        this.cardElement.querySelector('#toggle-metric-characters')?.addEventListener('click', () => {
            this.onChartParamChange({ metric: 'characters' });
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

    private syncToggle(groupSelector: string, isSecondActive: boolean): void {
        if (!this.cardElement) return;
        const group = this.cardElement.querySelector<HTMLElement>(groupSelector);
        if (!group) return;

        const options = group.querySelectorAll<HTMLButtonElement>('.toggle-option');
        const firstOption = options.item(0);
        const secondOption = options.item(1);
        firstOption?.classList.toggle('is-active', !isSecondActive);
        firstOption?.setAttribute('aria-pressed', String(!isSecondActive));
        secondOption?.classList.toggle('is-active', isSecondActive);
        secondOption?.setAttribute('aria-pressed', String(isSecondActive));
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

        this.syncToggle('#toggle-group-by', this.state.groupByMode === 'log_name');
        this.syncToggle('#toggle-metric', this.state.metric === 'characters');
        this.updateNavigationState();
    }
}

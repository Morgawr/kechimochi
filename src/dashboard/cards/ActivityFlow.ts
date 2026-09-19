import { html, rawHtml } from '../../html';
import { ActivitySummary, DashboardRangeResponse, Media } from '../../api';
import type { Chart as ChartInstance } from 'chart.js';
import { getActivityRange, getLocalISODate, resolveRangeLogs, type ActivityRange, type DatedActivityTotals } from '../activity_ranges';
import { logPerformance, measureSynchronous, performanceNow } from '../../performance';
import { loadChartConstructor, type ChartConstructor } from '../../chart_loader';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataMessage } from '../card_shell';
import { CHART_RESIZE_DEBOUNCE_MS, getActiveGroups, getChartColors, getGroupForLog, toDatasets, type BarChartDataset } from '../chart_runtime';
import { ChartCard, type ChartCardState } from '../chart_card';
import { formatStatsDuration } from '../../time';

export const ACTIVITY_FLOW_CARD = {
    id: 'activity_flow',
    label: 'Activity Flow',
    spans: { wide: 8, medium: 12 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

const DAILY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
});

interface ActivityFlowState extends ChartCardState {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: 'activity_type' | 'log_name';
    chartType: 'bar' | 'line';
    metric: 'minutes' | 'characters';
    weekStartDay?: number;
    snapshotRequestId?: number;
    hiddenCards?: ReadonlySet<string>;
}

export class ActivityFlow extends ChartCard<ActivityFlowState> {
    private barChartInstance: ChartInstance | null = null;
    private readonly onChartTypeChange: (chartType: 'bar' | 'line') => void;

    constructor(
        container: HTMLElement,
        initialState: ActivityFlowState,
        onCardsRendered: () => void = () => {},
        onChartTypeChange: (chartType: 'bar' | 'line') => void = () => {},
    ) {
        super(container, initialState, onCardsRendered);
        this.onChartTypeChange = onChartTypeChange;
    }

    protected get cardId(): string { return ACTIVITY_FLOW_CARD.id; }
    protected get canvasId(): string { return 'barChart'; }
    protected get chartName(): string { return 'activity flow'; }

    /**
     * Chart.js owns mutable state on its canvas element. Keep the mounted
     * card stable across data/control updates so browser references, focus,
     * and event listeners do not get replaced for every range response.
     */
    protected buildCard(): HTMLElement {
        return html`${rawHtml(renderDashboardCardShell({
            title: ACTIVITY_FLOW_CARD.label,
            headerExtras: `
                <div class="toggle" role="group" id="toggle-chart-type" aria-label="Chart type">
                    <button type="button" class="toggle-option" id="toggle-chart-type-bar" aria-pressed="false">Bar</button>
                    <button type="button" class="toggle-option" id="toggle-chart-type-line" aria-pressed="false">Line</button>
                </div>
            `,
            body: `
                <div class="chart-container-wrapper">
                    <canvas id="barChart"></canvas>
                    <div id="bar-chart-empty-message" class="chart-empty-message"></div>
                </div>
            `,
        }))}`;
    }

    protected override onCardMounted(card: HTMLElement): void {
        this.setupChartTypeToggle(card);
    }

    private setupChartTypeToggle(card: HTMLElement): void {
        const barOption = card.querySelector<HTMLButtonElement>('#toggle-chart-type-bar');
        const lineOption = card.querySelector<HTMLButtonElement>('#toggle-chart-type-line');
        barOption?.addEventListener('click', () => this.onChartTypeChange('bar'));
        lineOption?.addEventListener('click', () => this.onChartTypeChange('line'));
    }

    private syncChartTypeToggle(card: HTMLElement | null): void {
        const barOption = card?.querySelector<HTMLButtonElement>('#toggle-chart-type-bar');
        const lineOption = card?.querySelector<HTMLButtonElement>('#toggle-chart-type-line');
        const isLine = this.state.chartType === 'line';
        barOption?.classList.toggle('is-active', !isLine);
        barOption?.setAttribute('aria-pressed', String(!isLine));
        lineOption?.classList.toggle('is-active', isLine);
        lineOption?.setAttribute('aria-pressed', String(isLine));
    }

    /** Updates interaction state while a new backend range is in flight,
     * without constructing the chart from data belonging to the previous range. */
    public updatePendingParams(params: Partial<ActivityFlowState>): void {
        this.state = { ...this.state, ...params };
        // Prevent an older asynchronous Chart.js import/render from applying
        // data for the range that has just been superseded.
        this.renderGeneration++;
        const card = this.getMountedCard();
        delete this.container.dataset.dashboardRequestId;
        delete this.container.dataset.chartEmpty;
        card?.querySelectorAll<HTMLElement>('.chart-empty-message').forEach(message => {
            message.classList.remove('is-visible');
        });
        delete card?.querySelector<HTMLCanvasElement>('#barChart')?.dataset.chartEmpty;
    }

    protected async renderChart(card: HTMLElement): Promise<void> {
        this.syncChartTypeToggle(card);
        const generation = ++this.renderGeneration;
        const snapshotRequestId = this.state.snapshotRequestId;
        const barCanvas = card.querySelector<HTMLCanvasElement>('#barChart') ?? null;
        delete this.container.dataset.dashboardRequestId;

        const colors = getChartColors();
        const borderColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
        const rangeLogs = resolveRangeLogs(this.state.logs, this.state.rangeData);
        const timeRange = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay ?? 1);

        const barChartEmpty = this.isBarChartEmpty(rangeLogs, timeRange);
        if (barCanvas) barCanvas.dataset.chartEmpty = barChartEmpty ? 'true' : 'false';
        this.container.dataset.chartEmpty = barChartEmpty ? 'true' : 'false';
        this.syncEmptyStateMessage(card, barChartEmpty, timeRange);
        if (barChartEmpty) {
            this.barChartInstance?.destroy();
            this.barChartInstance = null;
        }

        const datasets: BarChartDataset[] = (!barCanvas || barChartEmpty) ? [] : measureSynchronous(
            'aggregation',
            'dashboard_bar_data',
            () => this.prepareBarChartDatasets(timeRange, colors, borderColor),
            { points: this.state.rangeData?.series.length ?? this.state.logs?.length ?? 0 },
        );
        if (barCanvas) {
            barCanvas.dataset.chartType = this.state.chartType;
            barCanvas.dataset.groupBy = this.state.groupByMode;
            barCanvas.dataset.metric = this.state.metric;
            barCanvas.dataset.seriesLabels = JSON.stringify(datasets.map(dataset => dataset.label));
            barCanvas.dataset.seriesTotals = JSON.stringify(
                datasets.map(dataset => dataset.data.reduce((sum, value) => sum + value, 0)),
            );
        }

        if (barChartEmpty) {
            if (snapshotRequestId !== undefined) this.publishRenderComplete(snapshotRequestId);
            this.onCardsRendered();
            return;
        }

        const importStarted = performanceNow();
        const Chart = await loadChartConstructor();
        logPerformance('chart_import', 'chart_js', performanceNow() - importStarted);
        if (generation !== this.renderGeneration) return;
        if (!card.isConnected) return;

        this.barChartInstance?.destroy();
        this.barChartInstance = null;
        if (barCanvas) this.createBarChart(Chart, barCanvas, timeRange, datasets);
        if (snapshotRequestId !== undefined) this.publishRenderComplete(snapshotRequestId);
        this.onCardsRendered();
    }

    private isBarChartEmpty(logs: DatedActivityTotals[], timeRange: ActivityRange): boolean {
        const { validStart, validEnd } = timeRange;
        return !logs.some(log => {
            if (log.date < validStart || log.date > validEnd) return false;
            const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
            return value > 0;
        });
    }

    private syncEmptyStateMessage(
        card: HTMLElement | null,
        barChartEmpty: boolean,
        timeRange: ActivityRange,
    ): void {
        const message = card?.querySelector<HTMLElement>('#bar-chart-empty-message');
        if (!message) return;
        if (barChartEmpty) {
            const today = getLocalISODate(new Date());
            message.innerHTML = renderNoPeriodDataMessage(today >= timeRange.validStart && today <= timeRange.validEnd);
        }
        message.classList.toggle('is-visible', barChartEmpty);
    }

    private prepareBarChartDatasets(timeRange: ActivityRange, colors: string[], borderColor: string) {
        const { groupByMode, chartType } = this.state;
        const logs = this.state.logs ?? [];
        const { labels, getBucketIndex } = timeRange;

        if (this.state.rangeData) {
            const bucketedSeries = this.state.rangeData.series
                .filter((point): point is typeof point & { bucket: string } => point.bucket !== null);
            const activeGroups = new Map<string, string>();
            for (const point of bucketedSeries) {
                activeGroups.set(point.group_key, point.group_label);
            }
            const datasetsMap = new Map<string, number[]>();
            for (const key of activeGroups.keys()) {
                datasetsMap.set(key, Array.from({ length: labels.length }, () => 0));
            }
            for (const point of bucketedSeries) {
                const index = getBucketIndex(point.bucket);
                if (index === -1) continue;
                const value = this.state.metric === 'minutes' ? point.total_minutes : point.total_characters;
                datasetsMap.get(point.group_key)![index] += value;
            }
            return toDatasets(datasetsMap, activeGroups, colors, chartType, borderColor);
        }

        const activeGroups = getActiveGroups(logs, log => getBucketIndex(log.date) !== -1, groupByMode, this.state.mediaList);
        const datasetsMap = this.aggregateDailyData(logs, activeGroups, getBucketIndex, labels.length, groupByMode);

        return toDatasets(datasetsMap, activeGroups, colors, chartType, borderColor);
    }

    private aggregateDailyData(logs: ActivitySummary[], activeGroups: Map<string, string>, getBucketIndex: (date: string) => number, length: number, mode: 'activity_type' | 'log_name') {
        const map = new Map<string, number[]>();
        for (const key of activeGroups.keys()) {
            map.set(key, Array.from({ length }, () => 0));
        }

        for (const log of logs) {
            const index = getBucketIndex(log.date);
            if (index !== -1) {
                const key = getGroupForLog(log, mode).key;
                if (map.has(key)) {
                    const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
                    map.get(key)![index] += value;
                }
            }
        }
        return map;
    }

    private createBarChart(Chart: ChartConstructor, canvas: HTMLCanvasElement, timeRange: ActivityRange, datasets: BarChartDataset[]) {
        const { chartType } = this.state;
        const { labels } = timeRange;
        const style = getComputedStyle(document.body);
        const secondaryColor = style.getPropertyValue('--text-secondary').trim()
        const gridColor = `color-mix(in srgb, ${secondaryColor} 30%, transparent)`;

        this.barChartInstance = measureSynchronous('chart_construction', 'dashboard_activity_chart', () => new Chart(canvas, {
            type: chartType,
            data: {
                labels: timeRange.unit === 'day' ? labels.map(label => this.formatDailyDateLabel(label)) : labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                resizeDelay: CHART_RESIZE_DEBOUNCE_MS,
                scales: {
                    x: { stacked: chartType === 'bar', grid: { color: gridColor }, ticks: { color: secondaryColor } },
                    y: {
                        stacked: chartType === 'bar',
                        grid: { color: gridColor },
                        ticks: {
                            color: secondaryColor,
                            callback: (value) => {
                                if (this.state.metric === 'minutes') {
                                    return formatStatsDuration(value as number);
                                }
                                return value.toLocaleString();
                            }
                        }
                    }
                },
                plugins: {
                    legend: { display: datasets.length <= 6, position: 'top', labels: { color: secondaryColor } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed.y ?? 0;
                                if (this.state.metric === 'minutes') {
                                    return `${context.dataset.label}: ${formatStatsDuration(val)}`;
                                }
                                return `${context.dataset.label}: ${val.toLocaleString()} chars`;
                            }
                        }
                    }
                }
            }
        }));
    }

    private formatDailyDateLabel(label: string): string {
        const [year, month, day] = label.split('-').map(Number);
        return DAILY_LABEL_FORMATTER.format(new Date(year, month - 1, day));
    }

    public destroy() {
        this.renderGeneration++;
        this.barChartInstance?.destroy();
        this.barChartInstance = null;
    }
}

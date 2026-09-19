import { Component } from '../../component';
import { html, rawHtml } from '../../html';
import { ActivitySummary, DashboardRangeResponse, Media } from '../../api';
import type { Chart as ChartInstance } from 'chart.js';
import { formatStatsDuration } from '../../time';
import { getActivityRange, getLocalISODate, resolveRangeLogs, type ActivityRange } from '../activity_ranges';
import { Logger } from '../../logger';
import { logPerformance, measureSynchronous, performanceNow } from '../../performance';
import { loadChartConstructor, type ChartConstructor } from '../../chart_loader';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataMessage } from '../card_shell';
import { CHART_RESIZE_DEBOUNCE_MS, getActiveGroups, getChartColors, getGroupForLog } from '../chart_runtime';

export const ACTIVITY_MIX_CARD = {
    id: 'activity_mix',
    label: 'Activity Mix',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

interface ActivityMixState {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: 'activity_type' | 'log_name';
    metric: 'minutes' | 'characters';
    weekStartDay?: number;
    snapshotRequestId?: number;
    hiddenCards?: ReadonlySet<string>;
}

interface PieChartData {
    labels: string[];
    values: number[];
}

export class ActivityMix extends Component<ActivityMixState> {
    private pieChartInstance: ChartInstance | null = null;
    private renderGeneration = 0;
    private readonly onCardsRendered: () => void;

    constructor(
        container: HTMLElement,
        initialState: ActivityMixState,
        onCardsRendered: () => void = () => {},
    ) {
        super(container, initialState);
        this.onCardsRendered = onCardsRendered;
    }

    private getMountedCard(): HTMLElement | null {
        return this.container.querySelector<HTMLElement>('#pieChart')?.closest<HTMLElement>('.card') ?? null;
    }

    private shouldMount(): boolean {
        return !this.state.hiddenCards?.has(ACTIVITY_MIX_CARD.id);
    }

    public updateHiddenCards(hiddenCards: ReadonlySet<string>): void {
        const previousIntent = this.shouldMount();
        this.state = { ...this.state, hiddenCards };
        if (this.shouldMount() === previousIntent) return;
        this.setState({});
    }

    /**
     * Chart.js owns mutable state on its canvas element. Keep the mounted
     * card stable across data/control updates so browser references, focus,
     * and event listeners do not get replaced for every range response.
     */
    public setState(newState: Partial<ActivityMixState>): void {
        this.state = { ...this.state, ...newState };
        const mountedCard = this.getMountedCard();
        if (this.shouldMount() !== Boolean(mountedCard)) {
            this.destroy();
            this.clear();
            this.render();
            return;
        }
        if (!mountedCard) {
            this.render();
            return;
        }

        this.renderChart(mountedCard).catch(error => {
            Logger.error('Failed to render dashboard activity mix chart', error);
        });
    }

    render() {
        const mountedCard = this.getMountedCard();
        if (mountedCard) {
            this.renderChart(mountedCard).catch(error => {
                Logger.error('Failed to render dashboard activity mix chart', error);
            });
            return;
        }

        this.clear();
        if (!this.shouldMount()) return;

        const card = html`${rawHtml(renderDashboardCardShell({
            title: ACTIVITY_MIX_CARD.label,
            body: `
                <div class="chart-container-wrapper">
                    <canvas id="pieChart"></canvas>
                    <div id="pie-chart-empty-message" class="chart-empty-message"></div>
                </div>
            `,
        }))}`;
        this.container.appendChild(card);

        this.renderChart(card).catch(error => {
            Logger.error('Failed to render dashboard activity mix chart', error);
        });
    }

    /** Updates interaction state while a new backend range is in flight,
     * without constructing the chart from data belonging to the previous range. */
    public updatePendingParams(params: Partial<ActivityMixState>): void {
        this.state = { ...this.state, ...params };
        // Prevent an older asynchronous Chart.js import/render from applying
        // data for the range that has just been superseded.
        this.renderGeneration++;
        const card = this.getMountedCard();
        delete this.container.dataset.dashboardRequestId;
        card?.querySelectorAll<HTMLElement>('.chart-empty-message').forEach(message => {
            message.classList.remove('is-visible');
        });
        const pieCanvas = card?.querySelector<HTMLCanvasElement>('#pieChart');
        delete pieCanvas?.dataset.dashboardRequestId;
        delete pieCanvas?.dataset.chartEmpty;
    }

    private async renderChart(card: HTMLElement): Promise<void> {
        const generation = ++this.renderGeneration;
        const snapshotRequestId = this.state.snapshotRequestId;
        const pieCanvas = card.querySelector<HTMLCanvasElement>('#pieChart') ?? null;
        // The mounted canvas can still contain data from an earlier snapshot
        // while Chart.js is being imported. Clear the completion marker until
        // the chart has been constructed for this render generation.
        delete pieCanvas?.dataset.dashboardRequestId;
        delete this.container.dataset.dashboardRequestId;

        const colors = getChartColors();
        const rangeLogs = resolveRangeLogs(this.state.logs, this.state.rangeData);
        const timeRange = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay ?? 1);

        // Publish the current aggregate data independently of Chart.js. Tests
        // and other DOM consumers that inspect the data should not have to wait
        // for the lazy chart module.
        const pieData = this.preparePieChartData(timeRange);
        if (pieCanvas) {
            pieCanvas.dataset.groupBy = this.state.groupByMode;
            pieCanvas.dataset.metric = this.state.metric;
            pieCanvas.dataset.labels = JSON.stringify(pieData.labels);
            pieCanvas.dataset.values = JSON.stringify(pieData.values);
            if (snapshotRequestId !== undefined) {
                pieCanvas.dataset.dashboardRequestId = snapshotRequestId.toString();
            }
        }

        const pieChartEmpty = this.isPieChartEmpty(pieData);
        if (pieCanvas) pieCanvas.dataset.chartEmpty = pieChartEmpty ? 'true' : 'false';
        this.syncEmptyStateMessage(card, pieChartEmpty, timeRange);
        if (pieChartEmpty) {
            this.pieChartInstance?.destroy();
            this.pieChartInstance = null;
        }

        if (pieChartEmpty) {
            if (snapshotRequestId !== undefined) this.publishRenderComplete(snapshotRequestId);
            this.onCardsRendered();
            return;
        }

        const importStarted = performanceNow();
        const Chart = await loadChartConstructor();
        logPerformance('chart_import', 'chart_js', performanceNow() - importStarted);
        if (generation !== this.renderGeneration) return;
        if (!card.isConnected) return;

        this.pieChartInstance?.destroy();
        this.pieChartInstance = null;
        if (pieCanvas) this.createPieChart(Chart, pieCanvas, colors, pieData);
        if (snapshotRequestId !== undefined) this.publishRenderComplete(snapshotRequestId);
        this.onCardsRendered();
    }

    private publishRenderComplete(snapshotRequestId: number): void {
        this.container.dataset.dashboardRequestId = snapshotRequestId.toString();
    }

    private isPieChartEmpty(pieData: PieChartData): boolean {
        return pieData.values.every(value => value === 0);
    }

    private syncEmptyStateMessage(
        card: HTMLElement | null,
        pieChartEmpty: boolean,
        timeRange: ActivityRange,
    ): void {
        const message = card?.querySelector<HTMLElement>('#pie-chart-empty-message');
        if (!message) return;
        if (pieChartEmpty) {
            const today = getLocalISODate(new Date());
            message.innerHTML = renderNoPeriodDataMessage(today >= timeRange.validStart && today <= timeRange.validEnd);
        }
        message.classList.toggle('is-visible', pieChartEmpty);
    }

    private preparePieChartData(timeRange: ActivityRange): PieChartData {
        const { groupByMode } = this.state;
        const logs = this.state.logs ?? [];
        const { validStart, validEnd } = timeRange;
        const isInRange = (log: ActivitySummary) => log.date >= validStart && log.date <= validEnd;
        const activeGroups = getActiveGroups(logs, isInRange, groupByMode, this.state.mediaList);
        const pieTypeMap = new Map<string, number>();

        measureSynchronous('aggregation', 'dashboard_pie_data', () => {
            if (this.state.rangeData) {
                for (const point of this.state.rangeData.series) {
                    const value = this.state.metric === 'minutes' ? point.total_minutes : point.total_characters;
                    activeGroups.set(point.group_key, point.group_label);
                    pieTypeMap.set(point.group_key, (pieTypeMap.get(point.group_key) || 0) + value);
                }
                return;
            }
            for (const log of logs) {
                if (isInRange(log)) {
                    const key = getGroupForLog(log, groupByMode).key;
                    const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
                    pieTypeMap.set(key, (pieTypeMap.get(key) || 0) + value);
                }
            }
        }, { points: this.state.rangeData?.series.length ?? logs.length });

        const sortedEntries = Array.from(pieTypeMap.entries()).sort((a, b) => b[1] - a[1]);
        return {
            labels: sortedEntries.map(([key]) => activeGroups.get(key) ?? key),
            values: sortedEntries.map(([, value]) => value),
        };
    }

    private createPieChart(Chart: ChartConstructor, canvas: HTMLCanvasElement, colors: string[], data: PieChartData) {
        const style = getComputedStyle(document.body);
        const borderColor = style.getPropertyValue('--border-color').trim();

        this.pieChartInstance = measureSynchronous('chart_construction', 'dashboard_pie_chart', () => new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: data.labels,
                datasets: [{
                    data: data.values,
                    backgroundColor: colors,
                    borderColor,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                resizeDelay: CHART_RESIZE_DEBOUNCE_MS,
                plugins: {
                    legend: { display: data.labels.length <= 6, position: 'bottom', labels: { color: style.getPropertyValue('--text-secondary').trim() } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed;
                                if (this.state.metric === 'minutes') {
                                    return formatStatsDuration(val);
                                }
                                return `${val.toLocaleString()} chars`;
                            }
                        }
                    }
                }
            }
        }));
    }

    public destroy() {
        this.renderGeneration++;
        this.pieChartInstance?.destroy();
        this.pieChartInstance = null;
    }
}

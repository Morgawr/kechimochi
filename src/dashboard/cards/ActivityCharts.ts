import { Component } from '../../component';
import { html, rawHtml } from '../../html';
import { ActivitySummary, DashboardRangeResponse, Media } from '../../api';
import type { Chart as ChartInstance } from 'chart.js';
import { formatStatsDuration } from '../../time';
import { getActivityRange, getLocalISODate, resolveRangeLogs, type ActivityRange, type DatedActivityTotals } from '../activity_ranges';
import { Logger } from '../../logger';
import { logPerformance, measureSynchronous, performanceNow } from '../../performance';
import { loadChartConstructor, type ChartConstructor } from '../../chart_loader';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataMessage } from '../card_shell';

export const ACTIVITY_BREAKDOWN_CARD = {
    id: 'activity_breakdown',
    label: 'Activity Breakdown',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

export const ACTIVITY_VISUALIZATION_CARD = {
    id: 'activity_visualization',
    label: 'Activity Visualization',
    spans: { wide: 8, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

export type ActivityChartsHostId = 'activity_breakdown' | 'activity_visualization';

const DISPLAY_FRAME_MS = 1000 / 60;
const FRAMES_PER_CHART_RESIZE = 2;
const CHART_RESIZE_DEBOUNCE_MS = Math.round(DISPLAY_FRAME_MS * FRAMES_PER_CHART_RESIZE);

const DAILY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
});

interface ActivityChartsState {
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

interface ChartGroup {
    key: string;
    label: string;
}

interface PieChartData {
    labels: string[];
    values: number[];
}

interface BarChartDataset {
    label: string;
    data: number[];
    backgroundColor: string;
    borderColor: string;
    fill: boolean | undefined;
    tension: number;
}

interface MountedActivityChartsCards {
    breakdownCard: HTMLElement | null;
    visualizationCard: HTMLElement | null;
}

export class ActivityCharts extends Component<ActivityChartsState> {
    private pieChartInstance: ChartInstance | null = null;
    private barChartInstance: ChartInstance | null = null;
    private renderGeneration = 0;
    private readonly hosts: ReadonlyMap<ActivityChartsHostId, HTMLElement>;
    private readonly onCardsRendered: () => void;
    private readonly onRenderComplete: (requestId: number) => void;

    constructor(
        container: HTMLElement,
        hosts: ReadonlyMap<ActivityChartsHostId, HTMLElement>,
        initialState: ActivityChartsState,
        onCardsRendered: () => void = () => {},
        onRenderComplete: (requestId: number) => void = () => {},
    ) {
        super(container, initialState);
        this.hosts = hosts;
        this.onCardsRendered = onCardsRendered;
        this.onRenderComplete = onRenderComplete;
    }

    protected override clear(): void {
        this.hosts.get('activity_breakdown')?.replaceChildren();
        this.hosts.get('activity_visualization')?.replaceChildren();
    }

    private getMountedCards(): MountedActivityChartsCards {
        const breakdownHost = this.hosts.get('activity_breakdown');
        const visualizationHost = this.hosts.get('activity_visualization');
        const breakdownCard = breakdownHost?.querySelector<HTMLElement>('#pieChart')?.closest<HTMLElement>('.card') ?? null;
        const visualizationCard = visualizationHost?.querySelector<HTMLElement>('#barChart')?.closest<HTMLElement>('.card') ?? null;
        return { breakdownCard, visualizationCard };
    }

    private shouldMount(hostId: ActivityChartsHostId): boolean {
        return this.hosts.has(hostId) && !this.state.hiddenCards?.has(hostId);
    }

    private getMountIntent(): string {
        return `${this.shouldMount('activity_breakdown')}|${this.shouldMount('activity_visualization')}`;
    }

    public updateHiddenCards(hiddenCards: ReadonlySet<string>): void {
        const previousIntent = this.getMountIntent();
        this.state = { ...this.state, hiddenCards };
        if (this.getMountIntent() === previousIntent) return;
        this.setState({});
    }

    private hasMountMismatch(mounted: MountedActivityChartsCards): boolean {
        return this.shouldMount('activity_breakdown') !== Boolean(mounted.breakdownCard)
            || this.shouldMount('activity_visualization') !== Boolean(mounted.visualizationCard);
    }

    /**
     * Chart.js owns mutable state on its canvas elements. Keep the mounted
     * cards stable across data/control updates so browser references, focus,
     * and event listeners do not get replaced for every range response.
     */
    public setState(newState: Partial<ActivityChartsState>): void {
        this.state = { ...this.state, ...newState };
        const mounted = this.getMountedCards();
        if (this.hasMountMismatch(mounted)) {
            this.destroy();
            this.clear();
            this.render();
            return;
        }
        if (!mounted.breakdownCard && !mounted.visualizationCard) {
            this.render();
            return;
        }

        this.renderCharts(mounted).catch(error => {
            Logger.error('Failed to render dashboard charts', error);
        });
    }

    render() {
        const mounted = this.getMountedCards();
        if (mounted.breakdownCard || mounted.visualizationCard) {
            this.renderCharts(mounted).catch(error => {
                Logger.error('Failed to render dashboard charts', error);
            });
            return;
        }

        const breakdownHost = this.hosts.get('activity_breakdown');
        const visualizationHost = this.hosts.get('activity_visualization');
        if (!breakdownHost || !visualizationHost) return;

        this.clear();

        const breakdownCard = this.shouldMount('activity_breakdown') ? html`${rawHtml(renderDashboardCardShell({
            title: 'Activity Breakdown',
            body: `
                <div class="chart-container-wrapper">
                    <canvas id="pieChart"></canvas>
                    <div id="pie-chart-empty-message" class="chart-empty-message"></div>
                </div>
            `,
        }))}` : null;
        const visualizationCard = this.shouldMount('activity_visualization') ? html`${rawHtml(renderDashboardCardShell({
            title: 'Activity Visualization',
            body: `
                <div class="chart-container-wrapper">
                    <canvas id="barChart"></canvas>
                    <div id="bar-chart-empty-message" class="chart-empty-message"></div>
                </div>
            `,
        }))}` : null;

        if (breakdownCard) breakdownHost.appendChild(breakdownCard);
        if (visualizationCard) visualizationHost.appendChild(visualizationCard);
        if (!breakdownCard && !visualizationCard) return;

        this.renderCharts({ breakdownCard, visualizationCard }).catch(error => {
            Logger.error('Failed to render dashboard charts', error);
        });
    }

    /** Updates interaction state while a new backend range is in flight,
     * without constructing charts from data belonging to the previous range. */
    public updatePendingParams(params: Partial<ActivityChartsState>): void {
        this.state = { ...this.state, ...params };
        // Prevent an older asynchronous Chart.js import/render from applying
        // data for the range that has just been superseded.
        this.renderGeneration++;
        const { breakdownCard, visualizationCard } = this.getMountedCards();
        const visualizationHost = this.hosts.get('activity_visualization');
        delete visualizationHost?.dataset.chartEmpty;
        for (const card of [breakdownCard, visualizationCard]) {
            card?.querySelectorAll<HTMLElement>('.chart-empty-message').forEach(message => {
                message.classList.remove('is-visible');
            });
        }
        const pieCanvas = breakdownCard?.querySelector<HTMLCanvasElement>('#pieChart');
        delete pieCanvas?.dataset.dashboardRequestId;
        delete pieCanvas?.dataset.chartEmpty;
        delete visualizationCard?.querySelector<HTMLCanvasElement>('#barChart')?.dataset.chartEmpty;
    }

    private async renderCharts(mounted: MountedActivityChartsCards): Promise<void> {
        const { breakdownCard, visualizationCard } = mounted;
        const generation = ++this.renderGeneration;
        const snapshotRequestId = this.state.snapshotRequestId;
        const visualizationHost = this.hosts.get('activity_visualization');
        const pieCanvas = breakdownCard?.querySelector<HTMLCanvasElement>('#pieChart') ?? null;
        const barCanvas = visualizationCard?.querySelector<HTMLCanvasElement>('#barChart') ?? null;
        // The mounted canvas can still contain data from an earlier snapshot
        // while Chart.js is being imported. Clear the completion marker until
        // the chart has been constructed for this render generation.
        delete pieCanvas?.dataset.dashboardRequestId;

        const colors = this.getChartColors();
        const borderColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
        const rangeLogs = resolveRangeLogs(this.state.logs, this.state.rangeData);
        const timeRange = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay ?? 1);

        // Publish the current aggregate data independently of Chart.js. Tests
        // and other DOM consumers that inspect the data should not have to wait
        // for the lazy chart module or the sibling activity chart to finish
        // constructing.
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

        // The pie sums every point in the range while the bar can only draw the
        // ones that fall in a bucket, so the two can disagree.
        const pieChartEmpty = this.isPieChartEmpty(pieData);
        const barChartEmpty = this.isBarChartEmpty(rangeLogs, timeRange);
        if (pieCanvas) pieCanvas.dataset.chartEmpty = pieChartEmpty ? 'true' : 'false';
        if (barCanvas) barCanvas.dataset.chartEmpty = barChartEmpty ? 'true' : 'false';
        if (visualizationHost) visualizationHost.dataset.chartEmpty = pieChartEmpty && barChartEmpty ? 'true' : 'false';
        this.syncEmptyStateMessages(breakdownCard, visualizationCard, pieChartEmpty, barChartEmpty, timeRange);
        this.destroyEmptyChartInstances(pieChartEmpty, barChartEmpty);

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

        if (pieChartEmpty && barChartEmpty) {
            this.destroyChartInstances();
            if (snapshotRequestId !== undefined) this.onRenderComplete(snapshotRequestId);
            this.onCardsRendered();
            return;
        }

        const importStarted = performanceNow();
        const Chart = await loadChartConstructor();
        logPerformance('chart_import', 'chart_js', performanceNow() - importStarted);
        if (generation !== this.renderGeneration) return;
        if (breakdownCard && !breakdownCard.isConnected) return;
        if (visualizationCard && !visualizationCard.isConnected) return;

        this.destroyChartInstances();
        if (pieCanvas && !pieChartEmpty) this.createPieChart(Chart, pieCanvas, colors, pieData);
        if (barCanvas && !barChartEmpty) this.createBarChart(Chart, barCanvas, timeRange, datasets);
        if (snapshotRequestId !== undefined) this.onRenderComplete(snapshotRequestId);
        this.onCardsRendered();
    }

    private isPieChartEmpty(pieData: PieChartData): boolean {
        return pieData.values.every(value => value === 0);
    }

    private isBarChartEmpty(logs: DatedActivityTotals[], timeRange: ActivityRange): boolean {
        const { validStart, validEnd } = timeRange;
        return !logs.some(log => {
            if (log.date < validStart || log.date > validEnd) return false;
            const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
            return value > 0;
        });
    }

    private syncEmptyStateMessages(
        breakdownCard: HTMLElement | null,
        visualizationCard: HTMLElement | null,
        pieChartEmpty: boolean,
        barChartEmpty: boolean,
        timeRange: ActivityRange,
    ): void {
        const today = getLocalISODate(new Date());
        const markup = renderNoPeriodDataMessage(today >= timeRange.validStart && today <= timeRange.validEnd);
        const targets: ReadonlyArray<{ root: HTMLElement; id: string; isEmpty: boolean }> = [
            breakdownCard ? { root: breakdownCard, id: 'pie-chart-empty-message', isEmpty: pieChartEmpty } : null,
            visualizationCard ? { root: visualizationCard, id: 'bar-chart-empty-message', isEmpty: barChartEmpty } : null,
        ].filter((target): target is { root: HTMLElement; id: string; isEmpty: boolean } => target !== null);
        for (const { root, id, isEmpty } of targets) {
            const message = root.querySelector<HTMLElement>(`#${id}`);
            if (!message) continue;
            if (isEmpty) message.innerHTML = markup;
            message.classList.toggle('is-visible', isEmpty);
        }
    }

    private getChartColors(): string[] {
        const style = getComputedStyle(document.body);
        return [
            style.getPropertyValue('--chart-1').trim(),
            style.getPropertyValue('--chart-2').trim(),
            style.getPropertyValue('--chart-3').trim(),
            style.getPropertyValue('--chart-4').trim(),
            style.getPropertyValue('--chart-5').trim()
        ];
    }

    private preparePieChartData(timeRange: ActivityRange): PieChartData {
        const { groupByMode } = this.state;
        const logs = this.state.logs ?? [];
        const { validStart, validEnd } = timeRange;
        const isInRange = (log: ActivitySummary) => log.date >= validStart && log.date <= validEnd;
        const activeGroups = this.getActiveGroups(logs, isInRange, groupByMode);
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
                    const key = this.getGroupForLog(log, groupByMode).key;
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
            return this.toDatasets(datasetsMap, activeGroups, colors, chartType, borderColor);
        }

        const activeGroups = this.getActiveGroups(logs, log => getBucketIndex(log.date) !== -1, groupByMode);
        const datasetsMap = this.aggregateDailyData(logs, activeGroups, getBucketIndex, labels.length, groupByMode);

        return this.toDatasets(datasetsMap, activeGroups, colors, chartType, borderColor);
    }

    private toDatasets(
        datasetsMap: Map<string, number[]>,
        activeGroups: Map<string, string>,
        colors: string[],
        chartType: 'bar' | 'line',
        borderColor: string,
    ) {
        return Array.from(datasetsMap.entries())
            .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
            .map(([key, data], i) => ({
                label: activeGroups.get(key) ?? key,
                data: data,
                backgroundColor: colors[i % colors.length],
                borderColor: chartType === 'bar' ? borderColor : colors[i % colors.length],
                borderWidth: chartType === 'bar'
                    ? { top: 0, right: 0, bottom: i === 0 ? 0 : 2, left: 0 }
                    : undefined,
                borderSkipped: chartType === 'bar' ? false : undefined,
                fill: chartType === 'line' ? false : undefined,
                tension: 0.3
            }));
    }

    private getActiveGroups(
        logs: ActivitySummary[],
        isActive: (log: ActivitySummary) => boolean,
        mode: 'activity_type' | 'log_name',
    ): Map<string, string> {
        const groups = new Map<string, string>();
        const nameGroups = mode === 'log_name' ? this.buildLogNameGroups(logs, isActive) : undefined;
        for (const log of logs) {
            if (isActive(log)) {
                const group = this.getGroupForLog(log, mode, nameGroups);
                groups.set(group.key, group.label);
            }
        }
        return groups;
    }

    private buildLogNameGroups(
        logs: ActivitySummary[],
        isActive: (log: ActivitySummary) => boolean,
    ): Map<number, ChartGroup> {
        const mediaById = new Map(
            (this.state.mediaList ?? [])
                .filter((media): media is Media & { id: number } => media.id !== undefined)
                .map(media => [media.id, media]),
        );
        const activeMedia = new Map<number, { title: string; variant: string }>();

        for (const log of logs) {
            if (!isActive(log) || activeMedia.has(log.media_id)) continue;
            const media = mediaById.get(log.media_id);
            activeMedia.set(log.media_id, {
                title: media?.title ?? log.title,
                variant: media?.variant?.trim() ?? '',
            });
        }

        const titleCounts = new Map<string, number>();
        for (const { title } of activeMedia.values()) {
            titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
        }

        const groups = new Map<number, ChartGroup>();
        for (const [mediaId, media] of activeMedia) {
            const needsVariant = (titleCounts.get(media.title) ?? 0) > 1;
            groups.set(mediaId, {
                key: `media:${mediaId}`,
                label: needsVariant
                    ? `${media.title} — ${media.variant || '(no variant)'}`
                    : media.title,
            });
        }
        return groups;
    }

    private getGroupForLog(
        log: ActivitySummary,
        mode: 'activity_type' | 'log_name',
        nameGroups?: Map<number, ChartGroup>,
    ): ChartGroup {
        if (mode === 'activity_type') {
            return { key: `activity:${log.activity_type}`, label: log.activity_type };
        }
        return nameGroups?.get(log.media_id) ?? {
            key: `media:${log.media_id}`,
            label: log.title,
        };
    }

    private aggregateDailyData(logs: ActivitySummary[], activeGroups: Map<string, string>, getBucketIndex: (date: string) => number, length: number, mode: 'activity_type' | 'log_name') {
        const map = new Map<string, number[]>();
        for (const key of activeGroups.keys()) {
            map.set(key, Array.from({ length }, () => 0));
        }

        for (const log of logs) {
            const index = getBucketIndex(log.date);
            if (index !== -1) {
                const key = this.getGroupForLog(log, mode).key;
                if (map.has(key)) {
                    const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
                    map.get(key)![index] += value;
                }
            }
        }
        return map;
    }
    public destroy() {
        this.renderGeneration++;
        this.destroyChartInstances();
    }

    private destroyChartInstances(): void {
        this.destroyEmptyChartInstances(true, true);
    }

    private destroyEmptyChartInstances(pieChartEmpty: boolean, barChartEmpty: boolean): void {
        if (pieChartEmpty) {
            this.pieChartInstance?.destroy();
            this.pieChartInstance = null;
        }
        if (barChartEmpty) {
            this.barChartInstance?.destroy();
            this.barChartInstance = null;
        }
    }
}

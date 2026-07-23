import { Component } from '../component';
import { html } from '../html';
import { ActivitySummary, DashboardRangeResponse, Media } from '../api';
import type { Chart as ChartInstance } from 'chart.js';
import { formatStatsDuration } from '../time';
import { ACTIVITY_TIME_RANGES, getActivityRange, type ActivityRange } from './activity_ranges';
import { Logger } from '../logger';
import { logPerformance, measureSynchronous, performanceNow } from '../performance';
import { loadChartConstructor, type ChartConstructor } from '../chart_loader';

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
}

interface ChartGroup {
    key: string;
    label: string;
}

interface PieChartData {
    labels: string[];
    values: number[];
}

export class ActivityCharts extends Component<ActivityChartsState> {
    private pieChartInstance: ChartInstance | null = null;
    private barChartInstance: ChartInstance | null = null;
    private renderGeneration = 0;
    private readonly onChartParamChange: (params: Partial<ActivityChartsState>) => void;

    constructor(container: HTMLElement, initialState: ActivityChartsState, onChartParamChange: (params: Partial<ActivityChartsState>) => void) {
        super(container, initialState);
        this.onChartParamChange = onChartParamChange;
    }

    /**
     * Chart.js owns mutable state on its canvas elements. Keep the mounted
     * layout stable across data/control updates so browser references, focus,
     * and event listeners do not get replaced for every range response.
     */
    public setState(newState: Partial<ActivityChartsState>): void {
        this.state = { ...this.state, ...newState };
        const chartsLayout = this.container.querySelector<HTMLElement>('#activity-charts-grid');
        if (!chartsLayout) {
            this.render();
            return;
        }

        this.syncControlState(chartsLayout);
        this.renderCharts(chartsLayout).catch(error => {
            Logger.error('Failed to render dashboard charts', error);
        });
    }

    render() {
        const existingLayout = this.container.querySelector<HTMLElement>('#activity-charts-grid');
        if (existingLayout) {
            this.syncControlState(existingLayout);
            this.renderCharts(existingLayout).catch(error => {
                Logger.error('Failed to render dashboard charts', error);
            });
            return;
        }

        this.clear();

        const chartsLayout = html`
            <div id="activity-charts-grid" style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 2rem;">
                <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
                    <h3 class="dashboard-module-title" style="text-align: center; margin-bottom: 1rem;">Activity Breakdown</h3>
                    <div class="chart-container-wrapper" style="flex: 1; min-height: 0;">
                        <canvas id="pieChart"></canvas>
                    </div>
                </div>
                <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
                    <div class="activity-charts-header">
                        <div class="activity-charts-title-controls">
                            <button class="btn btn-ghost chart-nav-button" id="btn-chart-prev">
                                <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <h3 class="activity-charts-title dashboard-module-title">Activity Visualization</h3>
                            <button class="btn btn-ghost chart-nav-button" id="btn-chart-next">
                                <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                        <div class="chart-toolbar">
                            <!-- Chart Type Toggle -->
                            <div class="chart-toolbar-group">
                                <span class="toggle-label ${this.state.chartType === 'bar' ? 'active' : ''}">Bar</span>
                                <label class="switch">
                                    <input type="checkbox" id="toggle-chart-type" ${this.state.chartType === 'line' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span class="toggle-label ${this.state.chartType === 'line' ? 'active' : ''}">Line</span>
                            </div>

                            <div class="chart-toolbar-divider" aria-hidden="true"></div>

                            <!-- Time Range Select -->
                            <div class="chart-toolbar-select-shell">
                                <select id="select-time-range" class="chart-toolbar-select">
                                    <option value="7" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.WEEKLY ? 'selected' : ''}>Week</option>
                                    <option value="30" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.MONTHLY ? 'selected' : ''}>Month</option>
                                    <option value="365" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.YEARLY ? 'selected' : ''}>Year</option>
                                    <option value="0" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME ? 'selected' : ''}>All Time</option>
                                </select>
                            </div>

                            <div class="chart-toolbar-divider" aria-hidden="true"></div>

                            <!-- Group By Toggle -->
                            <div class="chart-toolbar-group">
                                <span class="toggle-label ${this.state.groupByMode === 'activity_type' ? 'active' : ''}">Type</span>
                                <label class="switch">
                                    <input type="checkbox" id="toggle-group-by" ${this.state.groupByMode === 'log_name' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span class="toggle-label ${this.state.groupByMode === 'log_name' ? 'active' : ''}">Name</span>
                            </div>

                            <div class="chart-toolbar-divider" aria-hidden="true"></div>

                            <!-- Metric Toggle -->
                            <div class="chart-toolbar-group">
                                <span class="toggle-label ${this.state.metric === 'minutes' ? 'active' : ''}">Time</span>
                                <label class="switch">
                                    <input type="checkbox" id="toggle-metric" ${this.state.metric === 'characters' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span class="toggle-label ${this.state.metric === 'characters' ? 'active' : ''}">Chars</span>
                            </div>
                        </div>
                    </div>
                    <div class="chart-container-wrapper" style="flex: 1; min-height: 0;">
                        <canvas id="barChart"></canvas>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(chartsLayout);
        this.setupListeners(chartsLayout);
        this.syncControlState(chartsLayout);
        this.renderCharts(chartsLayout).catch(error => {
            Logger.error('Failed to render dashboard charts', error);
        });
    }

    private setupListeners(layout: HTMLElement) {
        layout.querySelector('#btn-chart-prev')?.addEventListener('click', () => {
            if (this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME) return;
            this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset + 1 });
        });
        layout.querySelector('#btn-chart-next')?.addEventListener('click', () => {
            if (this.state.timeRangeDays !== ACTIVITY_TIME_RANGES.ALL_TIME && this.state.timeRangeOffset > 0) {
                this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset - 1 });
            }
        });
        const toggleChartType = layout.querySelector<HTMLInputElement>('#toggle-chart-type');
        toggleChartType?.addEventListener('change', () => {
            this.onChartParamChange({ chartType: toggleChartType.checked ? 'line' : 'bar' });
        });
        const selectTimeRange = layout.querySelector<HTMLSelectElement>('#select-time-range');
        selectTimeRange?.addEventListener('change', () => {
            const days = Number.parseInt(selectTimeRange.value);
            this.onChartParamChange({ timeRangeDays: days, timeRangeOffset: 0 });
        });
        const toggleGroupBy = layout.querySelector<HTMLInputElement>('#toggle-group-by');
        toggleGroupBy?.addEventListener('change', () => {
            this.onChartParamChange({ groupByMode: toggleGroupBy.checked ? 'log_name' : 'activity_type' });
        });
        const toggleMetric = layout.querySelector<HTMLInputElement>('#toggle-metric');
        toggleMetric?.addEventListener('change', () => {
            this.onChartParamChange({ metric: toggleMetric.checked ? 'characters' : 'minutes' });
        });
    }

    private updateNavigationState(layout: HTMLElement) {
        const isAllTime = this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME;
        const prevButton = layout.querySelector<HTMLButtonElement>('#btn-chart-prev');
        const nextButton = layout.querySelector<HTMLButtonElement>('#btn-chart-next');

        if (prevButton) prevButton.disabled = isAllTime;
        if (nextButton) nextButton.disabled = isAllTime || this.state.timeRangeOffset === 0;
    }

    private syncControlState(layout: HTMLElement): void {
        layout.dataset.timeRangeDays = String(this.state.timeRangeDays);
        layout.dataset.timeRangeOffset = String(this.state.timeRangeOffset);

        const rangeSelect = layout.querySelector<HTMLSelectElement>('#select-time-range');
        if (rangeSelect) rangeSelect.value = String(this.state.timeRangeDays);

        this.syncToggle(layout, '#toggle-chart-type', this.state.chartType === 'line');
        this.syncToggle(layout, '#toggle-group-by', this.state.groupByMode === 'log_name');
        this.syncToggle(layout, '#toggle-metric', this.state.metric === 'characters');
        this.updateNavigationState(layout);
    }

    private syncToggle(layout: HTMLElement, selector: string, checked: boolean): void {
        const input = layout.querySelector<HTMLInputElement>(selector);
        if (!input) return;

        input.checked = checked;
        const labels = input.closest('.chart-toolbar-group')?.querySelectorAll<HTMLElement>('.toggle-label');
        labels?.item(0).classList.toggle('active', !checked);
        labels?.item(1).classList.toggle('active', checked);
    }

    /** Updates interaction state while a new backend range is in flight,
     * without constructing charts from data belonging to the previous range. */
    public updatePendingParams(params: Partial<ActivityChartsState>): void {
        this.state = { ...this.state, ...params };
        // Prevent an older asynchronous Chart.js import/render from applying
        // data for the range that has just been superseded.
        this.renderGeneration++;
        const layout = this.container.querySelector<HTMLElement>('#activity-charts-grid');
        if (!layout) return;
        delete layout.dataset.dashboardRequestId;
        delete layout.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.dashboardRequestId;
        this.syncControlState(layout);
    }

    private async renderCharts(layout: HTMLElement): Promise<void> {
        const generation = ++this.renderGeneration;
        const snapshotRequestId = this.state.snapshotRequestId;
        // The mounted canvases can still contain data from an earlier snapshot
        // while Chart.js is being imported. Clear the completion marker until
        // both charts have been constructed for this render generation.
        delete layout.dataset.dashboardRequestId;
        const pieCanvas = layout.querySelector<HTMLCanvasElement>('#pieChart')!;
        const barCanvas = layout.querySelector<HTMLCanvasElement>('#barChart')!;
        if (!pieCanvas || !barCanvas) return;
        delete pieCanvas.dataset.dashboardRequestId;

        const colors = this.getChartColors();
        const rangeLogs = this.state.logs ?? this.state.rangeData?.bucket_totals.map((bucket, index) => ({
            id: index,
            media_id: 0,
            title: '',
            activity_type: '',
            duration_minutes: bucket.total_minutes,
            characters: bucket.total_characters,
            date: bucket.bucket,
            language: '',
            notes: '',
        })) ?? [];
        const timeRange = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay ?? 1);
        layout.dataset.rangeStart = timeRange.validStart;
        layout.dataset.rangeEnd = timeRange.validEnd;
        layout.dataset.timeRangeDays = String(this.state.timeRangeDays);
        layout.dataset.timeRangeOffset = String(this.state.timeRangeOffset);

        // Publish the current aggregate data independently of Chart.js. Tests
        // and other DOM consumers that inspect the data should not have to wait
        // for the lazy chart module or the sibling activity chart to finish
        // constructing.
        const pieData = this.preparePieChartData(timeRange);
        pieCanvas.dataset.groupBy = this.state.groupByMode;
        pieCanvas.dataset.metric = this.state.metric;
        pieCanvas.dataset.labels = JSON.stringify(pieData.labels);
        pieCanvas.dataset.values = JSON.stringify(pieData.values);
        if (snapshotRequestId !== undefined) {
            pieCanvas.dataset.dashboardRequestId = snapshotRequestId.toString();
        }

        const importStarted = performanceNow();
        const Chart = await loadChartConstructor();
        logPerformance('chart_import', 'chart_js', performanceNow() - importStarted);
        if (generation !== this.renderGeneration || !this.container.contains(layout)) return;

        this.destroyChartInstances();
        this.createPieChart(Chart, pieCanvas, colors, pieData);
        this.createBarChart(Chart, barCanvas, colors, timeRange);
        if (snapshotRequestId !== undefined) {
            layout.dataset.dashboardRequestId = snapshotRequestId.toString();
        }
    }

    private getChartColors(): string[] {
        const style = getComputedStyle(document.body);
        return [
            style.getPropertyValue('--chart-1').trim() || '#f4a6b8',
            style.getPropertyValue('--chart-2').trim() || '#b8cdda',
            style.getPropertyValue('--chart-3').trim() || '#e0bbe4',
            style.getPropertyValue('--chart-4').trim() || '#957DAD',
            style.getPropertyValue('--chart-5').trim() || '#D291BC'
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

        this.pieChartInstance = measureSynchronous('chart_construction', 'dashboard_pie_chart', () => new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: data.labels,
                datasets: [{
                    data: data.values,
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: data.labels.length <= 6, position: 'bottom', labels: { color: style.getPropertyValue('--text-secondary').trim() ||'#f0f0f5' } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed;
                                if (this.state.metric === 'minutes') {
                                    return formatStatsDuration(val, true);
                                }
                                return `${val.toLocaleString()} chars`;
                            }
                        }
                    }
                }
            }
        }));
    }

    private createBarChart(Chart: ChartConstructor, canvas: HTMLCanvasElement, colors: string[], timeRange: ActivityRange) {
        const { chartType } = this.state;
        const { labels } = timeRange;
        const style = getComputedStyle(document.body);
        const secondaryColor = style.getPropertyValue('--text-secondary').trim() || '#a0a0b0'
        const gridColor = `color-mix(in srgb, ${style.getPropertyValue('--text-secondary').trim() || '#3f3f4e'} 30%, transparent)`;
        const datasets = measureSynchronous(
            'aggregation',
            'dashboard_bar_data',
            () => this.prepareBarChartDatasets(timeRange, colors),
            { points: this.state.rangeData?.series.length ?? this.state.logs?.length ?? 0 },
        );

        canvas.dataset.chartType = chartType;
        canvas.dataset.groupBy = this.state.groupByMode;
        canvas.dataset.metric = this.state.metric;
        canvas.dataset.seriesLabels = JSON.stringify(datasets.map(dataset => dataset.label));
        canvas.dataset.seriesTotals = JSON.stringify(
            datasets.map(dataset => dataset.data.reduce((sum, value) => sum + value, 0)),
        );

        this.barChartInstance = measureSynchronous('chart_construction', 'dashboard_activity_chart', () => new Chart(canvas, {
            type: chartType,
            data: {
                labels: timeRange.unit === 'day' ? labels.map(label => this.formatDailyDateLabel(label)) : labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: chartType === 'bar', grid: { color: gridColor }, ticks: { color: secondaryColor } },
                    y: {
                        stacked: chartType === 'bar',
                        grid: { color: gridColor },
                        ticks: {
                            color: secondaryColor,
                            callback: (value) => {
                                if (this.state.metric === 'minutes') {
                                    return formatStatsDuration(value as number, true);
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
                                    return `${context.dataset.label}: ${formatStatsDuration(val, true)}`;
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

    private prepareBarChartDatasets(timeRange: ActivityRange, colors: string[]) {
        const { groupByMode, chartType } = this.state;
        const logs = this.state.logs ?? [];
        const { labels, getBucketIndex } = timeRange;

        if (this.state.rangeData) {
            const activeGroups = new Map<string, string>();
            for (const point of this.state.rangeData.series) {
                activeGroups.set(point.group_key, point.group_label);
            }
            const datasetsMap = new Map<string, number[]>();
            for (const key of activeGroups.keys()) {
                datasetsMap.set(key, Array.from({ length: labels.length }, () => 0));
            }
            for (const point of this.state.rangeData.series) {
                const index = getBucketIndex(point.bucket);
                if (index === -1) continue;
                const value = this.state.metric === 'minutes' ? point.total_minutes : point.total_characters;
                datasetsMap.get(point.group_key)![index] += value;
            }
            return this.toDatasets(datasetsMap, activeGroups, colors, chartType);
        }

        const activeGroups = this.getActiveGroups(logs, log => getBucketIndex(log.date) !== -1, groupByMode);
        const datasetsMap = this.aggregateDailyData(logs, activeGroups, getBucketIndex, labels.length, groupByMode);

        return this.toDatasets(datasetsMap, activeGroups, colors, chartType);
    }

    private toDatasets(
        datasetsMap: Map<string, number[]>,
        activeGroups: Map<string, string>,
        colors: string[],
        chartType: 'bar' | 'line',
    ) {
        return Array.from(datasetsMap.entries())
            .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
            .map(([key, data], i) => ({
                label: activeGroups.get(key) ?? key,
                data: data,
                backgroundColor: colors[i % colors.length],
                borderColor: colors[i % colors.length],
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
        this.pieChartInstance?.destroy();
        this.barChartInstance?.destroy();
        this.pieChartInstance = null;
        this.barChartInstance = null;
    }
}

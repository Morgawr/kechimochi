import { Component } from '../component';
import { html } from '../html';
import { ActivitySummary } from '../api';
import Chart from 'chart.js/auto';
import { formatStatsDuration } from '../time';
import { ACTIVITY_TIME_RANGES, getActivityRange } from './activity_ranges';

const WEEKLY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
});

interface ActivityChartsState {
    logs: ActivitySummary[];
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: 'media_type' | 'log_name';
    chartType: 'bar' | 'line';
    metric: 'minutes' | 'characters';
    weekStartDay?: number;
}

export class ActivityCharts extends Component<ActivityChartsState> {
    private pieChartInstance: Chart | null = null;
    private barChartInstance: Chart | null = null;
    private readonly onChartParamChange: (params: Partial<ActivityChartsState>) => void;

    constructor(container: HTMLElement, initialState: ActivityChartsState, onChartParamChange: (params: Partial<ActivityChartsState>) => void) {
        super(container, initialState);
        this.onChartParamChange = onChartParamChange;
    }

    render() {
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
                                    <option value="7" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.WEEKLY ? 'selected' : ''}>Weekly</option>
                                    <option value="30" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.MONTHLY ? 'selected' : ''}>Monthly</option>
                                    <option value="365" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.YEARLY ? 'selected' : ''}>Yearly</option>
                                    <option value="0" ${this.state.timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME ? 'selected' : ''}>All Time</option>
                                </select>
                            </div>

                            <div class="chart-toolbar-divider" aria-hidden="true"></div>

                            <!-- Group By Toggle -->
                            <div class="chart-toolbar-group">
                                <span class="toggle-label ${this.state.groupByMode === 'media_type' ? 'active' : ''}">Type</span>
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
        this.updateNavigationState(chartsLayout);
        this.renderCharts(chartsLayout);
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
            this.onChartParamChange({ groupByMode: toggleGroupBy.checked ? 'log_name' : 'media_type' });
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

    private renderCharts(layout: HTMLElement) {
        const pieCanvas = layout.querySelector<HTMLCanvasElement>('#pieChart')!;
        const barCanvas = layout.querySelector<HTMLCanvasElement>('#barChart')!;
        if (!pieCanvas || !barCanvas) return;

        if (this.pieChartInstance) this.pieChartInstance.destroy();
        if (this.barChartInstance) this.barChartInstance.destroy();

        const colors = this.getChartColors();
        const timeRange = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, this.state.logs, this.state.weekStartDay ?? 1);
        layout.dataset.rangeStart = timeRange.validStart;
        layout.dataset.rangeEnd = timeRange.validEnd;
        layout.dataset.timeRangeDays = String(this.state.timeRangeDays);
        layout.dataset.timeRangeOffset = String(this.state.timeRangeOffset);

        this.createPieChart(pieCanvas, colors, timeRange);
        this.createBarChart(barCanvas, colors, timeRange);
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

    private createPieChart(canvas: HTMLCanvasElement, colors: string[], timeRange: { labels: string[], getBucketIndex: (dateStr: string) => number, validStart: string, validEnd: string }) {
        const { logs, groupByMode } = this.state;
        const { validStart, validEnd } = timeRange;
        const pieTypeMap = new Map<string, number>();
        const style = getComputedStyle(document.body);

        for (const log of logs) {
            if (log.date >= validStart && log.date <= validEnd) {
                const key = groupByMode === 'media_type' ? log.media_type : log.title;
                const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
                pieTypeMap.set(key, (pieTypeMap.get(key) || 0) + value);
            }
        }

        const sortedEntries = Array.from(pieTypeMap.entries()).sort((a, b) => b[1] - a[1]);

        this.pieChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: sortedEntries.map(e => e[0]),
                datasets: [{
                    data: sortedEntries.map(e => e[1]),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: pieTypeMap.size <= 6, position: 'bottom', labels: { color: style.getPropertyValue('--text-secondary').trim() ||'#f0f0f5' } },
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
        });
    }

    private createBarChart(canvas: HTMLCanvasElement, colors: string[], timeRange: { labels: string[], getBucketIndex: (dateStr: string) => number, validStart: string, validEnd: string }) {
        const { chartType, timeRangeDays } = this.state;
        const { labels } = timeRange;
        const style = getComputedStyle(document.body);
        const secondaryColor = style.getPropertyValue('--text-secondary').trim() || '#a0a0b0'
        const gridColor = `color-mix(in srgb, ${style.getPropertyValue('--text-secondary').trim() || '#3f3f4e'} 30%, transparent)`;
        const datasets = this.prepareBarChartDatasets(timeRange, colors);

        this.barChartInstance = new Chart(canvas, {
            type: chartType,
            data: {
                labels: timeRangeDays === 7 ? labels.map((label: string) => this.formatWeeklyDateLabel(label)) : labels,
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
        });
    }

    private formatWeeklyDateLabel(label: string): string {
        const [year, month, day] = label.split('-').map(Number);
        return WEEKLY_LABEL_FORMATTER.format(new Date(year, month - 1, day));
    }

    private prepareBarChartDatasets(timeRange: { labels: string[], getBucketIndex: (dateStr: string) => number, validStart: string, validEnd: string }, colors: string[]) {
        const { logs, groupByMode, chartType } = this.state;
        const { labels, getBucketIndex } = timeRange;

        const activeKeys = this.getActiveKeys(logs, getBucketIndex, groupByMode);
        const datasetsMap = this.aggregateDailyData(logs, activeKeys, getBucketIndex, labels.length, groupByMode);

        return Array.from(datasetsMap.entries())
            .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
            .map(([key, data], i) => ({
                label: key,
                data: data,
                backgroundColor: colors[i % colors.length],
                borderColor: colors[i % colors.length],
                fill: chartType === 'line' ? false : undefined,
                tension: 0.3
            }));
    }

    private getActiveKeys(logs: ActivitySummary[], getBucketIndex: (date: string) => number, mode: 'media_type' | 'log_name'): Set<string> {
        const keys = new Set<string>();
        for (const log of logs) {
            if (getBucketIndex(log.date) !== -1) {
                keys.add(mode === 'media_type' ? log.media_type : log.title);
            }
        }
        return keys;
    }

    private aggregateDailyData(logs: ActivitySummary[], activeKeys: Set<string>, getBucketIndex: (date: string) => number, length: number, mode: 'media_type' | 'log_name') {
        const map = new Map<string, number[]>();
        for (const key of activeKeys) {
            map.set(key, Array.from({ length }, () => 0));
        }

        for (const log of logs) {
            const index = getBucketIndex(log.date);
            if (index !== -1) {
                const key = mode === 'media_type' ? log.media_type : log.title;
                if (map.has(key)) {
                    const value = this.state.metric === 'minutes' ? log.duration_minutes : (log.characters || 0);
                    map.get(key)![index] += value;
                }
            }
        }
        return map;
    }
    public destroy() {
        if (this.pieChartInstance) this.pieChartInstance.destroy();
        if (this.barChartInstance) this.barChartInstance.destroy();
    }
}

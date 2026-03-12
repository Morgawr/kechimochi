import { Component } from '../../core/component';
import { html } from '../../core/html';
import { ActivitySummary } from '../../api';
import Chart from 'chart.js/auto';
import { formatStatsDuration } from '../../utils/time';

interface ActivityChartsState {
    logs: ActivitySummary[];
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: 'media_type' | 'log_name';
    chartType: 'bar' | 'line';
}

export class ActivityCharts extends Component<ActivityChartsState> {
    private pieChartInstance: Chart | null = null;
    private barChartInstance: Chart | null = null;
    private onChartParamChange: (params: Partial<ActivityChartsState>) => void;

    constructor(container: HTMLElement, initialState: ActivityChartsState, onChartParamChange: (params: Partial<ActivityChartsState>) => void) {
        super(container, initialState);
        this.onChartParamChange = onChartParamChange;
    }

    render() {
        this.clear();
        
        const chartsLayout = html`
            <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 2rem;">
                <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
                    <h3 style="text-align: center; margin-bottom: 1rem;">Activity Breakdown</h3>
                    <div class="chart-container-wrapper" style="flex: 1; min-height: 0;">
                        <canvas id="pieChart"></canvas>
                    </div>
                </div>
                <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <button class="btn btn-ghost" style="padding: 0.1rem 0.4rem;" id="btn-chart-prev">&lt;</button>
                            <h3 style="margin: 0;">Activity visualization</h3>
                            <button class="btn btn-ghost" style="padding: 0.1rem 0.4rem;" id="btn-chart-next">&gt;</button>
                        </div>
                        <div class="chart-toolbar">
                            <!-- Chart Type Toggle -->
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span class="toggle-label ${this.state.chartType === 'bar' ? 'active' : ''}" style="text-align: right;">Bar</span>
                                <label class="switch">
                                    <input type="checkbox" id="toggle-chart-type" ${this.state.chartType === 'line' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span class="toggle-label ${this.state.chartType === 'line' ? 'active' : ''}">Line</span>
                            </div>

                            <div class="chart-toolbar-divider"></div>

                            <!-- Time Range Select -->
                            <select id="select-time-range" style="font-size: 0.65rem; padding: 0.1rem 0.3rem; border: none; background: transparent; cursor: pointer; color: var(--text-primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                                <option value="7" ${this.state.timeRangeDays === 7 ? 'selected' : ''}>Weekly</option>
                                <option value="30" ${this.state.timeRangeDays === 30 ? 'selected' : ''}>Monthly</option>
                                <option value="365" ${this.state.timeRangeDays === 365 ? 'selected' : ''}>Yearly</option>
                            </select>

                            <div class="chart-toolbar-divider"></div>

                            <!-- Group By Toggle -->
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span class="toggle-label ${this.state.groupByMode === 'media_type' ? 'active' : ''}" style="text-align: right;">Type</span>
                                <label class="switch">
                                    <input type="checkbox" id="toggle-group-by" ${this.state.groupByMode === 'log_name' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span class="toggle-label ${this.state.groupByMode === 'log_name' ? 'active' : ''}">Name</span>
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
        this.renderCharts(chartsLayout);
    }

    private setupListeners(layout: HTMLElement) {
        layout.querySelector('#btn-chart-prev')?.addEventListener('click', () => {
             this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset + 1 });
        });
        layout.querySelector('#btn-chart-next')?.addEventListener('click', () => {
            if (this.state.timeRangeOffset > 0) {
                this.onChartParamChange({ timeRangeOffset: this.state.timeRangeOffset - 1 });
            }
        });
        layout.querySelector('#toggle-chart-type')?.addEventListener('change', (e) => {
            const isLine = (e.target as HTMLInputElement).checked;
            this.onChartParamChange({ chartType: isLine ? 'line' : 'bar' });
        });
        layout.querySelector('#select-time-range')?.addEventListener('change', (e) => {
            this.onChartParamChange({ timeRangeDays: parseInt((e.target as HTMLSelectElement).value), timeRangeOffset: 0 });
        });
        layout.querySelector('#toggle-group-by')?.addEventListener('change', (e) => {
            const isByName = (e.target as HTMLInputElement).checked;
            this.onChartParamChange({ groupByMode: isByName ? 'log_name' : 'media_type' });
        });
    }

    private renderCharts(layout: HTMLElement) {
        const pieCanvas = layout.querySelector('#pieChart') as HTMLCanvasElement;
        const barCanvas = layout.querySelector('#barChart') as HTMLCanvasElement;
        if (!pieCanvas || !barCanvas) return;

        if (this.pieChartInstance) this.pieChartInstance.destroy();
        if (this.barChartInstance) this.barChartInstance.destroy();

        const colors = this.getChartColors();
        const timeRange = this.calculateTimeRange();
        
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

    private calculateTimeRange() {
        const { timeRangeDays, timeRangeOffset } = this.state;
        const today = new Date();
        let labels: string[] = [];
        let getBucketIndex: (dateStr: string) => number = () => -1;
        let validStart = '';
        let validEnd = '';

        const getLocalISODate = (d: Date) => {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };

        if (timeRangeDays === 7) {
            const endDay = new Date(today);
            endDay.setDate(today.getDate() - (7 * timeRangeOffset));
            const startDay = new Date(endDay);
            const dayOfWeek = endDay.getDay(); 
            const diffToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
            startDay.setDate(endDay.getDate() - diffToMonday);
            endDay.setDate(startDay.getDate() + 6);
            validStart = getLocalISODate(startDay);
            validEnd = getLocalISODate(endDay);
            for(let i = 0; i < 7; i++) {
                const d = new Date(startDay);
                d.setDate(startDay.getDate() + i);
                labels.push(getLocalISODate(d));
            }
            getBucketIndex = (dateStr: string) => labels.indexOf(dateStr);
        } else if (timeRangeDays === 30) {
            const targetMonth = new Date(today.getFullYear(), today.getMonth() - timeRangeOffset, 1);
            const y = targetMonth.getFullYear();
            const m = targetMonth.getMonth();
            const startDay = new Date(y, m, 1);
            const endDay = new Date(y, m + 1, 0);
            validStart = getLocalISODate(startDay);
            validEnd = getLocalISODate(endDay);
            const totalDays = endDay.getDate();
            const weeksCount = Math.ceil(totalDays / 7);
            for(let i=0; i<weeksCount; i++) labels.push(`Week ${i+1}`);
            getBucketIndex = (dateStr: string) => {
                if (dateStr >= validStart && dateStr <= validEnd) {
                    const date = new Date(dateStr + "T00:00:00");
                    const firstOfMonth = new Date(y, m, 1);
                    const firstDayWeekday = firstOfMonth.getDay();
                    const offset = (firstDayWeekday === 0 ? 6 : firstDayWeekday - 1);
                    return Math.floor((date.getDate() + offset - 1) / 7);
                }
                return -1;
            };
        } else if (timeRangeDays === 365) {
            const targetYear = today.getFullYear() - timeRangeOffset;
            validStart = `${targetYear}-01-01`;
            validEnd = `${targetYear}-12-31`;
            labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            getBucketIndex = (dateStr: string) => {
                if (dateStr >= validStart && dateStr <= validEnd) {
                    return parseInt(dateStr.split('-')[1]) - 1;
                }
                return -1;
            };
        }

        return { labels, getBucketIndex, validStart, validEnd };
    }

    private createPieChart(canvas: HTMLCanvasElement, colors: string[], timeRange: any) {
        const { logs, groupByMode } = this.state;
        const { validStart, validEnd } = timeRange;
        const pieTypeMap = new Map<string, number>();

        for (const log of logs) {
            if (log.date >= validStart && log.date <= validEnd) {
                const key = groupByMode === 'media_type' ? log.media_type : log.title;
                pieTypeMap.set(key, (pieTypeMap.get(key) || 0) + log.duration_minutes);
            }
        }

        this.pieChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: Array.from(pieTypeMap.keys()),
                datasets: [{
                    data: Array.from(pieTypeMap.values()),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: pieTypeMap.size <= 6, position: 'bottom', labels: { color: '#f0f0f5' } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed;
                                return `${context.dataset.label || context.label}: ${formatStatsDuration(val, true)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    private createBarChart(canvas: HTMLCanvasElement, colors: string[], timeRange: any) {
        const { chartType, timeRangeDays } = this.state;
        const { labels } = timeRange;

        const datasets = this.prepareBarChartDatasets(timeRange, colors);

        this.barChartInstance = new Chart(canvas, {
            type: chartType,
            data: {
                labels: timeRangeDays === 7 ? labels.map((l: string) => l.slice(5)) : labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: chartType === 'bar', grid: { color: '#3f3f4e' }, ticks: { color: '#a0a0b0' } },
                    y: { 
                        stacked: chartType === 'bar', 
                        grid: { color: '#3f3f4e' }, 
                        ticks: { 
                            color: '#a0a0b0',
                            callback: (value) => { 
                                return formatStatsDuration(value as number, true);
                            }
                        } 
                    }
                },
                plugins: {
                    legend: { display: datasets.length <= 6, position: 'top', labels: { color: '#a0a0b0'} },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed.y ?? 0;
                                return `${context.dataset.label}: ${formatStatsDuration(val, true)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    private prepareBarChartDatasets(timeRange: any, colors: string[]) {
        const { logs, groupByMode, chartType } = this.state;
        const { labels, getBucketIndex } = timeRange;

        const activeKeys = this.getActiveKeys(logs, getBucketIndex, groupByMode);
        const datasetsMap = this.aggregateDailyData(logs, activeKeys, getBucketIndex, labels.length, groupByMode);

        return Array.from(datasetsMap.entries()).map(([key, data], i) => ({
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
            map.set(key, Array(length).fill(0));
        }

        for (const log of logs) {
            const index = getBucketIndex(log.date);
            if (index !== -1) {
                const key = mode === 'media_type' ? log.media_type : log.title;
                if (map.has(key)) {
                    map.get(key)![index] += log.duration_minutes;
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

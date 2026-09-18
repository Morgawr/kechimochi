import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityCharts } from '../../../src/dashboard/cards/ActivityCharts';
import { ActivitySummary, Media } from '../../../src/api';
import type { ChartConfiguration, ChartType } from 'chart.js';
import Chart from 'chart.js/auto';
import { loadChartConstructor } from '../../../src/chart_loader';
import type { ChartConstructor } from '../../../src/chart_loader';
import { applyThemePalette } from '../../helpers/theme_palette';

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
    }))
}));

vi.mock('../../../src/chart_loader', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../src/chart_loader')>();
    return { ...actual, loadChartConstructor: vi.fn(actual.loadChartConstructor) };
});

type CapturedChartConfiguration<TType extends ChartType = ChartType> = ChartConfiguration<TType, number[], string>;

function captureChartConfiguration<TType extends ChartType = ChartType>(callIndex: number): CapturedChartConfiguration<TType> {
    return vi.mocked(Chart).mock.calls[callIndex][1] as CapturedChartConfiguration<TType>;
}

function requireChartLabels(labels: string[] | undefined): string[] {
    if (labels === undefined) {
        throw new Error('chart configuration is missing labels');
    }
    return labels;
}

const THEME_BORDER_COLOR = '#314159';

describe('ActivityCharts', () => {
    let container: HTMLElement;
    let breakdownHost: HTMLElement;
    let visualizationHost: HTMLElement;
    let hosts: Map<'activity_breakdown' | 'activity_visualization', HTMLElement>;
    let onRenderComplete: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        applyThemePalette();
        container = document.createElement('div');
        breakdownHost = document.createElement('div');
        visualizationHost = document.createElement('div');
        container.append(breakdownHost, visualizationHost);
        document.body.appendChild(container);
        hosts = new Map<'activity_breakdown' | 'activity_visualization', HTMLElement>([
            ['activity_breakdown', breakdownHost],
            ['activity_visualization', visualizationHost],
        ]);
        onRenderComplete = vi.fn();
        document.body.style.setProperty('--border-color', THEME_BORDER_COLOR);
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        container.remove();
        document.body.style.removeProperty('--border-color');
    });

    async function waitForChartConstruction(): Promise<void> {
        await vi.waitFor(() => expect(Chart).toHaveBeenCalledTimes(2));
    }

    it('should render one chart canvas into each of its own hosts', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
        );
        component.render();
        expect(Chart).not.toHaveBeenCalled();
        await waitForChartConstruction();

        expect(breakdownHost.querySelector('#pieChart')).not.toBeNull();
        expect(visualizationHost.querySelector('#barChart')).not.toBeNull();
        expect(breakdownHost.querySelector('#barChart')).toBeNull();
        expect(visualizationHost.querySelector('#pieChart')).toBeNull();
        expect(Chart).toHaveBeenCalledTimes(2);
    });

    it('updates charts without replacing the mounted cards or canvases', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [
                    { date: '2026-06-10', duration_minutes: 10, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-05-15', duration_minutes: 0, characters: 500, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                ],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const breakdownCard = breakdownHost.querySelector('.card');
        const visualizationCard = visualizationHost.querySelector('.card');
        const pieCanvas = container.querySelector('#pieChart');
        const barCanvas = container.querySelector('#barChart');
        vi.clearAllMocks();

        component.setState({
            timeRangeDays: 30,
            timeRangeOffset: 1,
            chartType: 'line',
            groupByMode: 'log_name',
            metric: 'characters',
        });
        await waitForChartConstruction();

        expect(breakdownHost.querySelector('.card')).toBe(breakdownCard);
        expect(visualizationHost.querySelector('.card')).toBe(visualizationCard);
        expect(container.querySelector('#pieChart')).toBe(pieCanvas);
        expect(container.querySelector('#barChart')).toBe(barCanvas);
    });

    it('marks aggregate data before chart construction and visualizations after', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 41,
            },
            () => {},
            onRenderComplete,
        );

        component.render();
        const pieCanvas = container.querySelector<HTMLCanvasElement>('#pieChart');
        expect(onRenderComplete).not.toHaveBeenCalled();
        expect(pieCanvas?.dataset.dashboardRequestId).toBe('41');
        await waitForChartConstruction();
        expect(onRenderComplete).toHaveBeenCalledWith(41);

        component.updatePendingParams({ timeRangeDays: 30 });
        expect(pieCanvas?.dataset.dashboardRequestId).toBeUndefined();

        vi.clearAllMocks();
        component.setState({ snapshotRequestId: 42 });
        expect(pieCanvas?.dataset.dashboardRequestId).toBe('42');
        await waitForChartConstruction();
        expect(onRenderComplete).toHaveBeenCalledWith(42);
    });

    it('should destroy chart instances on destroy', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const instances = vi.mocked(Chart).mock.results.map(r => r.value);
        component.destroy();
        
        instances.forEach(instance => expect(instance.destroy).toHaveBeenCalled());
    });

    it('should handle different time ranges', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T12:00:00'));

        // 30 days
        let component = new ActivityCharts(
            container,
            hosts,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 30, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();

        // 365 days
        vi.clearAllMocks();
        component = new ActivityCharts(
            container,
            hosts,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 365, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();
    });

    it('should format weekly chart labels as month abbreviations with two-digit days', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const barChartConfig = captureChartConfiguration(1);

        expect(barChartConfig.data.labels).toEqual([
            'Jun 08',
            'Jun 09',
            'Jun 10',
            'Jun 11',
            'Jun 12',
            'Jun 13',
            'Jun 14',
        ]);
    });

    it('should chart monthly activity as one data point per day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [
                    { date: '2026-06-01', duration_minutes: 15, title: 'Novel', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-06-08', duration_minutes: 30, title: 'Novel', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-06-30', duration_minutes: 45, title: 'Novel', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                ],
                timeRangeDays: 30,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const barChartConfig = captureChartConfiguration(1);
        const barChartLabels = requireChartLabels(barChartConfig.data.labels);

        expect(barChartLabels).toHaveLength(30);
        expect(barChartLabels[0]).toBe('Jun 01');
        expect(barChartLabels[29]).toBe('Jun 30');
        expect(barChartConfig.data.datasets[0].data).toHaveLength(30);
        expect(barChartConfig.data.datasets[0].data[0]).toBe(15);
        expect(barChartConfig.data.datasets[0].data[7]).toBe(30);
        expect(barChartConfig.data.datasets[0].data[29]).toBe(45);
    });

    it('should keep offset weekly pie chart totals within the selected week when crossing months', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-09T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [
                    { date: '2026-04-28', duration_minutes: 1200, title: 'Week 1', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-05-05', duration_minutes: 1800, title: 'Week 2', media_id: 2, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary
                ],
                timeRangeDays: 7,
                timeRangeOffset: 1,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes'
            },
        );
        component.render();
        await waitForChartConstruction();

        const pieChartConfig = captureChartConfiguration(0);

        expect(pieChartConfig.data.datasets[0].data).toEqual([1200]);
    });

    it('should handle alternative grouping modes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'line', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();
    });

    it('charts bounded backend series without raw activity logs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        const component = new ActivityCharts(container, hosts, {
            rangeData: {
                request_id: 1,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [
                    { bucket: '2026-06-08', group_key: 'activity:Reading', group_label: 'Reading', total_minutes: 30, total_characters: 1000 },
                    { bucket: '2026-06-09', group_key: 'activity:Reading', group_label: 'Reading', total_minutes: 45, total_characters: 2000 },
                ],
                bucket_totals: [
                    { bucket: '2026-06-08', total_minutes: 30, total_characters: 1000 },
                    { bucket: '2026-06-09', total_minutes: 45, total_characters: 2000 },
                ],
                previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
                category_totals: [],
                highlights: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            chartType: 'bar',
            metric: 'minutes',
        });

        component.render();
        await waitForChartConstruction();

        const pieConfig = captureChartConfiguration(0);
        const barConfig = captureChartConfiguration(1);
        expect(pieConfig.data.datasets[0].data).toEqual([75]);
        expect(barConfig.data.datasets[0].data.slice(0, 2)).toEqual([30, 45]);
    });

    it('keeps same-title media variants separate when grouping by name', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const logs = [
            { date: '2026-06-08', duration_minutes: 10, title: 'Horimiya', media_id: 1, activity_type: 'Reading', language: 'Japanese' },
            { date: '2026-06-09', duration_minutes: 20, title: 'Horimiya', media_id: 2, activity_type: 'Watching', language: 'Japanese' },
            { date: '2026-06-10', duration_minutes: 5, title: 'Unique title', media_id: 3, activity_type: 'Reading', language: 'Japanese' },
        ] as ActivitySummary[];
        const mediaList = [
            { id: 1, title: 'Horimiya', variant: 'Manga' },
            { id: 2, title: 'Horimiya', variant: 'Anime' },
            { id: 3, title: 'Unique title', variant: 'Novel' },
        ] as Media[];
        const component = new ActivityCharts(
            container,
            hosts,
            { logs, mediaList, timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'bar', metric: 'minutes' },
        );

        component.render();
        await waitForChartConstruction();

        const pieChartConfig = captureChartConfiguration(0);
        const barChartConfig = captureChartConfiguration(1);
        expect(pieChartConfig.data.labels).toEqual([
            'Horimiya — Anime',
            'Horimiya — Manga',
            'Unique title',
        ]);
        expect(pieChartConfig.data.datasets[0].data).toEqual([20, 10, 5]);
        expect(barChartConfig.data.datasets.map(dataset => dataset.label)).toEqual([
            'Horimiya — Anime',
            'Horimiya — Manga',
            'Unique title',
        ]);
        expect(barChartConfig.data.datasets.map(dataset => dataset.data.reduce((sum, value) => sum + value, 0))).toEqual([20, 10, 5]);
    });

    it('gives the doughnut chart segments a separator border', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();

        const pieChartConfig = captureChartConfiguration<'doughnut'>(0);

        expect(pieChartConfig.data.datasets[0].borderColor).toBe(THEME_BORDER_COLOR);
        expect(pieChartConfig.data.datasets[0].borderWidth).toBe(1);
        expect(pieChartConfig.data.datasets[0].borderAlign).toBeUndefined();
    });

    it('separates stacked bar segments without outlining the stack', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const logs = [
            { date: '2026-06-10', duration_minutes: 10, title: 'A', media_id: 1, activity_type: 'Reading', language: 'Japanese' },
            { date: '2026-06-10', duration_minutes: 20, title: 'B', media_id: 2, activity_type: 'Watching', language: 'Japanese' },
        ] as ActivitySummary[];

        const component = new ActivityCharts(
            container,
            hosts,
            { logs, timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();

        const datasets = captureChartConfiguration<'bar'>(1).data.datasets;

        expect(datasets[0].borderColor).toBe(THEME_BORDER_COLOR);
        expect(datasets[0].borderColor).not.toBe(datasets[0].backgroundColor);
        expect(datasets[0].borderWidth).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(datasets[1].borderWidth).toEqual({ top: 0, right: 0, bottom: 2, left: 0 });
        expect(datasets[1].borderSkipped).toBe(false);
    });

    it('keeps each line chart dataset\'s own color as its borderColor', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'line', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();

        const lineChartConfig = captureChartConfiguration(1);
        const dataset = lineChartConfig.data.datasets[0];

        expect(dataset.borderColor).toBe(dataset.backgroundColor);
        expect(dataset.borderColor).not.toBe(THEME_BORDER_COLOR);
    });

    it('should render the empty state, skip chart construction, and still set completion markers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes', snapshotRequestId: 9 },
            () => {},
            onRenderComplete,
        );
        component.render();

        expect(visualizationHost.dataset.chartEmpty).toBe('true');
        expect(onRenderComplete).toHaveBeenCalledWith(9);
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(2);
        expect(Chart).not.toHaveBeenCalled();
    });

    it('marks only the bar chart empty when the range holds unbucketed totals', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(container, hosts, {
            rangeData: {
                request_id: 1,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [
                    { bucket: '2026-06-08', group_key: 'activity:Reading', group_label: 'Reading', total_minutes: 30, total_characters: 1000 },
                ],
                bucket_totals: [],
                previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
                category_totals: [],
                highlights: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            chartType: 'bar',
            metric: 'minutes',
        });

        component.render();
        await vi.waitFor(() => expect(Chart).toHaveBeenCalledTimes(1));

        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('false');
        expect(container.querySelector<HTMLCanvasElement>('#barChart')?.dataset.chartEmpty).toBe('true');
        expect(visualizationHost.dataset.chartEmpty).toBe('false');
        expect(container.querySelector('#pie-chart-empty-message')?.classList.contains('is-visible')).toBe(false);
        expect(container.querySelector('#bar-chart-empty-message')?.classList.contains('is-visible')).toBe(true);
        expect(Chart).toHaveBeenCalledTimes(1);
        expect(captureChartConfiguration(0).type).toBe('doughnut');
    });

    it('should show the encouraging call to action when today falls in the empty period', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();

        const message = container.querySelector('.chart-empty-message');
        expect(message?.textContent).toBe('No data in this period. Go immerse!');
        expect(message?.querySelector('.chart-empty-prompt')?.textContent).toBe('Go immerse!');
    });

    it('should show the plain message when paged to a past empty period', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 1, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
        );
        component.render();

        const message = container.querySelector('.chart-empty-message');
        expect(message?.textContent).toBe('No data in this period.');
    });

    it('should treat a time-only dataset as empty when viewing characters', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 30, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'characters',
            },
        );
        component.render();

        expect(visualizationHost.dataset.chartEmpty).toBe('true');
        expect(Chart).not.toHaveBeenCalled();
    });

    it('should leave the empty state and construct charts when paging back to a period with data', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-01', duration_minutes: 20, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 9,
            },
            () => {},
            onRenderComplete,
        );
        component.render();

        expect(visualizationHost.dataset.chartEmpty).toBe('true');
        expect(Chart).not.toHaveBeenCalled();

        component.setState({ timeRangeDays: 30 });
        await waitForChartConstruction();

        expect(visualizationHost.dataset.chartEmpty).toBe('false');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(0);
        expect(onRenderComplete).toHaveBeenCalledWith(9);
    });

    it('clears the stale empty overlay while a new range request is pending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            hosts,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes', snapshotRequestId: 9 },
        );
        component.render();

        expect(visualizationHost.dataset.chartEmpty).toBe('true');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(2);

        component.updatePendingParams({ timeRangeDays: 30 });

        expect(visualizationHost.dataset.chartEmpty).toBeUndefined();
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(0);
    });

    it('does not paint stale data when a reload interrupts a pending chart import', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        let resolveImport!: (value: ChartConstructor) => void;
        const pendingImport = new Promise<ChartConstructor>(resolve => { resolveImport = resolve; });
        vi.mocked(loadChartConstructor).mockReturnValueOnce(pendingImport);

        const component = new ActivityCharts(
            container,
            hosts,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 1,
            },
            () => {},
            onRenderComplete,
        );
        component.render();

        component.updatePendingParams({ timeRangeDays: 30 });
        resolveImport(Chart);
        await Promise.resolve();
        await Promise.resolve();

        expect(Chart).not.toHaveBeenCalled();
        expect(onRenderComplete).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.dashboardRequestId).toBeUndefined();
    });

    it('tears down a chart in the same tick its empty overlay goes up', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(container, hosts, {
            logs: [{ date: '2026-06-10', duration_minutes: 10, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            chartType: 'bar',
            metric: 'minutes',
        });
        component.render();
        await waitForChartConstruction();
        const pieChartInstance = vi.mocked(Chart).mock.results[0].value;

        component.setState({
            logs: undefined,
            rangeData: {
                request_id: 2,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [],
                bucket_totals: [{ bucket: '2026-06-09', total_minutes: 50, total_characters: 0 }],
                previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
                category_totals: [],
                highlights: [],
            },
        });
        expect(container.querySelector('#pie-chart-empty-message')?.classList.contains('is-visible')).toBe(true);
        expect(pieChartInstance.destroy).toHaveBeenCalled();
    });
});

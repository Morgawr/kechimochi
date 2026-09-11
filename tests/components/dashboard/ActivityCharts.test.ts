import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityCharts } from '../../../src/dashboard/ActivityCharts';
import { ActivitySummary, Media } from '../../../src/api';
import type { ChartConfiguration, ChartType } from 'chart.js';
import Chart from 'chart.js/auto';
import { applyThemePalette } from '../../helpers/theme_palette';
import { loadChartConstructor } from '../../../src/chart_loader';
import type { ChartConstructor } from '../../../src/chart_loader';

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
    }))
}));

vi.mock('../../../src/chart_loader', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../src/chart_loader')>();
    return { ...actual, loadChartConstructor: vi.fn(actual.loadChartConstructor) };
});

type CapturedChartConfiguration = ChartConfiguration<ChartType, number[], string>;

function captureChartConfiguration(callIndex: number): CapturedChartConfiguration {
    return vi.mocked(Chart).mock.calls[callIndex][1] as CapturedChartConfiguration;
}

function requireChartLabels(labels: string[] | undefined): string[] {
    if (labels === undefined) {
        throw new Error('chart configuration is missing labels');
    }
    return labels;
}

describe('ActivityCharts', () => {
    let container: HTMLElement;
    let onParamChange: (params: Record<string, unknown>) => void;

    beforeEach(() => {
        applyThemePalette();
        container = document.createElement('div');
        onParamChange = vi.fn();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    async function waitForChartConstruction(): Promise<void> {
        await vi.waitFor(() => expect(Chart).toHaveBeenCalledTimes(2));
    }

    it('should render chart canvases and UI controls', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
            onParamChange
        );
        component.render();
        expect(Chart).not.toHaveBeenCalled();
        await waitForChartConstruction();

        expect(container.querySelector('#pieChart')).toBeDefined();
        expect(container.querySelector('#barChart')).toBeDefined();
        expect(container.querySelector('#toggle-chart-type')).toBeDefined();
        expect(container.querySelector('#toggle-group-by')).toBeDefined();
        expect(Array.from(container.querySelectorAll<HTMLOptionElement>('#select-time-range option')).map(option => option.textContent)).toEqual([
            'Week',
            'Month',
            'Year',
            'All Time',
        ]);
        expect((container.querySelector('#activity-charts-grid') as HTMLElement | null)?.dataset.timeRangeDays).toBe('7');
        expect(Chart).toHaveBeenCalledTimes(2);
    });

    it('updates charts and controls without replacing the mounted layout or canvases', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
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
            onParamChange,
        );
        component.render();
        await waitForChartConstruction();

        const layout = container.querySelector('#activity-charts-grid');
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

        expect(container.querySelector('#activity-charts-grid')).toBe(layout);
        expect(container.querySelector('#pieChart')).toBe(pieCanvas);
        expect(container.querySelector('#barChart')).toBe(barCanvas);
        expect((container.querySelector('#select-time-range') as HTMLSelectElement).value).toBe('30');
        expect((container.querySelector('#toggle-chart-type') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#toggle-group-by') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#toggle-metric') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#btn-chart-next') as HTMLButtonElement).disabled).toBe(false);
    });

    it('marks aggregate data before chart construction and visualizations after', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 41,
            },
            onParamChange,
        );

        component.render();
        const layout = container.querySelector<HTMLElement>('#activity-charts-grid');
        const pieCanvas = container.querySelector<HTMLCanvasElement>('#pieChart');
        expect(layout?.dataset.dashboardRequestId).toBeUndefined();
        expect(pieCanvas?.dataset.dashboardRequestId).toBe('41');
        await waitForChartConstruction();
        expect(layout?.dataset.dashboardRequestId).toBe('41');

        component.updatePendingParams({ timeRangeDays: 30 });
        expect(layout?.dataset.dashboardRequestId).toBeUndefined();
        expect(pieCanvas?.dataset.dashboardRequestId).toBeUndefined();

        vi.clearAllMocks();
        component.setState({ snapshotRequestId: 42 });
        expect(pieCanvas?.dataset.dashboardRequestId).toBe('42');
        await waitForChartConstruction();
        expect(layout?.dataset.dashboardRequestId).toBe('42');
    });

    it('should trigger param change on UI interaction', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        const selectRange = container.querySelector('#select-time-range') as HTMLSelectElement;
        selectRange.value = '30';
        selectRange.dispatchEvent(new Event('change'));

        expect(onParamChange).toHaveBeenCalledWith(expect.objectContaining({ timeRangeDays: 30 }));
    });

    it('should handle navigation buttons', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        container.querySelector('#btn-chart-prev')?.dispatchEvent(new Event('click'));
        expect(onParamChange).toHaveBeenCalledWith({ timeRangeOffset: 1 });
    });

    it('should destroy chart instances on destroy', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
            onParamChange
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
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 30, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();

        // 365 days
        vi.clearAllMocks();
        component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 365, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
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
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
            },
            onParamChange
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
            onParamChange,
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
            onParamChange
        );
        component.render();
        await waitForChartConstruction();

        const chartGrid = container.querySelector('#activity-charts-grid') as HTMLElement;
        const pieChartConfig = captureChartConfiguration(0);

        expect(chartGrid.dataset.rangeStart).toBe('2026-04-27');
        expect(chartGrid.dataset.rangeEnd).toBe('2026-05-03');
        expect(pieChartConfig.data.datasets[0].data).toEqual([1200]);
    });

    it('should handle alternative grouping modes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T12:00:00'));

        const component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'line', metric: 'minutes' },
            onParamChange
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();
    });

    it('charts bounded backend series without raw activity logs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        const component = new ActivityCharts(container, {
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
                category_totals: [],
                highlights: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            chartType: 'bar',
            metric: 'minutes',
        }, onParamChange);

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
            { logs, mediaList, timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'bar', metric: 'minutes' },
            onParamChange,
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

    it('should trigger param change on metric toggle', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        const toggleMetric = container.querySelector('#toggle-metric') as HTMLInputElement;
        toggleMetric.checked = true;
        toggleMetric.dispatchEvent(new Event('change'));

        expect(onParamChange).toHaveBeenCalledWith(expect.objectContaining({ metric: 'characters' }));
    });

    it('should render the empty state, skip chart construction, and still set completion markers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes', snapshotRequestId: 9 },
            onParamChange,
        );
        component.render();

        const layout = container.querySelector<HTMLElement>('#activity-charts-grid');
        expect(layout?.dataset.chartEmpty).toBe('true');
        expect(layout?.dataset.dashboardRequestId).toBe('9');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(2);
        expect(Chart).not.toHaveBeenCalled();
    });

    it('marks only the bar chart empty when the range holds unbucketed totals', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(container, {
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
                category_totals: [],
                highlights: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            chartType: 'bar',
            metric: 'minutes',
        }, onParamChange);

        component.render();
        await vi.waitFor(() => expect(Chart).toHaveBeenCalledTimes(1));

        const layout = container.querySelector<HTMLElement>('#activity-charts-grid');
        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('false');
        expect(container.querySelector<HTMLCanvasElement>('#barChart')?.dataset.chartEmpty).toBe('true');
        expect(layout?.dataset.chartEmpty).toBe('false');
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
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange,
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
            { logs: [], timeRangeDays: 7, timeRangeOffset: 1, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange,
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
            {
                logs: [{ date: '2026-06-10', duration_minutes: 30, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'characters',
            },
            onParamChange,
        );
        component.render();

        expect(container.querySelector<HTMLElement>('#activity-charts-grid')?.dataset.chartEmpty).toBe('true');
        expect(Chart).not.toHaveBeenCalled();
    });

    it('should leave the empty state and construct charts when paging back to a period with data', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            {
                logs: [{ date: '2026-06-01', duration_minutes: 20, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 9,
            },
            onParamChange,
        );
        component.render();

        const layout = container.querySelector<HTMLElement>('#activity-charts-grid');
        expect(layout?.dataset.chartEmpty).toBe('true');
        expect(Chart).not.toHaveBeenCalled();

        component.setState({ timeRangeDays: 30 });
        await waitForChartConstruction();

        expect(layout?.dataset.chartEmpty).toBe('false');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(0);
        expect(layout?.dataset.dashboardRequestId).toBe('9');
    });

    it('clears the stale empty overlay while a new range request is pending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes', snapshotRequestId: 9 },
            onParamChange,
        );
        component.render();

        const layout = container.querySelector<HTMLElement>('#activity-charts-grid');
        expect(layout?.dataset.chartEmpty).toBe('true');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(2);

        component.updatePendingParams({ timeRangeDays: 30 });

        expect(layout?.dataset.chartEmpty).toBeUndefined();
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
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                snapshotRequestId: 1,
            },
            onParamChange,
        );
        component.render();

        component.updatePendingParams({ timeRangeDays: 30 });
        resolveImport(Chart);
        await Promise.resolve();
        await Promise.resolve();

        expect(Chart).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLElement>('#activity-charts-grid')?.dataset.dashboardRequestId).toBeUndefined();
    });
});

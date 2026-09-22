import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityMix } from '../../../src/dashboard/cards/ActivityMix';
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

const THEME_BORDER_COLOR = '#314159';

describe('ActivityMix', () => {
    let container: HTMLElement;

    beforeEach(() => {
        applyThemePalette();
        container = document.createElement('div');
        document.body.appendChild(container);
        document.body.style.setProperty('--border-color', THEME_BORDER_COLOR);
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        container.remove();
        document.body.style.removeProperty('--border-color');
    });

    async function waitForChartConstruction(): Promise<void> {
        await vi.waitFor(() => expect(Chart).toHaveBeenCalledTimes(1));
    }

    it('should render one pie chart canvas into its host', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
            },
        );
        component.render();
        expect(Chart).not.toHaveBeenCalled();
        await waitForChartConstruction();

        expect(container.querySelector('#pieChart')).not.toBeNull();
        expect(Chart).toHaveBeenCalledTimes(1);
    });

    it('updates the chart without replacing the mounted card or canvas', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [
                    { date: '2026-06-10', duration_minutes: 10, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-05-15', duration_minutes: 0, characters: 500, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                ],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const card = container.querySelector('.card');
        const pieCanvas = container.querySelector('#pieChart');
        vi.clearAllMocks();

        component.setState({
            timeRangeDays: 30,
            timeRangeOffset: 1,
            groupByMode: 'log_name',
            metric: 'characters',
        });
        await waitForChartConstruction();

        expect(container.querySelector('.card')).toBe(card);
        expect(container.querySelector('#pieChart')).toBe(pieCanvas);
    });

    it('marks aggregate data before chart construction and visualizations after', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
                snapshotRequestId: 41,
            },
        );

        component.render();
        const pieCanvas = container.querySelector<HTMLCanvasElement>('#pieChart');
        expect(pieCanvas?.dataset.dashboardRequestId).toBe('41');
        expect(container.dataset.dashboardRequestId).toBeUndefined();
        await waitForChartConstruction();
        expect(container.dataset.dashboardRequestId).toBe('41');

        component.updatePendingParams({ timeRangeDays: 30 });
        expect(pieCanvas?.dataset.dashboardRequestId).toBeUndefined();

        vi.clearAllMocks();
        component.setState({ snapshotRequestId: 42 });
        await waitForChartConstruction();
        expect(container.dataset.dashboardRequestId).toBe('42');
    });

    it('should destroy the chart instance on destroy', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
            },
        );
        component.render();
        await waitForChartConstruction();

        const instance = vi.mocked(Chart).mock.results[0].value;
        component.destroy();

        expect(instance.destroy).toHaveBeenCalled();
    });

    it('should keep offset weekly pie chart totals within the selected week when crossing months', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-09T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [
                    { date: '2026-04-28', duration_minutes: 1200, title: 'Week 1', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary,
                    { date: '2026-05-05', duration_minutes: 1800, title: 'Week 2', media_id: 2, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary
                ],
                timeRangeDays: 7,
                timeRangeOffset: 1,
                groupByMode: 'activity_type',
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

        const component = new ActivityMix(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();
        expect(Chart).toHaveBeenCalled();
    });

    it('charts bounded backend series without raw activity logs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        const component = new ActivityMix(container, {
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
            metric: 'minutes',
        });

        component.render();
        await waitForChartConstruction();

        const pieConfig = captureChartConfiguration(0);
        expect(pieConfig.data.datasets[0].data).toEqual([75]);
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
        const component = new ActivityMix(
            container,
            { logs, mediaList, timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', metric: 'minutes' },
        );

        component.render();
        await waitForChartConstruction();

        const pieChartConfig = captureChartConfiguration(0);
        expect(pieChartConfig.data.labels).toEqual([
            'Horimiya — Anime',
            'Horimiya — Manga',
            'Unique title',
        ]);
        expect(pieChartConfig.data.datasets[0].data).toEqual([20, 10, 5]);
    });

    it('gives the doughnut chart segments a separator border', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            { logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', metric: 'minutes' },
        );
        component.render();
        await waitForChartConstruction();

        const pieChartConfig = captureChartConfiguration<'doughnut'>(0);

        expect(pieChartConfig.type).toBe('doughnut');
        expect(pieChartConfig.data.datasets[0].borderColor).toBe(THEME_BORDER_COLOR);
        expect(pieChartConfig.data.datasets[0].borderWidth).toBe(1);
        expect(pieChartConfig.data.datasets[0].borderAlign).toBeUndefined();
    });

    it('should render the empty state, skip chart construction, and still set completion markers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', metric: 'minutes', snapshotRequestId: 9 },
        );
        component.render();

        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('true');
        expect(container.dataset.dashboardRequestId).toBe('9');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(1);
        expect(Chart).not.toHaveBeenCalled();
    });

    it('marks the pie chart empty when all its group totals are zero', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(container, {
            rangeData: {
                request_id: 1,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [],
                bucket_totals: [{ bucket: '2026-06-08', total_minutes: 30, total_characters: 1000 }],
                previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
                category_totals: [],
                highlights: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            metric: 'minutes',
        });

        component.render();

        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('true');
        expect(container.querySelector('#pie-chart-empty-message')?.classList.contains('is-visible')).toBe(true);
        expect(Chart).not.toHaveBeenCalled();
    });

    it('should show the encouraging call to action when today falls in the empty period', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', metric: 'minutes' },
        );
        component.render();

        const message = container.querySelector('.chart-empty-message');
        expect(message?.textContent).toBe('No data in this period. Go immerse!');
        expect(message?.querySelector('.dashboard-card-empty-prompt')?.textContent).toBe('Go immerse!');
    });

    it('should show the plain message when paged to a past empty period', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 1, groupByMode: 'activity_type', metric: 'minutes' },
        );
        component.render();

        const message = container.querySelector('.chart-empty-message');
        expect(message?.textContent).toBe('No data in this period.');
    });

    it('should leave the empty state and construct the chart when paging back to a period with data', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            {
                logs: [{ date: '2026-06-01', duration_minutes: 20, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
                snapshotRequestId: 9,
            },
        );
        component.render();

        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('true');
        expect(Chart).not.toHaveBeenCalled();

        component.setState({ timeRangeDays: 30 });
        await waitForChartConstruction();

        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.chartEmpty).toBe('false');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(0);
        expect(container.dataset.dashboardRequestId).toBe('9');
    });

    it('clears the stale empty overlay while a new range request is pending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', metric: 'minutes', snapshotRequestId: 9 },
        );
        component.render();

        expect(container.dataset.dashboardRequestId).toBe('9');
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(1);

        component.updatePendingParams({ timeRangeDays: 30 });

        expect(container.dataset.dashboardRequestId).toBeUndefined();
        expect(container.querySelectorAll('.chart-empty-message.is-visible')).toHaveLength(0);
    });

    it('does not paint stale data when a reload interrupts a pending chart import', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        let resolveImport!: (value: ChartConstructor) => void;
        const pendingImport = new Promise<ChartConstructor>(resolve => { resolveImport = resolve; });
        vi.mocked(loadChartConstructor).mockReturnValueOnce(pendingImport);

        const component = new ActivityMix(
            container,
            {
                logs: [{ date: '2026-06-10', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                metric: 'minutes',
                snapshotRequestId: 1,
            },
        );
        component.render();

        component.updatePendingParams({ timeRangeDays: 30 });
        resolveImport(Chart);
        await Promise.resolve();
        await Promise.resolve();

        expect(Chart).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLCanvasElement>('#pieChart')?.dataset.dashboardRequestId).toBeUndefined();
    });

    it('tears down the chart in the same tick its empty overlay goes up', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityMix(container, {
            logs: [{ date: '2026-06-10', duration_minutes: 10, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            metric: 'minutes',
        });
        component.render();
        await waitForChartConstruction();
        const chartInstance = vi.mocked(Chart).mock.results[0].value;

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
        expect(chartInstance.destroy).toHaveBeenCalled();
    });

    async function mountMix(): Promise<ActivityMix> {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        const component = new ActivityMix(container, {
            logs: [{ date: '2026-06-10', duration_minutes: 10, characters: 0, title: 'T', media_id: 1, activity_type: 'Reading', language: 'Japanese' } as unknown as ActivitySummary],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            groupByMode: 'activity_type',
            metric: 'minutes',
            hiddenCards: new Set<string>(),
        });
        component.render();
        await waitForChartConstruction();
        return component;
    }

    it('should not rebuild the chart when an unrelated card is toggled', async () => {
        const component = await mountMix();
        vi.clearAllMocks();

        component.updateHiddenCards(new Set(['categories']));
        await Promise.resolve();
        await Promise.resolve();

        expect(Chart).not.toHaveBeenCalled();
        expect(container.querySelector('#pieChart')).not.toBeNull();
    });

    it('should bring the chart card back after it is hidden and shown again', async () => {
        const component = await mountMix();

        component.updateHiddenCards(new Set(['activity_mix']));
        await vi.waitFor(() => expect(container.querySelector('#pieChart')).toBeNull());

        component.updateHiddenCards(new Set());
        await vi.waitFor(() => expect(container.querySelector('#pieChart')).not.toBeNull());
    });
});

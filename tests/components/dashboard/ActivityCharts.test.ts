import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityCharts } from '../../../src/dashboard/ActivityCharts';
import { ActivitySummary } from '../../../src/api';
import Chart from 'chart.js/auto';

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
    }))
}));

describe('ActivityCharts', () => {
    let container: HTMLElement;
    let onParamChange: (params: Record<string, unknown>) => void;

    beforeEach(() => {
        container = document.createElement('div');
        onParamChange = vi.fn();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should render chart canvases and UI controls', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

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

    it('should destroy chart instances on destroy', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        
        const instances = vi.mocked(Chart).mock.results.map(r => r.value);
        component.destroy();
        
        instances.forEach(instance => expect(instance.destroy).toHaveBeenCalled());
    });

    it('should handle different time ranges', () => {
        // 30 days
        let component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 30, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();

        // 365 days
        vi.clearAllMocks();
        component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 365, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
    });

    it('should format weekly chart labels as month abbreviations with two-digit days', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));

        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'activity_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        const barChartConfig = vi.mocked(Chart).mock.calls[1][1];

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

    it('should chart monthly activity as one data point per day', () => {
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

        const barChartConfig = vi.mocked(Chart).mock.calls[1][1];

        expect(barChartConfig.data.labels).toHaveLength(30);
        expect(barChartConfig.data.labels[0]).toBe('Jun 01');
        expect(barChartConfig.data.labels[29]).toBe('Jun 30');
        expect(barChartConfig.data.datasets[0].data).toHaveLength(30);
        expect(barChartConfig.data.datasets[0].data[0]).toBe(15);
        expect(barChartConfig.data.datasets[0].data[7]).toBe(30);
        expect(barChartConfig.data.datasets[0].data[29]).toBe(45);
    });

    it('should keep offset weekly pie chart totals within the selected week when crossing months', () => {
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

        const chartGrid = container.querySelector('#activity-charts-grid') as HTMLElement;
        const pieChartConfig = vi.mocked(Chart).mock.calls[0][1];

        expect(chartGrid.dataset.rangeStart).toBe('2026-04-27');
        expect(chartGrid.dataset.rangeEnd).toBe('2026-05-03');
        expect(pieChartConfig.data.datasets[0].data).toEqual([1200]);
    });

    it('should handle alternative grouping modes', () => {
        const component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, activity_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'line', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
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
});

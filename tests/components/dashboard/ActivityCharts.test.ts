import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityCharts } from '../../../src/components/dashboard/ActivityCharts';
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
        vi.clearAllMocks();
    });

    it('should render chart canvases and UI controls', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        expect(container.querySelector('#pieChart')).toBeDefined();
        expect(container.querySelector('#barChart')).toBeDefined();
        expect(container.querySelector('#toggle-chart-type')).toBeDefined();
        expect(container.querySelector('#toggle-group-by')).toBeDefined();
        expect((container.querySelector('#activity-charts-grid') as HTMLElement | null)?.dataset.timeRangeDays).toBe('7');
        expect(Chart).toHaveBeenCalledTimes(2);
    });

    it('should trigger param change on UI interaction', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
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
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        container.querySelector('#btn-chart-prev')?.dispatchEvent(new Event('click'));
        expect(onParamChange).toHaveBeenCalledWith({ timeRangeOffset: 1 });
    });

    it('should destroy chart instances on destroy', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
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
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 30, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();

        // 365 days
        vi.clearAllMocks();
        component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 365, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
    });

    it('should handle alternative grouping modes', () => {
        const component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'Japanese' } as unknown as ActivitySummary], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'line', metric: 'minutes' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
    });

    it('should trigger param change on metric toggle', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar', metric: 'minutes' },
            onParamChange
        );
        component.render();

        const toggleMetric = container.querySelector('#toggle-metric') as HTMLInputElement;
        toggleMetric.checked = true;
        toggleMetric.dispatchEvent(new Event('change'));

        expect(onParamChange).toHaveBeenCalledWith(expect.objectContaining({ metric: 'characters' }));
    });
});

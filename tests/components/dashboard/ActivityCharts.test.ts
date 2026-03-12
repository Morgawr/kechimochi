import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityCharts } from '../../../src/components/dashboard/ActivityCharts';
import Chart from 'chart.js/auto';

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
    }))
}));

describe('ActivityCharts', () => {
    let container: HTMLElement;
    let onParamChange: any;

    beforeEach(() => {
        container = document.createElement('div');
        onParamChange = vi.fn();
        vi.clearAllMocks();
    });

    it('should render chart canvases and UI controls', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
            onParamChange
        );
        component.render();

        expect(container.querySelector('#pieChart')).toBeDefined();
        expect(container.querySelector('#barChart')).toBeDefined();
        expect(container.querySelector('#select-chart-type')).toBeDefined();
        expect(Chart).toHaveBeenCalledTimes(2);
    });

    it('should trigger param change on UI interaction', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
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
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
            onParamChange
        );
        component.render();

        container.querySelector('#btn-chart-prev')?.dispatchEvent(new Event('click'));
        expect(onParamChange).toHaveBeenCalledWith({ timeRangeOffset: 1 });
    });

    it('should destroy chart instances on destroy', () => {
        const component = new ActivityCharts(
            container,
            { logs: [], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
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
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'J' } as any], timeRangeDays: 30, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();

        // 365 days
        vi.clearAllMocks();
        component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'J' } as any], timeRangeDays: 365, timeRangeOffset: 0, groupByMode: 'media_type', chartType: 'bar' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
    });

    it('should handle alternative grouping modes', () => {
        const component = new ActivityCharts(
            container,
            { logs: [{ date: '2024-01-01', duration_minutes: 10, title: 'T', media_id: 1, media_type: 'M', language: 'J' } as any], timeRangeDays: 7, timeRangeOffset: 0, groupByMode: 'log_name', chartType: 'line' },
            onParamChange
        );
        component.render();
        expect(Chart).toHaveBeenCalled();
    });
});

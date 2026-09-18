import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardControls } from '../../../src/dashboard/DashboardControls';
import type { DashboardCardId } from '../../../src/dashboard/dashboard_cards';

const CARDS: readonly { id: DashboardCardId; label: string }[] = [
    { id: 'heatmap', label: 'Tracking Heatmap' },
    { id: 'activity_visualization', label: 'Activity Visualization' },
];

describe('DashboardControls', () => {
    let container: HTMLElement;
    let onChartParamChange: ReturnType<typeof vi.fn>;
    let onToggleCard: ReturnType<typeof vi.fn>;
    let hiddenCards: Set<DashboardCardId>;

    function mountControls(state: Partial<ConstructorParameters<typeof DashboardControls>[1]> = {}): DashboardControls {
        const controls = new DashboardControls(
            container,
            {
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                ...state,
            },
            onChartParamChange,
            CARDS,
            () => hiddenCards,
            onToggleCard,
        );
        controls.render();
        return controls;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        onChartParamChange = vi.fn();
        onToggleCard = vi.fn();
        hiddenCards = new Set<DashboardCardId>();
    });

    afterEach(() => {
        container.remove();
    });

    it('should offer the four time range options', () => {
        mountControls();

        expect(Array.from(container.querySelectorAll<HTMLOptionElement>('#select-time-range option')).map(option => option.textContent)).toEqual([
            'Week',
            'Month',
            'Year',
            'All Time',
        ]);
    });

    it('should publish the active time range on its host', () => {
        mountControls({ timeRangeDays: 30, timeRangeOffset: 2 });

        expect(container.dataset.timeRangeDays).toBe('30');
        expect(container.dataset.timeRangeOffset).toBe('2');
    });

    it('should report a period change and reset the offset', () => {
        mountControls({ timeRangeOffset: 3 });

        const selectRange = container.querySelector('#select-time-range') as HTMLSelectElement;
        selectRange.value = '30';
        selectRange.dispatchEvent(new Event('change'));

        expect(onChartParamChange).toHaveBeenCalledWith({ timeRangeDays: 30, timeRangeOffset: 0 });
    });

    it('should step the offset back a period on the previous button', () => {
        mountControls();

        container.querySelector('#btn-chart-prev')?.dispatchEvent(new Event('click'));

        expect(onChartParamChange).toHaveBeenCalledWith({ timeRangeOffset: 1 });
    });

    it('should report a metric change on the metric toggle', () => {
        mountControls();

        const toggleMetric = container.querySelector('#toggle-metric') as HTMLInputElement;
        toggleMetric.checked = true;
        toggleMetric.dispatchEvent(new Event('change'));

        expect(onChartParamChange).toHaveBeenCalledWith({ metric: 'characters' });
    });

    it('should reflect a pushed state onto the controls', () => {
        const controls = mountControls();

        controls.setState({ timeRangeDays: 30, timeRangeOffset: 1, chartType: 'line', groupByMode: 'log_name', metric: 'characters' });

        expect((container.querySelector('#select-time-range') as HTMLSelectElement).value).toBe('30');
        expect((container.querySelector('#toggle-chart-type') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#toggle-group-by') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#toggle-metric') as HTMLInputElement).checked).toBe(true);
        expect((container.querySelector('#btn-chart-next') as HTMLButtonElement).disabled).toBe(false);
    });

    it('should disable both navigation buttons in All Time', () => {
        mountControls({ timeRangeDays: 0 });

        expect((container.querySelector('#btn-chart-prev') as HTMLButtonElement).disabled).toBe(true);
        expect((container.querySelector('#btn-chart-next') as HTMLButtonElement).disabled).toBe(true);
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeatmapView } from '../../../src/components/dashboard/HeatmapView';

describe('HeatmapView', () => {
    let container: HTMLElement;
    let onYearChange: (offset: number) => void;

    beforeEach(() => {
        container = document.createElement('div');
        onYearChange = vi.fn();
    });

    it('should render correct year label', () => {
        const component = new HeatmapView(container, { heatmapData: [], year: 2024 }, onYearChange);
        component.render();
        expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2024');
    });

    it('should handle year navigation', () => {
        const component = new HeatmapView(container, { heatmapData: [], year: 2024 }, onYearChange);
        component.render();
        
        container.querySelector('#btn-heatmap-prev')?.dispatchEvent(new Event('click'));
        expect(onYearChange).toHaveBeenCalledWith(-1);
        
        container.querySelector('#btn-heatmap-next')?.dispatchEvent(new Event('click'));
        expect(onYearChange).toHaveBeenCalledWith(1);
    });

    it('should render heatmap cells with correct titles', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 60, total_characters: 5000 }
        ];
        const component = new HeatmapView(container, { heatmapData, year: 2024 }, onYearChange);
        component.render();
        
        const cell = container.querySelector('.heatmap-cell[title*="2024-01-01"]');
        expect(cell).not.toBeNull();
        expect((cell as HTMLElement).title).toContain('60 mins');
        expect((cell as HTMLElement).title).toContain('5,000 chars');
    });

    it('should handle no data recorded', () => {
        const component = new HeatmapView(container, { heatmapData: [], year: Number.NaN }, onYearChange);
        component.render();
        expect(container.textContent).toContain('No data recorded yet');
    });
});

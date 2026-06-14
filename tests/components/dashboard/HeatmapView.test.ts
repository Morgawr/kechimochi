import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeatmapView } from '../../../src/dashboard';

describe('HeatmapView', () => {
    let container: HTMLElement;
    let onYearChange: (offset: number) => void;
    let onDateSelect: (dateStr: string) => void;

    beforeEach(() => {
        container = document.createElement('div');
        onYearChange = vi.fn();
        onDateSelect = vi.fn();
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

    it('should notify the selected date when a heatmap cell is clicked', () => {
        const heatmapData = [
            { date: '2024-01-02', total_minutes: 30, total_characters: 1200 }
        ];
        const component = new HeatmapView(container, { heatmapData, year: 2024 }, onYearChange, onDateSelect);
        component.render();

        const cell = container.querySelector('.heatmap-cell[data-date="2024-01-02"]') as HTMLElement;
        expect(cell).not.toBeNull();

        cell.click();

        expect(onDateSelect).toHaveBeenCalledWith('2024-01-02');
    });

    it('should handle no data recorded', () => {
        const component = new HeatmapView(container, { heatmapData: [], year: Number.NaN }, onYearChange);
        component.render();
        expect(container.textContent).toContain('No data recorded yet');
    });

    it('should color a character-only day (core bug fix)', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 0, total_characters: 5000 }
        ];
        const component = new HeatmapView(container, { heatmapData, year: 2024 }, onYearChange);
        component.render();

        const cell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        expect(cell).not.toBeNull();
        const styleAttribute = cell.getAttribute('style') ?? '';
        expect(styleAttribute).toContain('background-color: hsl(');
    });

    it('should still color a time-only day (regression)', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 60, total_characters: 0 }
        ];
        const component = new HeatmapView(container, { heatmapData, year: 2024 }, onYearChange);
        component.render();

        const cell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        expect(cell).not.toBeNull();
        const styleAttribute = cell.getAttribute('style') ?? '';
        expect(styleAttribute).toContain('background-color: hsl(');
    });

    it('should use the hotter of time and character ratios (no double-heat)', () => {
        const hslSaturationPattern = /background-color:\s*hsl\(\s*[\d.]+\s*,\s*([\d.]+)%/;

        // High-character + low-time day: character ratio dominates
        const highCharacterData = [
            { date: '2024-01-01', total_minutes: 10, total_characters: 30000 }
        ];
        const highCharacterComponent = new HeatmapView(
            container, { heatmapData: highCharacterData, year: 2024 }, onYearChange
        );
        highCharacterComponent.render();
        const highCharacterCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const highCharacterStyle = highCharacterCell.getAttribute('style') ?? '';
        const highCharacterSaturation = parseFloat(hslSaturationPattern.exec(highCharacterStyle)?.[1] ?? '0');

        // Same minutes, no characters: time ratio only
        container.innerHTML = '';
        const timeOnlyData = [
            { date: '2024-01-01', total_minutes: 10, total_characters: 0 }
        ];
        const timeOnlyComponent = new HeatmapView(
            container, { heatmapData: timeOnlyData, year: 2024 }, onYearChange
        );
        timeOnlyComponent.render();
        const timeOnlyCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const timeOnlyStyle = timeOnlyCell.getAttribute('style') ?? '';
        const timeOnlySaturation = parseFloat(hslSaturationPattern.exec(timeOnlyStyle)?.[1] ?? '0');

        // The high-character day should be hotter (higher saturation)
        expect(highCharacterSaturation).toBeGreaterThan(timeOnlySaturation);

        // A both-tracked day with the same characters should match the character-only day (no extra heat)
        container.innerHTML = '';
        const bothTrackedData = [
            { date: '2024-01-01', total_minutes: 10, total_characters: 30000 }
        ];
        const bothTrackedComponent = new HeatmapView(
            container, { heatmapData: bothTrackedData, year: 2024 }, onYearChange
        );
        bothTrackedComponent.render();
        const bothTrackedCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const bothTrackedStyle = bothTrackedCell.getAttribute('style') ?? '';
        const bothTrackedSaturation = parseFloat(hslSaturationPattern.exec(bothTrackedStyle)?.[1] ?? '0');

        expect(bothTrackedSaturation).toBe(highCharacterSaturation);
    });

    it('should produce higher saturation for more characters (monotonic ramp)', () => {
        const hslSaturationPattern = /background-color:\s*hsl\(\s*[\d.]+\s*,\s*([\d.]+)%/;

        const lowCharacterData = [
            { date: '2024-01-01', total_minutes: 0, total_characters: 5000 }
        ];
        const lowCharacterComponent = new HeatmapView(
            container, { heatmapData: lowCharacterData, year: 2024 }, onYearChange
        );
        lowCharacterComponent.render();
        const lowCharacterCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const lowCharacterSaturation = parseFloat(
            hslSaturationPattern.exec(lowCharacterCell.getAttribute('style') ?? '')?.[1] ?? '0'
        );

        container.innerHTML = '';
        const highCharacterData = [
            { date: '2024-01-01', total_minutes: 0, total_characters: 60000 }
        ];
        const highCharacterComponent = new HeatmapView(
            container, { heatmapData: highCharacterData, year: 2024 }, onYearChange
        );
        highCharacterComponent.render();
        const highCharacterCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const highCharacterSaturation = parseFloat(
            hslSaturationPattern.exec(highCharacterCell.getAttribute('style') ?? '')?.[1] ?? '0'
        );

        expect(highCharacterSaturation).toBeGreaterThan(lowCharacterSaturation);
    });
});

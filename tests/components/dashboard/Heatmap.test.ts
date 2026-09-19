import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Heatmap, type HeatmapHost } from '../../../src/dashboard/cards/Heatmap';
import { getDashboardHeatmapYear } from '../../../src/api';
import { applyThemePalette } from '../../helpers/theme_palette';

vi.mock('../../../src/api', () => ({
    getDashboardHeatmapYear: vi.fn(),
}));

describe('Heatmap', () => {
    let container: HTMLElement;
    let host: HeatmapHost;
    let onDateSelect: (dateStr: string) => void;
    let requestSequence: number;

    beforeEach(() => {
        applyThemePalette();
        vi.clearAllMocks();
        container = document.createElement('div');
        requestSequence = 0;
        host = {
            nextRequestId: vi.fn(() => ++requestSequence),
            currentGeneration: vi.fn(() => 1),
            isCurrent: vi.fn((generation: number) => generation === 1),
        };
        onDateSelect = vi.fn();
        vi.mocked(getDashboardHeatmapYear).mockImplementation(async request => ({
            request_id: request.request_id,
            year: request.year,
            days: [],
        }));
    });

    it('should render correct year label', () => {
        const component = new Heatmap(container, { heatmapData: [], year: 2024 }, host);
        component.render();
        expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2024');
    });

    it('should fetch the neighbouring year and relabel on year navigation', async () => {
        const component = new Heatmap(container, { heatmapData: [], year: 2024 }, host);
        component.render();

        container.querySelector('#btn-heatmap-prev')?.dispatchEvent(new Event('click'));
        expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2023 }));
        await vi.waitFor(() => expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2023'));

        container.querySelector('#btn-heatmap-next')?.dispatchEvent(new Event('click'));
        expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2024 }));
        await vi.waitFor(() => expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2024'));
    });

    it('should ignore a year response that arrives after a newer one', async () => {
        const component = new Heatmap(container, { heatmapData: [], year: 2024 }, host);
        component.render();

        let resolveOlder!: (value: Awaited<ReturnType<typeof getDashboardHeatmapYear>>) => void;
        const older = new Promise<Awaited<ReturnType<typeof getDashboardHeatmapYear>>>(resolve => { resolveOlder = resolve; });
        vi.mocked(getDashboardHeatmapYear).mockReturnValueOnce(older);

        container.querySelector('#btn-heatmap-prev')?.dispatchEvent(new Event('click'));
        const olderRequest = vi.mocked(getDashboardHeatmapYear).mock.calls[0][0];
        container.querySelector('#btn-heatmap-prev')?.dispatchEvent(new Event('click'));
        await vi.waitFor(() => expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2022'));

        resolveOlder({
            request_id: olderRequest.request_id,
            year: olderRequest.year,
            days: [{ date: '2023-01-01', total_minutes: 1, total_characters: 0 }],
        });
        await older;
        await Promise.resolve();

        expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2022');
        expect(container.querySelector('.heatmap-cell[title^="2023-01-01"]')).toBeNull();
    });

    it('should drop a year response from a superseded dashboard generation', async () => {
        const component = new Heatmap(container, { heatmapData: [], year: 2024 }, host);
        component.render();

        vi.mocked(host.isCurrent).mockReturnValue(false);
        container.querySelector('#btn-heatmap-prev')?.dispatchEvent(new Event('click'));
        await Promise.resolve();
        await Promise.resolve();

        expect(container.querySelector('#heatmap-year-label')?.textContent).toBe('2023');
        expect(container.querySelectorAll('.heatmap-cell[title]')).toHaveLength(365);
    });

    it('should render heatmap cells with correct titles', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 60, total_characters: 5000 }
        ];
        const component = new Heatmap(container, { heatmapData, year: 2024 }, host);
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
        const component = new Heatmap(container, { heatmapData, year: 2024 }, host, onDateSelect);
        component.render();

        const cell = container.querySelector('.heatmap-cell[data-date="2024-01-02"]') as HTMLElement;
        expect(cell).not.toBeNull();

        cell.click();

        expect(onDateSelect).toHaveBeenCalledWith('2024-01-02');
    });

    it('should handle no data recorded', () => {
        const component = new Heatmap(container, { heatmapData: [], year: Number.NaN }, host);
        component.render();
        expect(container.textContent).toContain('No data recorded yet');
    });

    it('should color a character-only day', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 0, total_characters: 5000 }
        ];
        const component = new Heatmap(container, { heatmapData, year: 2024 }, host);
        component.render();

        const cell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        expect(cell).not.toBeNull();
        const styleAttribute = cell.getAttribute('style') ?? '';
        expect(styleAttribute).toContain('background-color: hsl(');
    });

    it('should color a time-only day', () => {
        const heatmapData = [
            { date: '2024-01-01', total_minutes: 60, total_characters: 0 }
        ];
        const component = new Heatmap(container, { heatmapData, year: 2024 }, host);
        component.render();

        const cell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        expect(cell).not.toBeNull();
        const styleAttribute = cell.getAttribute('style') ?? '';
        expect(styleAttribute).toContain('background-color: hsl(');
    });

    it('should use the hotter of time and character ratios', () => {
        const hslSaturationPattern = /background-color:\s*hsl\(\s*[\d.]+\s*,\s*([\d.]+)%/;

        // High-character + low-time day: character ratio dominates
        const highCharacterData = [
            { date: '2024-01-01', total_minutes: 10, total_characters: 30000 }
        ];
        const highCharacterComponent = new Heatmap(
            container, { heatmapData: highCharacterData, year: 2024 }, host
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
        const timeOnlyComponent = new Heatmap(
            container, { heatmapData: timeOnlyData, year: 2024 }, host
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
        const bothTrackedComponent = new Heatmap(
            container, { heatmapData: bothTrackedData, year: 2024 }, host
        );
        bothTrackedComponent.render();
        const bothTrackedCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const bothTrackedStyle = bothTrackedCell.getAttribute('style') ?? '';
        const bothTrackedSaturation = parseFloat(hslSaturationPattern.exec(bothTrackedStyle)?.[1] ?? '0');

        expect(bothTrackedSaturation).toBe(highCharacterSaturation);
    });

    it('should produce higher saturation for more characters', () => {
        const hslSaturationPattern = /background-color:\s*hsl\(\s*[\d.]+\s*,\s*([\d.]+)%/;

        const lowCharacterData = [
            { date: '2024-01-01', total_minutes: 0, total_characters: 5000 }
        ];
        const lowCharacterComponent = new Heatmap(
            container, { heatmapData: lowCharacterData, year: 2024 }, host
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
        const highCharacterComponent = new Heatmap(
            container, { heatmapData: highCharacterData, year: 2024 }, host
        );
        highCharacterComponent.render();
        const highCharacterCell = container.querySelector('.heatmap-cell[title*="2024-01-01"]') as HTMLElement;
        const highCharacterSaturation = parseFloat(
            hslSaturationPattern.exec(highCharacterCell.getAttribute('style') ?? '')?.[1] ?? '0'
        );

        expect(highCharacterSaturation).toBeGreaterThan(lowCharacterSaturation);
    });
});

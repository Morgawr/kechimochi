import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Heatmap, type HeatmapHost } from '../../../src/dashboard/cards/heatmap/Heatmap';
import type { HeatmapSelection } from '../../../src/dashboard/cards/heatmap/heatmap_layout';
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

    describe('selected period', () => {
        const MONDAY = 1;
        const SUNDAY = 0;
        const marchWeek: HeatmapSelection = { period: 'week', start: '2024-03-04', end: '2024-03-10', weekStartDay: MONDAY };
        const march: HeatmapSelection = { period: 'month', start: '2024-03-01', end: '2024-03-31', weekStartDay: MONDAY };

        function renderWith(selection: HeatmapSelection | null, heatmapData: { date: string; total_minutes: number; total_characters: number }[] = []): Heatmap {
            const component = new Heatmap(container, { heatmapData, year: 2024, selection }, host, onDateSelect);
            component.render();
            return component;
        }

        const gridCell = (date: string) => container.querySelector<HTMLElement>(`.heatmap-cell[data-date="${date}"]`)!;
        const calendarDay = (date: string) => container.querySelector<HTMLElement>(`.heatmap-calendar-day[data-date="${date}"]`)!;
        const yearLabel = () => container.querySelector('#heatmap-year-label')?.textContent;

        function dispatchPointer(target: Element, type: string, pointerType: string): void {
            const event = new MouseEvent(type, { bubbles: true });
            Object.defineProperty(event, 'pointerType', { value: pointerType });
            target.dispatchEvent(event);
        }

        it('should label each cell with the period a click selects', () => {
            renderWith(march);

            expect(gridCell('2024-06-10').getAttribute('aria-label')).toBe('Show June 2024');
        });

        it('should make no day interactive in All Time', () => {
            renderWith({ period: 'all-time', start: '2020-01-01', end: '2024-12-31', weekStartDay: MONDAY });
            const cell = gridCell('2024-03-05');

            expect(cell.getAttribute('role')).toBeNull();
            expect(cell.getAttribute('tabindex')).toBeNull();
            cell.click();
            calendarDay('2024-01-15').click();
            expect(onDateSelect).not.toHaveBeenCalled();
        });

        it('should outline only the outer walls of the selected week on the grid', () => {
            renderWith(marchWeek);

            expect(gridCell('2024-03-04').dataset.selectionEdges).toBe('top right left');
            expect(gridCell('2024-03-06').dataset.selectionEdges).toBe('right left');
            expect(gridCell('2024-03-10').dataset.selectionEdges).toBe('right bottom left');
            expect(gridCell('2024-03-11').dataset.selectionEdges).toBeUndefined();
            expect(gridCell('2024-03-06').classList.contains('is-in-selected-period')).toBe(true);
        });

        it('should label the months above the grid and highlight only the selected one', () => {
            renderWith(march);
            const labels = [...container.querySelectorAll<HTMLElement>('[data-month-index]')];

            expect(labels.map(label => label.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
            expect(labels.filter(label => label.hasAttribute('data-selected')).map(label => label.textContent)).toEqual(['Mar']);
            expect(labels.map(label => label.dataset.columnCount)).toEqual(['4', '5', '4', '4', '5', '4', '4', '5', '4', '5', '4', '5']);
        });

        it('should give every day a moat layer but not the padding slots', () => {
            renderWith(marchWeek);

            expect(gridCell('2024-03-04').querySelector('.heatmap-cell-moat')).not.toBeNull();
            const calendarDays = [...container.querySelectorAll('.heatmap-calendar-day')];
            expect(calendarDays.length).toBeGreaterThan(0);
            expect(calendarDays.every(day => day.querySelector('.heatmap-cell-moat') !== null)).toBe(true);
            expect(container.querySelector('.heatmap-cell-padding .heatmap-cell-moat')).toBeNull();
        });

        it('should not outline a selected year', () => {
            renderWith({ period: 'year', start: '2024-01-01', end: '2024-12-31', weekStartDay: MONDAY });

            expect(container.querySelector('[data-selection-edges]')).toBeNull();
            expect(gridCell('2024-03-06').classList.contains('is-in-selected-period')).toBe(true);
        });

        it('should outline the selected month on the calendar and leave its neighbouring days outside', () => {
            const component = renderWith(null);
            component.setSelection(march);

            expect(calendarDay('2024-02-26').classList.contains('heatmap-calendar-day-outside')).toBe(true);
            expect(calendarDay('2024-02-26').dataset.selectionEdges).toBeUndefined();
            expect(calendarDay('2024-03-01').dataset.selectionEdges).toBe('top left');
            expect(calendarDay('2024-03-31').dataset.selectionEdges).toBe('right bottom');
        });

        it('should order grid rows and calendar columns by the week start day', () => {
            renderWith({ ...marchWeek, weekStartDay: SUNDAY });
            const firstColumn = container.querySelectorAll('.heatmap-col')[0].children;

            expect((firstColumn[0] as HTMLElement).dataset.date).toBeUndefined();
            expect((firstColumn[1] as HTMLElement).dataset.date).toBe('2024-01-01');
            expect(container.querySelector('.heatmap-calendar-weekday')?.textContent).toBe('Su');
        });

        it('should preview the period under a mouse and clear it when the mouse leaves', () => {
            renderWith(marchWeek);
            const heatmap = container.querySelector('.heatmap')!;

            dispatchPointer(gridCell('2024-03-13'), 'pointerover', 'mouse');
            expect(gridCell('2024-03-11').dataset.previewEdges).toBe('top right left');
            expect(gridCell('2024-03-17').dataset.previewEdges).toBe('right bottom left');

            dispatchPointer(heatmap, 'pointerleave', 'mouse');
            expect(container.querySelector('[data-preview-edges]')).toBeNull();
        });

        it('should not preview the already selected period or a touch', () => {
            renderWith(marchWeek);

            dispatchPointer(gridCell('2024-03-05'), 'pointerover', 'mouse');
            dispatchPointer(gridCell('2024-03-13'), 'pointerover', 'touch');

            expect(container.querySelector('[data-preview-edges]')).toBeNull();
        });

        it('should switch the calendar month from the strip without selecting a period', () => {
            renderWith(marchWeek);

            container.querySelector<HTMLElement>('[data-heatmap-month="2024-05"]')!.click();

            expect(calendarDay('2024-05-15').classList.contains('heatmap-calendar-day-outside')).toBe(false);
            expect(container.querySelector('[data-heatmap-month="2024-05"]')?.getAttribute('aria-pressed')).toBe('true');
            expect(onDateSelect).not.toHaveBeenCalled();
        });

        it('should select a period from a calendar day', () => {
            renderWith(marchWeek);
            container.querySelector<HTMLElement>('[data-heatmap-month="2024-05"]')!.click();

            calendarDay('2024-05-15').click();

            expect(onDateSelect).toHaveBeenCalledWith('2024-05-15');
        });

        it('should load the next year when stepping past December', async () => {
            renderWith(marchWeek);
            container.querySelector<HTMLElement>('[data-heatmap-month="2024-12"]')!.click();

            container.querySelector<HTMLElement>('[data-heatmap-month-step="1"]')!.click();

            expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2025 }));
            await vi.waitFor(() => expect(yearLabel()).toBe('2025'));
            expect(calendarDay('2025-01-15').classList.contains('heatmap-calendar-day-outside')).toBe(false);
        });

        it('should follow a selection outside the displayed year', async () => {
            const component = renderWith(marchWeek);

            component.setSelection({ period: 'month', start: '2022-05-01', end: '2022-05-31', weekStartDay: MONDAY });

            expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2022 }));
            await vi.waitFor(() => expect(yearLabel()).toBe('2022'));
            expect(component.displayedYear).toBe(2022);
            expect(calendarDay('2022-05-15').classList.contains('heatmap-calendar-day-outside')).toBe(false);
        });

        it('should stay put when the new selection is already on screen', () => {
            const component = renderWith(marchWeek);

            component.setSelection({ ...marchWeek, start: '2024-03-11', end: '2024-03-17' });

            expect(getDashboardHeatmapYear).not.toHaveBeenCalled();
            expect(gridCell('2024-03-11').dataset.selectionEdges).toBe('top right left');
        });

        it('should color days of the displayed month but not neighbouring days', () => {
            const component = renderWith(null, [
                { date: '2024-02-29', total_minutes: 60, total_characters: 0 },
                { date: '2024-03-05', total_minutes: 60, total_characters: 0 },
            ]);
            component.setSelection(march);

            expect(calendarDay('2024-03-05').getAttribute('style')).toContain('background-color: hsl(');
            expect(calendarDay('2024-02-29').getAttribute('style')).toBeNull();
        });

        it('should color strip months by their activity', () => {
            renderWith(marchWeek, [{ date: '2024-03-05', total_minutes: 60, total_characters: 0 }]);

            expect(container.querySelector('[data-heatmap-month="2024-03"]')?.getAttribute('style')).toContain('background-color: hsl(');
            expect(container.querySelector('[data-heatmap-month="2024-04"]')?.getAttribute('style')).toBeNull();
        });

        it('should keep the browsed year when a reload delivers the year it started with', async () => {
            const component = renderWith(marchWeek);
            container.querySelector<HTMLElement>('[data-heatmap-month="2024-12"]')!.click();
            container.querySelector<HTMLElement>('[data-heatmap-month-step="1"]')!.click();
            await vi.waitFor(() => expect(yearLabel()).toBe('2025'));
            vi.mocked(getDashboardHeatmapYear).mockClear();

            component.applySnapshot({ year: 2024, heatmapData: [] }, marchWeek);

            expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2025 }));
            await vi.waitFor(() => expect(yearLabel()).toBe('2025'));
            expect(calendarDay('2025-01-15').classList.contains('heatmap-calendar-day-outside')).toBe(false);
        });

        it('should use a reload snapshot for the displayed year without fetching', () => {
            const component = renderWith(marchWeek);

            component.applySnapshot({ year: 2024, heatmapData: [{ date: '2024-03-05', total_minutes: 60, total_characters: 0 }] }, marchWeek);

            expect(getDashboardHeatmapYear).not.toHaveBeenCalled();
            expect(gridCell('2024-03-05').getAttribute('style')).toContain('background-color: hsl(');
        });

        it('should follow a period that a reload changed', async () => {
            const component = renderWith(marchWeek);

            component.applySnapshot({ year: 2024, heatmapData: [] }, { period: 'month', start: '2022-05-01', end: '2022-05-31', weekStartDay: MONDAY });

            expect(getDashboardHeatmapYear).toHaveBeenCalledWith(expect.objectContaining({ year: 2022 }));
            await vi.waitFor(() => expect(yearLabel()).toBe('2022'));
        });

        it('should keep keyboard focus on the activated day after the selection re-renders', () => {
            document.body.appendChild(container);
            const component = renderWith(marchWeek);
            gridCell('2024-03-13').focus();

            component.setSelection({ ...marchWeek, start: '2024-03-11', end: '2024-03-17' });

            expect(document.activeElement).toBe(gridCell('2024-03-13'));
            container.remove();
        });
    });
});

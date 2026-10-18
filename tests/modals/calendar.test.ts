import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCalendar } from '../../src/calendar';

describe('modals/calendar.ts', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    const navigationButton = (navigation: 'previous-jump' | 'previous' | 'next' | 'next-jump') =>
        container.querySelector<HTMLButtonElement>(`[data-calendar-nav="${navigation}"]`)!;

    const viewedPeriod = () => container.querySelector('[role="grid"]')!.getAttribute('aria-label');

    const scopeTabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    it('should render the calendar for a given month', () => {
        const onSelect = vi.fn();
        buildCalendar(container, '2024-01-15', onSelect);

        expect(container.textContent).toContain('2024 / 1');
        const days = container.querySelectorAll('.cal-day:not(.cal-day-outside)');
        expect(days).toHaveLength(31);

        const day15 = Array.from(days).find(d => d.textContent === '15') as HTMLElement;
        expect(day15).toBeDefined();
    });

    it('should render six week rows for every month', () => {
        const onSelect = vi.fn();
        buildCalendar(container, '2024-01-15', onSelect);

        for (let monthOffset = 0; monthOffset < 14; monthOffset++) {
            expect(container.querySelectorAll('.calendar-grid tbody tr')).toHaveLength(6);
            expect(container.querySelectorAll('.calendar-grid tbody td')).toHaveLength(42);
            navigationButton('next').click();
        }
        expect(viewedPeriod()).toBe('March 2025');
    });

    it('should render adjacent-month days as muted and selectable', () => {
        const onSelect = vi.fn();
        buildCalendar(container, '2024-01-15', onSelect);

        const outsideDays = container.querySelectorAll<HTMLButtonElement>('.cal-day-outside');
        expect(outsideDays).toHaveLength(11);

        const february1 = container.querySelector<HTMLButtonElement>('.cal-day-outside[data-date="2024-02-01"]')!;
        expect(february1).not.toBeNull();
        february1.click();

        expect(onSelect).toHaveBeenCalledWith('2024-02-01');
        expect(container.textContent).toContain('2024 / 2');
    });

    it('should navigate months', () => {
        const onSelect = vi.fn();
        buildCalendar(container, '2024-01-15', onSelect);

        const prevBtn = container.querySelector('[data-calendar-nav="previous"]') as HTMLElement;
        expect(prevBtn).not.toBeNull();
        prevBtn.click();
        expect(container.textContent).toContain('2023 / 12');

        const nextBtn = container.querySelector('[data-calendar-nav="next"]') as HTMLElement;
        expect(nextBtn).not.toBeNull();
        nextBtn.click();
        expect(container.textContent).toContain('2024 / 1');
    });

    it('should trigger onSelect when a day is clicked', () => {
        const onSelect = vi.fn();
        buildCalendar(container, '2024-01-15', onSelect);

        const day20 = Array.from(container.querySelectorAll('.cal-day:not(.cal-day-outside)')).find(d => d.textContent === '20') as HTMLElement;
        expect(day20).toBeDefined();
        day20.click();

        expect(onSelect).toHaveBeenCalledWith('2024-01-20');
    });

    describe('jump navigation', () => {
        it('should jump a whole year in the day scope', () => {
            buildCalendar(container, '2024-01-15', vi.fn());

            navigationButton('previous-jump').click();
            expect(viewedPeriod()).toBe('January 2023');

            navigationButton('next-jump').click();
            navigationButton('next-jump').click();
            expect(viewedPeriod()).toBe('January 2025');
        });

        it('should jump a whole year block in the month scope', () => {
            buildCalendar(container, '2024-03', vi.fn(), { scope: 'month' });

            navigationButton('previous-jump').click();
            expect(viewedPeriod()).toBe('2012');

            navigationButton('next-jump').click();
            navigationButton('next-jump').click();
            expect(viewedPeriod()).toBe('2036');
        });

        it('should disable the jump buttons in the year scope', () => {
            buildCalendar(container, '2024', vi.fn(), { scope: 'year' });

            expect(navigationButton('previous-jump').disabled).toBe(true);
            expect(navigationButton('next-jump').disabled).toBe(true);
            expect(navigationButton('previous').disabled).toBe(false);
            expect(navigationButton('next').disabled).toBe(false);
        });

        it('should disable a jump that would leave the supported year range', () => {
            buildCalendar(container, '0001-06-15', vi.fn());

            expect(navigationButton('previous-jump').disabled).toBe(true);
            expect(navigationButton('previous').disabled).toBe(false);
        });

        it('should keep the focus on the jump button after jumping', () => {
            buildCalendar(container, '2024-01-15', vi.fn());

            navigationButton('next-jump').click();

            expect(document.activeElement).toBe(navigationButton('next-jump'));
        });

        it('should name the target period in the tooltip and accessible name', () => {
            buildCalendar(container, '2024-01-15', vi.fn());

            expect(navigationButton('previous').title).toBe('Go to December 2023');
            expect(navigationButton('previous').getAttribute('aria-label')).toBe('Go to December 2023');
            expect(navigationButton('previous-jump').title).toBe('Go to January 2023');
            expect(navigationButton('next-jump').title).toBe('Go to January 2025');
        });
    });

    describe('scope tabs', () => {
        it('should render no tabs for a single scope', () => {
            buildCalendar(container, '2024-01-15', vi.fn());

            expect(scopeTabs()).toHaveLength(0);
        });

        it('should render one tab per allowed scope and mark the active one', () => {
            buildCalendar(container, '2024-03', vi.fn(), { scope: 'month', scopes: ['day', 'month', 'year'] });

            expect(scopeTabs().map(tab => tab.dataset.dateScope)).toEqual(['day', 'month', 'year']);
            expect(scopeTabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
            expect(scopeTabs().map(tab => tab.title)).toEqual(['Pick a day', 'Pick a whole month', 'Pick a whole year']);
        });

        it('should report a click on an inactive tab and ignore the active one', () => {
            const onScopeSelect = vi.fn();
            buildCalendar(container, '2024-01-15', vi.fn(), { scopes: ['day', 'month', 'year'], onScopeSelect });

            scopeTabs()[0].click();
            expect(onScopeSelect).not.toHaveBeenCalled();

            scopeTabs()[2].click();
            expect(onScopeSelect).toHaveBeenCalledWith('year');
        });

        it('should focus the active tab on request', () => {
            const picker = buildCalendar(container, '2024', vi.fn(), { scope: 'year', scopes: ['day', 'month', 'year'] });

            picker.focusScopeTab();

            expect(document.activeElement).toBe(scopeTabs()[2]);
        });
    });

    describe('coarse grids', () => {
        const cellsPerRow = () => Array.from(container.querySelectorAll('[role="grid"] tbody tr'))
            .map(row => row.querySelectorAll('button[data-calendar-cell]').length);

        it('should lay out months in four rows of three', () => {
            buildCalendar(container, '2024-03', vi.fn(), { scope: 'month' });

            expect(cellsPerRow()).toEqual([3, 3, 3, 3]);
        });

        it('should lay out a year block in four rows of three', () => {
            buildCalendar(container, '2024', vi.fn(), { scope: 'year' });

            expect(cellsPerRow()).toEqual([3, 3, 3, 3]);
            expect(viewedPeriod()).toBe('2016 – 2027');
        });
    });
});

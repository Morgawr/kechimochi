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
        const nextButton = container.querySelector('.cal-nav-next') as HTMLElement;

        for (let monthOffset = 0; monthOffset < 14; monthOffset++) {
            expect(container.querySelectorAll('.calendar-grid tbody tr')).toHaveLength(6);
            expect(container.querySelectorAll('.calendar-grid tbody td')).toHaveLength(42);
            nextButton.click();
        }
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

        const prevBtn = container.querySelector('.cal-nav-prev') as HTMLElement;
        expect(prevBtn).not.toBeNull();
        prevBtn.click();
        expect(container.textContent).toContain('2023 / 12');

        const nextBtn = container.querySelector('.cal-nav-next') as HTMLElement;
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
});

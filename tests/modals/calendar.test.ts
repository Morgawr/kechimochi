import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCalendar } from '../../src/calendar';

describe('modals/calendar.ts', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'test-cal-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('should render the calendar for a given month', () => {
        const onSelect = vi.fn();
        buildCalendar('test-cal-container', '2024-01-15', onSelect);

        expect(container.textContent).toContain('2024 / 1');
        const days = container.querySelectorAll('.cal-day');
        expect(days.length).toBe(31);
        
        const day15 = Array.from(days).find(d => d.textContent === '15') as HTMLElement;
        expect(day15).toBeDefined();
    });

    it('should navigate months', () => {
        const onSelect = vi.fn();
        buildCalendar('test-cal-container', '2024-01-15', onSelect);

        const prevBtn = container.querySelector('#c-p-test-cal-container') as HTMLElement;
        expect(prevBtn).not.toBeNull();
        prevBtn.click();
        expect(container.textContent).toContain('2023 / 12');

        const nextBtn = container.querySelector('#c-n-test-cal-container') as HTMLElement;
        expect(nextBtn).not.toBeNull();
        nextBtn.click();
        expect(container.textContent).toContain('2024 / 1');
    });

    it('should trigger onSelect when a day is clicked', () => {
        const onSelect = vi.fn();
        buildCalendar('test-cal-container', '2024-01-15', onSelect);

        const day20 = Array.from(container.querySelectorAll('.cal-day')).find(d => d.textContent === '20') as HTMLElement;
        expect(day20).toBeDefined();
        day20.click();

        expect(onSelect).toHaveBeenCalledWith('2024-01-20');
    });
});

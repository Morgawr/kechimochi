import { describe, it, expect, beforeEach } from 'vitest';
import { WeekdayRhythm } from '../../../src/dashboard/cards/WeekdayRhythm';

function textContent(container: HTMLElement): string {
    return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('WeekdayRhythm', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
    });

    it('renders a six-month weekday radar in configured week order with accessible statistics', () => {
        const component = new WeekdayRhythm(container, {
            weekdayDistribution: {
                start_date: '2025-12-10',
                end_date: '2026-06-10',
                days: Array.from({ length: 7 }, (_, weekday) => ({
                    weekday,
                    average_minutes: (weekday + 1) * 30,
                    median_minutes: weekday * 20,
                    average_characters: (weekday + 1) * 5_000,
                    median_characters: weekday * 3_000,
                    sample_days: 26,
                })),
            },
            weekStartDay: 1,
            metric: 'minutes',
        });

        component.render();

        const radar = container.querySelector<SVGElement>('.dashboard-weekday-radar');
        const labels = Array.from(container.querySelectorAll('.dashboard-weekday-label')).map(label => label.textContent);
        const mondayPoint = container.querySelector<SVGCircleElement>('[data-weekday="1"]');

        expect(container.querySelector('h3')?.textContent).toBe('Weekday Rhythm');
        expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(radar?.getAttribute('aria-label')).toContain('Mon: average 1h');
        expect(radar?.querySelectorAll('.dashboard-weekday-grid polygon')).toHaveLength(4);
        expect(radar?.dataset.metric).toBe('minutes');
        expect(Array.from(radar?.querySelectorAll('.dashboard-weekday-scale text') ?? []).at(-1)?.textContent).toBe('4h');
        expect(mondayPoint?.dataset.average).toBe('60');
        expect(mondayPoint?.querySelector('title')?.textContent).toBe('Mon: avg 1h, median 20m');
        expect(container.textContent).not.toContain('Min–max');

        component.setState({ metric: 'characters' });
        const characterRadar = container.querySelector<SVGElement>('.dashboard-weekday-radar');
        const characterMonday = container.querySelector<SVGCircleElement>('[data-weekday="1"]');
        expect(container.querySelector<HTMLElement>('.dashboard-weekday-card')?.dataset.metric).toBe('characters');
        expect(characterRadar?.dataset.metric).toBe('characters');
        expect(Array.from(characterRadar?.querySelectorAll('.dashboard-weekday-scale text') ?? []).at(-1)?.textContent).toBe('40,000');
        expect(characterMonday?.dataset.average).toBe('10000');
        expect(characterMonday?.querySelector('title')?.textContent).toBe('Mon: avg 10,000 characters, median 3,000 characters');
    });

    it('renders a compact empty state when the weekday window has no timed activity', () => {
        const component = new WeekdayRhythm(container, {
            weekdayDistribution: {
                start_date: '2025-12-10',
                end_date: '2026-06-10',
                days: [],
            },
            weekStartDay: 0,
        });

        component.render();

        expect(container.querySelector('.dashboard-weekday-card h3')?.textContent).toBe('Weekday Rhythm');
        expect(textContent(container)).toContain('No timed activity in the last 6 months.');
        expect(container.querySelector('.dashboard-weekday-radar')).toBeNull();
    });

    it('renders a card even before the weekday distribution has loaded', () => {
        const component = new WeekdayRhythm(container, { weekStartDay: 1 });

        component.render();

        expect(container.querySelector('.dashboard-weekday-card')).not.toBeNull();
        expect(container.querySelector('.dashboard-weekday-radar')).toBeNull();
    });
});

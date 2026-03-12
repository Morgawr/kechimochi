import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCard } from '../../../src/components/dashboard/StatsCard';
import { ActivitySummary } from '../../../src/api';

describe('StatsCard', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
    });

    it('should render empty stats correctly', () => {
        const component = new StatsCard(container, { logs: [], mediaList: [] });
        component.render();
        
        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('0');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('0');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('0');
    });

    it('should calculate and render streaks and averages correctly', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', media_type: 'Reading', duration_minutes: 60, date: '2024-01-01', language: 'Japanese' },
            { id: 2, media_id: 1, title: 'T1', media_type: 'Reading', duration_minutes: 60, date: '2024-01-02', language: 'Japanese' },
            { id: 3, media_id: 2, title: 'T2', media_type: 'Watching', duration_minutes: 30, date: '2024-01-04', language: 'Japanese' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [{} as any, {} as any] });
        component.render();

        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('3');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('2');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('2'); // Jan 1-2
        expect(container.textContent).toContain('Reading');
        expect(container.textContent).toContain('2h'); // 120m
        expect(container.textContent).toContain('Watching');
        expect(container.textContent).toContain('30m');
    });

    it('should update current streak correctly', () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T', media_type: 'Reading', duration_minutes: 10, date: formatDate(yesterday), language: 'Japanese' },
            { id: 2, media_id: 1, title: 'T', media_type: 'Reading', duration_minutes: 10, date: formatDate(today), language: 'Japanese' },
        ];

        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();
        
        expect(container.querySelector('#stat-current-streak')?.textContent).toBe('2');
    });
});

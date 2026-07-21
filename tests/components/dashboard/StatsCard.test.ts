import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCard } from '../../../src/dashboard/StatsCard';
import { ActivitySummary, Media } from '../../../src/api';

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

    it('renders the backend aggregate without needing lifetime log or media arrays', () => {
        const component = new StatsCard(container, {
            summary: {
                total_logs: 2500,
                total_media: 300,
                logged_days: 500,
                first_activity_date: '2020-01-01',
                last_activity_date: '2026-07-21',
                max_streak: 42,
                current_streak: 7,
                total_minutes: 6000,
                total_characters: 1_500_000,
                activity_totals: [{ key: 'activity:Reading', label: 'Reading', total_minutes: 6000, total_characters: 1_500_000 }],
            },
        });
        component.render();

        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('2500');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('300');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('42');
        expect(container.textContent).toContain('Reading');
        expect(container.textContent).toContain('1,500,000');
    });

    it('should calculate and render streaks and averages correctly', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-01-01', language: 'Japanese' },
            { id: 2, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-01-02', language: 'Japanese' },
            { id: 3, media_id: 2, title: 'T2', activity_type: 'Watching', duration_minutes: 30, characters: 0, date: '2024-01-04', language: 'Japanese' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [{} as unknown as Media, {} as unknown as Media] });
        component.render();

        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('3');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('2');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('2'); // Jan 1-2
        expect(container.textContent).toContain('Reading');
        expect(container.textContent).toContain('2h'); // 120m
        expect(container.textContent).toContain('Watching');
        expect(container.textContent).toContain('30m');
    });

    it('should calculate and render character stats correctly', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 1000, date: '2024-03-01', language: 'Japanese' },
            { id: 2, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 2000, date: '2024-03-02', language: 'Japanese' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();

        expect(container.querySelector('#stat-total-chars')?.textContent).toBe('3,000');
        expect(container.querySelector('#stat-avg-chars')?.textContent).toContain('1,500 chars');
        expect(container.textContent).toContain('Total Characters:');
        expect(container.textContent).toContain('3,000');
    });

    it('should hide character stats if total characters is 0', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-03-01', language: 'Japanese' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();

        expect(container.querySelector('#stat-total-chars')).toBeNull();
        expect(container.querySelector('#stat-avg-chars')).toBeNull();
        expect(container.textContent).not.toContain('Total Characters:');
    });

    it('should update current streak correctly', () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: formatDate(yesterday), language: 'Japanese' },
            { id: 2, media_id: 1, title: 'T', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: formatDate(today), language: 'Japanese' },
        ];

        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();
        
        expect(container.querySelector('#stat-current-streak')?.textContent).toBe('2');
    });
});

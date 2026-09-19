import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Categories } from '../../../src/dashboard/cards/Categories';
import { computeRangeContext } from '../../../src/dashboard/range_context';
import { ActivitySummary, Media } from '../../../src/api';

function textContent(container: HTMLElement): string {
    return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function makeMedia(overrides: Partial<Media> & { id: number; title: string }): Media {
    return {
        id: overrides.id,
        title: overrides.title,
        default_activity_type: overrides.default_activity_type ?? 'Reading',
        status: overrides.status ?? 'In Progress',
        language: overrides.language ?? 'Japanese',
        description: overrides.description ?? '',
        cover_image: overrides.cover_image ?? '',
        extra_data: overrides.extra_data ?? '',
        content_type: overrides.content_type ?? '',
        tracking_status: overrides.tracking_status ?? 'active',
        uid: overrides.uid,
    };
}

function makeLog(overrides: Partial<ActivitySummary> & { id: number; media_id: number; date: string }): ActivitySummary {
    return {
        id: overrides.id,
        media_id: overrides.media_id,
        title: overrides.title ?? `Media ${overrides.media_id}`,
        activity_type: overrides.activity_type ?? 'Reading',
        duration_minutes: overrides.duration_minutes ?? 0,
        characters: overrides.characters ?? 0,
        date: overrides.date,
        date_precision: overrides.date_precision ?? 'day',
        language: overrides.language ?? 'Japanese',
        notes: overrides.notes ?? '',
    };
}

describe('Categories', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
    });

    it('renders an empty state instead of vanishing when there are no visible totals', () => {
        const component = new Categories(container, { categoryTotals: [], isTodayInRange: true });

        component.render();

        expect(container.querySelector('.card')).not.toBeNull();
        expect(container.querySelector('.dashboard-card-empty')).not.toBeNull();
        expect(container.querySelector('.dashboard-stats-table')).toBeNull();
    });

    it('renders category totals derived from raw logs and a media library', () => {
        const logs = [
            makeLog({ id: 1, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-08', duration_minutes: 60, characters: 1000 }),
            makeLog({ id: 2, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-10', duration_minutes: 120, characters: 0 }),
            makeLog({ id: 3, media_id: 99, title: 'Mystery', activity_type: 'Mystery', date: '2026-06-12', duration_minutes: 10, characters: 0 }),
        ];
        const mediaList = [
            makeMedia({ id: 1, title: 'Novel A', default_activity_type: 'Reading', content_type: 'Novel' }),
            makeMedia({ id: 2, title: 'Anime B', default_activity_type: 'Watching', content_type: 'Anime' }),
        ];
        const { categoryTotals, isTodayInRange } = computeRangeContext({
            logs,
            mediaList,
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });
        const component = new Categories(container, { categoryTotals, isTodayInRange });

        component.render();

        const text = textContent(container);
        expect(text).toContain('Categories');
        expect(text).toContain('Anime');
        expect(text).toContain('Novel');
        expect(text).toContain('Mystery');
        expect(container.querySelector('.dashboard-stats-row-header')?.firstElementChild?.textContent).toBe('Title');
    });

    it('renders characters-only category totals without hour columns', () => {
        const component = new Categories(container, {
            categoryTotals: [['Novel', { minutes: 0, characters: 2501 }]],
            isTodayInRange: true,
        });

        component.render();

        const text = textContent(container);
        expect(text).toContain('Chars');
        expect(text).toContain('2,501');
        expect(text).not.toContain('Hours');
    });
});

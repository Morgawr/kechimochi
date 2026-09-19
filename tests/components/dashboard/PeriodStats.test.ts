import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PeriodStats } from '../../../src/dashboard/cards/PeriodStats';
import { ActivitySummary } from '../../../src/api';
import { getActivityRange, getLocalISODate, type ActivityRange } from '../../../src/dashboard/activity_ranges';

function textContent(container: HTMLElement): string {
    return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
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

function weeklyLogs(): ActivitySummary[] {
    return [
        makeLog({ id: 1, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-08', duration_minutes: 60, characters: 1000 }),
        makeLog({ id: 2, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-09', duration_minutes: 30, characters: 2000 }),
        makeLog({ id: 3, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-10', duration_minutes: 120, characters: 0 }),
        makeLog({ id: 4, media_id: 3, title: 'Manga C', activity_type: 'Reading', date: '2026-06-11', duration_minutes: 20, characters: 5000 }),
        makeLog({ id: 5, media_id: 4, title: 'Game D', activity_type: 'Playing', date: '2026-06-12', duration_minutes: 15, characters: 0 }),
        makeLog({ id: 7, media_id: 5, title: 'Audio E', activity_type: 'Listening', date: '2026-06-13', duration_minutes: 5, characters: 0 }),
        makeLog({ id: 8, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-01', duration_minutes: 999, characters: 9999 }),
    ];
}

function buildState(timeRangeDays: number, timeRangeOffset: number, weekStartDay: number, logs?: ActivitySummary[], rangeData?: import('../../../src/api').DashboardRangeResponse) {
    const range: ActivityRange = getActivityRange(timeRangeDays, timeRangeOffset, logs ?? [], weekStartDay);
    const today = getLocalISODate(new Date());
    return {
        range,
        isTodayInRange: today >= range.validStart && today <= range.validEnd,
        rangeData,
        logs,
        timeRangeDays,
        timeRangeOffset,
        weekStartDay,
    };
}

describe('PeriodStats', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
    });

    it('renders an empty state instead of vanishing when there are no visible totals', () => {
        const component = new PeriodStats(container, buildState(7, 0, 1, []));

        component.render();

        expect(container.querySelector('.card')).not.toBeNull();
        expect(container.querySelector('.dashboard-card-empty')).not.toBeNull();
        expect(container.querySelector('.dashboard-stats-table')).toBeNull();
    });

    it('renders bounded backend totals split into day and weekday columns', () => {
        const rangeData = {
            request_id: 1,
            start_date: '2026-06-08',
            end_date: '2026-06-14',
            bucket: 'day' as const,
            group_by: 'activity_type' as const,
            series: [],
            bucket_totals: [{ bucket: '2026-06-10', total_minutes: 90, total_characters: 2500 }],
            previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
            category_totals: [],
            highlights: [],
        };
        const component = new PeriodStats(container, buildState(7, 0, 1, undefined, rangeData));

        component.render();
        const text = textContent(container);
        expect(text).toContain('Weekly Stats');

        const statsTable = container.querySelector('.dashboard-stats-table-days');
        const headerCells = Array.from(statsTable?.querySelectorAll('.dashboard-stats-row-header > span') ?? [])
            .map(cell => cell.textContent);
        const wednesdayCells = Array.from(statsTable?.querySelectorAll('[data-dashboard-total-index="2"] > span') ?? [])
            .map(cell => cell.textContent);
        expect(headerCells).toEqual(['Day', 'Weekday', 'Chars', 'Hours']);
        expect(wednesdayCells).toEqual(['10', 'WED', '2,500', '1h 30m']);
    });

    it('renders weekly totals and selected day diffs from raw logs', () => {
        const component = new PeriodStats(container, buildState(7, 0, 1, weeklyLogs()));

        component.render();

        const text = textContent(container);
        expect(text).toContain('Weekly Stats');
        const wednesdayCells = Array.from(container.querySelectorAll('[data-dashboard-total-index="2"] > span'))
            .map(cell => cell.textContent);
        expect(wednesdayCells.slice(0, 2)).toEqual(['10', 'WED']);
        expect(text).toContain('Data for today');
        expect(text).toContain('2h');
        expect(text).toContain('1h 30m more than yesterday');
        expect(text).toContain('2,000 less than yesterday');

        container.querySelector<HTMLButtonElement>('[data-dashboard-total-index="0"]')?.click();
        const selectedText = textContent(container);
        expect(selectedText).toContain('Data for Monday 08/06/2026');
        expect(selectedText).toContain('1h more than previous day');
        expect(selectedText).toContain('1,000 more than previous day');
    });

    it('renders every day in monthly stats and resets the selected bucket when the timeframe changes', () => {
        const logs = [
            ...weeklyLogs(),
            makeLog({ id: 9, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-30', duration_minutes: 45, characters: 0 }),
        ];
        const component = new PeriodStats(container, buildState(7, 0, 1, weeklyLogs()));

        component.render();
        container.querySelector<HTMLButtonElement>('[data-dashboard-total-index="0"]')?.click();
        expect(textContent(container)).toContain('Data for Monday 08/06/2026');
        expect(container.querySelectorAll('.dashboard-stats-row.is-week-start')).toHaveLength(0);

        component.setState(buildState(30, 0, 1, logs));
        const monthlyText = textContent(container);
        expect(monthlyText).toContain('Monthly Stats');
        expect(monthlyText).toContain('Data for today');
        expect(monthlyText).not.toContain('Week 1');
        expect(container.querySelectorAll('[data-dashboard-total-index]')).toHaveLength(30);
        const firstDayCells = Array.from(container.querySelectorAll('[data-dashboard-total-index="0"] > span'))
            .map(cell => cell.textContent);
        const lastDayCells = Array.from(container.querySelectorAll('[data-dashboard-total-index="29"] > span'))
            .map(cell => cell.textContent);
        expect(firstDayCells.slice(0, 2)).toEqual(['01', 'MON']);
        expect(lastDayCells.slice(0, 2)).toEqual(['30', 'TUE']);
        const mondayWeekStarts = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-stats-row.is-week-start'))
            .map(row => row.querySelector('.dashboard-stats-row-day')?.textContent);
        expect(mondayWeekStarts).toEqual(['08', '15', '22', '29']);

        component.setState(buildState(30, 0, 0, logs));
        const sundayWeekStarts = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-stats-row.is-week-start'))
            .map(row => row.querySelector('.dashboard-stats-row-day')?.textContent);
        expect(sundayWeekStarts).toEqual(['07', '14', '21', '28']);

        component.setState({ selectedBucketIndex: 29 });
        const selectedText = textContent(container);
        expect(selectedText).toContain('Data for Tuesday 30/06/2026');
        expect(selectedText).toContain('45m more than previous day');
    });

    it('renders yearly month buckets and all-time year buckets', () => {
        const logs = [
            makeLog({ id: 1, media_id: 1, title: 'Novel A', date: '2025-12-31', duration_minutes: 30, characters: 0 }),
            makeLog({ id: 2, media_id: 1, title: 'Novel A', date: '2026-01-02', duration_minutes: 60, characters: 1000 }),
            makeLog({ id: 3, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-10', duration_minutes: 90, characters: 0 }),
        ];
        const component = new PeriodStats(container, buildState(365, 0, 1, logs));

        component.render();
        const yearlyText = textContent(container);
        expect(yearlyText).toContain('Yearly Stats');
        expect(yearlyText).toContain('January');
        expect(yearlyText).toContain('June');
        expect(yearlyText).toContain('Data for this month');
        expect(yearlyText).toContain('1h 30m more than last month');
        expect(container.querySelector('.dashboard-stats-table-days')).toBeNull();
        expect(container.querySelector('.dashboard-stats-row-header')?.firstElementChild?.textContent).toBe('Month');

        component.setState(buildState(0, 0, 1, logs));
        const allTimeText = textContent(container);
        expect(allTimeText).toContain('All Time Stats');
        expect(allTimeText).toContain('All Time');
        expect(allTimeText).toContain('2025');
        expect(allTimeText).toContain('2026');
        expect(allTimeText).toContain('Data for this year');
        expect(allTimeText).toContain('2h more than last year');
        expect(container.querySelector('.dashboard-stats-table-days')).toBeNull();
        expect(container.querySelector('.dashboard-stats-row-header')?.firstElementChild?.textContent).toBe('Year');

        const fallbackLogs = [makeLog({ id: 4, media_id: 1, title: 'Novel A', date: '2024-01-01', duration_minutes: 15, characters: 0 })];
        component.setState(buildState(0, 0, 1, fallbackLogs));
        const fallbackText = textContent(container);
        expect(fallbackText).toContain('2024');
        expect(fallbackText).toContain('Data for this year');
    });

    it('renders characters-only totals without hour columns', () => {
        const logs = [
            makeLog({ id: 1, media_id: 1, title: 'Visual Novel', date: '2026-06-08', duration_minutes: 0, characters: 1 }),
            makeLog({ id: 2, media_id: 1, title: 'Visual Novel', date: '2026-06-09', duration_minutes: 0, characters: 2500 }),
        ];
        const component = new PeriodStats(container, buildState(7, 0, 1, logs));

        component.render();

        const text = textContent(container);
        expect(text).toContain('Chars');
        expect(text).toContain('2,501');
        expect(text).not.toContain('Hours');
        expect(text).not.toContain('Time:');
    });

    it('renders table durations as hours and minutes instead of decimal hours', () => {
        const logs = [
            makeLog({ id: 1, media_id: 1, date: '2026-06-08', duration_minutes: 30 }),
            makeLog({ id: 2, media_id: 1, date: '2026-06-09', duration_minutes: 90 }),
        ];
        const component = new PeriodStats(container, buildState(7, 0, 1, logs));

        component.render();

        const statsTable = container.querySelector<HTMLElement>('.dashboard-stats-table');
        expect(statsTable).not.toBeNull();
        const mondayRow = statsTable?.querySelector<HTMLElement>('[data-dashboard-total-index="0"]');
        const tuesdayRow = statsTable?.querySelector<HTMLElement>('[data-dashboard-total-index="1"]');
        const totalRow = statsTable?.querySelector<HTMLElement>('.dashboard-stats-row-total');

        expect(mondayRow).not.toBeNull();
        expect(mondayRow?.lastElementChild?.textContent).toBe('30m');
        expect(tuesdayRow?.lastElementChild?.textContent).toBe('1h 30m');
        expect(totalRow?.lastElementChild?.textContent).toBe('2h');
        expect(statsTable?.textContent).not.toMatch(/\b\d+\.\d+\b/);
    });

    it('preserves the rows scroll position across a re-render for the same timeframe', () => {
        const logs = [
            ...weeklyLogs(),
            makeLog({ id: 9, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-30', duration_minutes: 45, characters: 0 }),
        ];
        const component = new PeriodStats(container, buildState(30, 0, 1, logs));
        component.render();

        const scroller = container.querySelector<HTMLElement>('.dashboard-stats-rows');
        expect(scroller).not.toBeNull();
        Object.defineProperty(scroller, 'scrollTop', { value: 240, writable: true });

        container.querySelector<HTMLButtonElement>('[data-dashboard-total-index="0"]')?.click();

        expect(container.querySelector<HTMLElement>('.dashboard-stats-rows')?.scrollTop).toBe(240);
    });
});

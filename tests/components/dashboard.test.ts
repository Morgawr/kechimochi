import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/dashboard/Dashboard';
import * as api from '../../src/api';
import type {
    DashboardRangeRequest,
    DashboardRangeResponse,
    DashboardRecentLog,
    DashboardRecentPage,
    DashboardSnapshot,
    DashboardSnapshotRequest,
} from '../../src/types';
import { customConfirm } from '../../src/modal_base';
import { Heatmap } from '../../src/dashboard/cards/Heatmap';
import { ActivityFlow } from '../../src/dashboard/cards/ActivityFlow';
import { ActivityMix } from '../../src/dashboard/cards/ActivityMix';
import { WeekdayRhythm } from '../../src/dashboard/cards/WeekdayRhythm';
import { StatsCard } from '../../src/dashboard/StatsCard';
import { Logger } from '../../src/logger';
import { getActivityRange } from '../../src/dashboard/activity_ranges';

vi.mock('../../src/api', () => ({
    getDashboardSnapshot: vi.fn(),
    getDashboardRange: vi.fn(),
    getDashboardHeatmapYear: vi.fn(),
    getDashboardRecentLogs: vi.fn(),
    deleteLog: vi.fn(),
    setSetting: vi.fn(),
    getSetting: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({ customConfirm: vi.fn() }));
vi.mock('../../src/activity_modal', () => ({ showLogActivityModal: vi.fn() }));
const { stubComponentClass } = vi.hoisted(() => ({
    stubComponentClass: () => vi.fn(() => ({
        render: vi.fn(),
        setState: vi.fn(),
        destroy: vi.fn(),
        updatePendingParams: vi.fn(),
        updateHiddenCards: vi.fn(),
        refreshCardsSummary: vi.fn(),
        syncControlState: vi.fn(),
        setRangeLabel: vi.fn(),
        closeCardsPanel: vi.fn(),
    })),
}));

vi.mock('../../src/dashboard/StatsCard');
vi.mock('../../src/dashboard/QuickLog');

vi.mock('../../src/dashboard/cards/Heatmap', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/Heatmap')>(),
    Heatmap: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/ActivityFlow', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/ActivityFlow')>(),
    ActivityFlow: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/ActivityMix', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/ActivityMix')>(),
    ActivityMix: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/WeekdayRhythm', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/WeekdayRhythm')>(),
    WeekdayRhythm: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/PeriodStats', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/PeriodStats')>(),
    PeriodStats: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/Categories', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/Categories')>(),
    Categories: stubComponentClass(),
}));

vi.mock('../../src/dashboard/cards/Highlights', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/dashboard/cards/Highlights')>(),
    Highlights: stubComponentClass(),
}));

function getLocalISODate(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getUtcWeekStart(dateStr: string): number {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = date.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    date.setUTCDate(date.getUTCDate() - diffToMonday);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getWeeklyOffset(dateStr: string): number {
    const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.round((
        getUtcWeekStart(getLocalISODate(new Date())) - getUtcWeekStart(dateStr)
    ) / millisecondsPerWeek));
}

function recentLog(overrides: Partial<DashboardRecentLog> = {}): DashboardRecentLog {
    return {
        id: 1,
        media_id: 7,
        title: 'Horimiya',
        variant: 'Anime',
        activity_type: 'Watching',
        duration_minutes: 24,
        characters: 0,
        date: '2026-07-20',
        date_precision: 'day',
        language: 'Japanese',
        notes: '',
        ...overrides,
    };
}

function rangeResponse(request: DashboardRangeRequest, marker = 0): DashboardRangeResponse {
    return {
        request_id: request.request_id,
        start_date: request.start_date,
        end_date: request.end_date,
        bucket: request.bucket,
        group_by: request.group_by,
        series: marker === 0 ? [] : [{
            bucket: request.start_date,
            group_key: `marker:${marker}`,
            group_label: `Marker ${marker}`,
            total_minutes: marker,
            total_characters: 0,
        }],
        bucket_totals: marker === 0 ? [] : [{
            bucket: request.start_date,
            total_minutes: marker,
            total_characters: 0,
        }],
        previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
        category_totals: [],
        highlights: [],
    };
}

function snapshot(request: DashboardSnapshotRequest, overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
    return {
        request_id: request.request_id,
        settings: {
            chart_type: 'bar',
            group_by: 'activity_type',
            week_start_day: 1,
            migrate_legacy_group_by: false,
            time_range_days: 7,
            metric: 'minutes',
        },
        summary: {
            total_logs: 0,
            total_media: 0,
            logged_days: 0,
            first_activity_date: null,
            last_activity_date: null,
            max_streak: 0,
            current_streak: 0,
            total_minutes: 0,
            total_characters: 0,
            day_scoped_total_minutes: 0,
            day_scoped_total_characters: 0,
            activity_totals: [],
        },
        quick_log_media: [],
        recent_logs: {
            request_id: request.request_id,
            offset: request.recent_offset,
            limit: request.recent_limit,
            total_count: 0,
            items: [],
        },
        heatmap: { request_id: request.request_id, year: request.heatmap_year, days: [] },
        weekday_distribution: {
            start_date: request.today,
            end_date: request.today,
            days: [],
        },
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

class DashboardTestHarness extends Dashboard {
    public declare state: Dashboard['state'];
}

describe('Dashboard', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.innerHTML = '';
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }));
        const store: Record<string, string> = { kechimochi_profile: 'default' };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => store[key] || null),
            setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
            removeItem: vi.fn((key: string) => { delete store[key]; }),
            clear: vi.fn(),
            length: 1,
            key: vi.fn(),
        });

        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request));
        vi.mocked(api.getDashboardRange).mockImplementation(async request => rangeResponse(request));
        vi.mocked(api.getDashboardHeatmapYear).mockImplementation(async request => ({
            request_id: request.request_id,
            year: request.year,
            days: [],
        }));
        vi.mocked(api.getDashboardRecentLogs).mockImplementation(async request => ({
            request_id: request.request_id,
            offset: request.offset,
            limit: request.limit,
            total_count: 0,
            items: [],
        }));
        vi.mocked(api.setSetting).mockResolvedValue();
        vi.mocked(api.getSetting).mockResolvedValue(null);
    });

    async function loadDashboard(): Promise<DashboardTestHarness> {
        const dashboard = new DashboardTestHarness(container);
        dashboard.render();
        await dashboard.loadData();
        await vi.waitFor(() => expect(ActivityFlow).toHaveBeenCalled());
        return dashboard;
    }

    function selectTimeRange(days: number): void {
        const select = container.querySelector('#select-time-range') as HTMLSelectElement;
        select.value = String(days);
        select.dispatchEvent(new Event('change'));
    }

    function stepToPreviousPeriod(): void {
        (container.querySelector('#btn-chart-prev') as HTMLButtonElement).dispatchEvent(new Event('click'));
    }

    function cardHost(id: string): HTMLElement | null {
        return container.querySelector<HTMLElement>(`[data-dashboard-card="${id}"]`);
    }

    function openCardsMenu(): void {
        (container.querySelector('#dashboard-cards-menu-button') as HTMLButtonElement).click();
    }

    function toggleCardCheckbox(id: string): void {
        const checkbox = document.querySelector<HTMLInputElement>(`.multi-select-panel input[value="${id}"]`)!;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
    }

    function isCardHiddenAccordingToMenu(id: string): boolean {
        const trigger = container.querySelector('#dashboard-cards-menu-button') as HTMLButtonElement;
        if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
        trigger.click();
        const checkbox = document.querySelector<HTMLInputElement>(`.multi-select-panel input[value="${id}"]`)!;
        return !checkbox.checked;
    }

    it('mounts the shell first and loads one bounded snapshot', async () => {
        const pending = deferred<DashboardSnapshot>();
        vi.mocked(api.getDashboardSnapshot).mockReturnValueOnce(pending.promise);
        const dashboard = new DashboardTestHarness(container);
        dashboard.render();

        expect(container.querySelector('.dashboard-root')).not.toBeNull();
        expect(container.textContent).toContain('Loading study stats');

        const load = dashboard.loadData();
        const request = vi.mocked(api.getDashboardSnapshot).mock.calls[0][0];
        expect(request.recent_limit).toBe(15);
        pending.resolve(snapshot(request));
        await load;

        expect(api.getDashboardSnapshot).toHaveBeenCalledTimes(1);
        const root = container.querySelector<HTMLElement>('.dashboard-root');
        expect(root?.dataset.dashboardRequestId).toBe(request.request_id.toString());
        expect(root?.dataset.dashboardPrimaryRequestId).toBe(request.request_id.toString());
        expect(root?.dataset.dashboardHeatmapRequestId).toBe(request.request_id.toString());
        await vi.waitFor(() => expect(ActivityFlow).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({ snapshotRequestId: request.request_id }),
            expect.any(Function),
            expect.any(Function),
        ));
        expect(dashboard.state.isInitialized).toBe(true);
        expect(ActivityFlow).toHaveBeenCalledTimes(1);
    });

    it('reuses mounted components and does not explicitly render after setState', async () => {
        const dashboard = await loadDashboard();
        const stats = vi.mocked(StatsCard).mock.results[0].value;
        const flow = vi.mocked(ActivityFlow).mock.results[0].value;
        const mix = vi.mocked(ActivityMix).mock.results[0].value;
        expect(stats.render).toHaveBeenCalledTimes(1);
        expect(flow.render).toHaveBeenCalledTimes(1);
        expect(mix.render).toHaveBeenCalledTimes(1);

        await dashboard.loadData();
        await vi.waitFor(() => expect(flow.setState).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(mix.setState).toHaveBeenCalledTimes(1));

        expect(StatsCard).toHaveBeenCalledTimes(1);
        expect(ActivityFlow).toHaveBeenCalledTimes(1);
        expect(ActivityMix).toHaveBeenCalledTimes(1);
        expect(stats.setState).toHaveBeenCalledTimes(1);
        expect(stats.render).toHaveBeenCalledTimes(1);
        expect(flow.render).toHaveBeenCalledTimes(1);
        expect(mix.render).toHaveBeenCalledTimes(1);
    });

    it('fetches recent logs one page at a time', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            recent_logs: {
                request_id: request.request_id,
                offset: 0,
                limit: 15,
                total_count: 20,
                items: Array.from({ length: 15 }, (_, index) => recentLog({ id: index + 6 })),
            },
        }));
        vi.mocked(api.getDashboardRecentLogs).mockImplementation(async request => ({
            request_id: request.request_id,
            offset: request.offset,
            limit: request.limit,
            total_count: 20,
            items: Array.from({ length: 5 }, (_, index) => recentLog({ id: index + 1 })),
        }));
        await loadDashboard();

        (container.querySelector('#next-page') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.getDashboardRecentLogs).toHaveBeenCalledWith(expect.objectContaining({
            offset: 15,
            limit: 15,
        })));
        await vi.waitFor(() => {
            expect(container.querySelector('#current-page-display')?.textContent).toBe('2');
            expect(container.querySelectorAll('.dashboard-activity-item')).toHaveLength(5);
        });
    });

    it('uses the variant embedded in the recent page without loading the media library', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            recent_logs: {
                request_id: request.request_id,
                offset: 0,
                limit: 15,
                total_count: 1,
                items: [recentLog()],
            },
        }));
        await loadDashboard();
        expect(container.querySelector('.dashboard-activity-variant')?.textContent).toBe('Anime');
    });

    it('prompts before deleting and refreshes through a new snapshot', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            recent_logs: {
                request_id: request.request_id,
                offset: 0,
                limit: 15,
                total_count: 1,
                items: [recentLog({ id: 456 })],
            },
        }));
        vi.mocked(customConfirm).mockResolvedValue(true);
        await loadDashboard();

        (container.querySelector('.delete-log-btn') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.deleteLog).toHaveBeenCalledWith(456));
        await vi.waitFor(() => expect(api.getDashboardSnapshot).toHaveBeenCalledTimes(2));
    });

    it('loads chart settings inside the snapshot and persists only legacy migration', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'line',
                group_by: 'activity_type',
                week_start_day: 0,
                migrate_legacy_group_by: true,
                time_range_days: 7,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();

        expect(dashboard.state.chartParams).toMatchObject({
            chartType: 'line',
            groupByMode: 'activity_type',
            weekStartDay: 0,
        });
        expect(api.setSetting).toHaveBeenCalledWith('dashboard_group_by', 'activity_type');
    });

    it('applies a persisted non-Week period on load and requests its range', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: false,
                time_range_days: 30,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();
        const expectedRange = getActivityRange(30, 0, [], 1);

        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 30, timeRangeOffset: 0 });
        expect(vi.mocked(api.getDashboardRange).mock.calls[0][0]).toEqual(expect.objectContaining({
            start_date: expectedRange.validStart,
            end_date: expectedRange.validEnd,
        }));
    });

    it('persists All Time as "0" when selected', async () => {
        await loadDashboard();

        selectTimeRange(0);

        expect(api.setSetting).toHaveBeenCalledWith('dashboard_time_range_days', '0');
    });

    it('does not snap a live period change back to a stale persisted value on a later load', async () => {
        const dashboard = await loadDashboard();
        const { promise: pendingWrite } = deferred<void>();
        vi.mocked(api.setSetting).mockReturnValueOnce(pendingWrite);

        selectTimeRange(30);
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 30 });

        // The snapshot returned by a later load (e.g. after logging) still reflects the
        // not-yet-persisted week setting; the live period must win while its own write
        // to persist it is still in flight.
        await dashboard.loadData();
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(3));

        const expectedRange = getActivityRange(30, 0, [], 1);
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 30 });
        expect(vi.mocked(api.getDashboardRange).mock.calls[2][0]).toEqual(expect.objectContaining({
            start_date: expectedRange.validStart,
            end_date: expectedRange.validEnd,
        }));
    });

    it('keeps a live period pinned while an earlier overlapping setting write settles first', async () => {
        const dashboard = await loadDashboard();
        const monthWrite = deferred<void>();
        const yearWrite = deferred<void>();
        vi.mocked(api.setSetting)
            .mockReturnValueOnce(monthWrite.promise)
            .mockReturnValueOnce(yearWrite.promise);

        selectTimeRange(30);
        selectTimeRange(365);
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 365 });

        monthWrite.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await dashboard.loadData();
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(4));

        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 365 });

        yearWrite.resolve();
        await Promise.resolve();
    });

    it('adopts the snapshot\'s period and metric on a later load when no write is pending', async () => {
        const dashboard = await loadDashboard();
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 7, metric: 'minutes' });

        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: false,
                time_range_days: 30,
                metric: 'characters',
            },
        }));

        await dashboard.loadData();
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(2));

        const expectedRange = getActivityRange(30, 0, [], 1);
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 30, metric: 'characters' });
        expect(vi.mocked(api.getDashboardRange).mock.calls[1][0]).toEqual(expect.objectContaining({
            start_date: expectedRange.validStart,
            end_date: expectedRange.validEnd,
        }));
    });

    it('keeps loading when persisting legacy group-by migration fails', async () => {
        const migrationError = new Error('settings unavailable');
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.mocked(api.setSetting).mockRejectedValue(migrationError);
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: true,
                time_range_days: 7,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();

        expect(dashboard.state.isInitialized).toBe(true);
        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith(
            'Failed to migrate dashboard group by setting',
            migrationError,
        ));
    });

    it('requests an explicit range when a heatmap day is selected', async () => {
        const clickedDate = getLocalISODate(new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)));
        const dashboard = await loadDashboard();
        const onDateSelect = vi.mocked(Heatmap).mock.calls[0]?.[3] as ((date: string) => void);
        onDateSelect(clickedDate);

        const expectedOffset = getWeeklyOffset(clickedDate);
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(2));
        expect(vi.mocked(api.getDashboardRange).mock.calls[1][0]).toEqual(expect.objectContaining({
            bucket: 'day',
            group_by: 'activity_type',
        }));
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 7, timeRangeOffset: expectedOffset });
        expect(api.setSetting).not.toHaveBeenCalledWith('dashboard_time_range_days', expect.anything());
    });

    it('moves only the offset, crossing a year boundary, when a heatmap day is selected in Month view', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15T12:00:00'));
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: false,
                time_range_days: 30,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();
        const onDateSelect = vi.mocked(Heatmap).mock.calls[0]?.[3] as ((date: string) => void);

        onDateSelect('2025-12-10');
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(2));

        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 30, timeRangeOffset: 1 });
        expect(api.setSetting).not.toHaveBeenCalledWith('dashboard_time_range_days', expect.anything());
    });

    it('moves only the offset, crossing a year boundary, when a heatmap day is selected in Year view', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15T12:00:00'));
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: false,
                time_range_days: 365,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();
        const onDateSelect = vi.mocked(Heatmap).mock.calls[0]?.[3] as ((date: string) => void);

        onDateSelect('2025-06-01');
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(2));

        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 365, timeRangeOffset: 1 });
        expect(api.setSetting).not.toHaveBeenCalledWith('dashboard_time_range_days', expect.anything());
    });

    it('does nothing when a heatmap day is selected in All Time view', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            settings: {
                chart_type: 'bar',
                group_by: 'activity_type',
                week_start_day: 1,
                migrate_legacy_group_by: false,
                time_range_days: 0,
                metric: 'minutes',
            },
        }));
        const dashboard = await loadDashboard();
        const onDateSelect = vi.mocked(Heatmap).mock.calls[0]?.[3] as ((date: string) => void);

        onDateSelect('2020-01-01');
        await Promise.resolve();

        expect(api.getDashboardRange).toHaveBeenCalledTimes(1);
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 0, timeRangeOffset: 0 });
    });

    it('rejects an older snapshot so profile data cannot blend after a refresh', async () => {
        const first = deferred<DashboardSnapshot>();
        const second = deferred<DashboardSnapshot>();
        vi.mocked(api.getDashboardSnapshot)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const dashboard = new DashboardTestHarness(container);
        const firstLoad = dashboard.loadData();
        const firstRequest = vi.mocked(api.getDashboardSnapshot).mock.calls[0][0];
        const secondLoad = dashboard.loadData();
        const secondRequest = vi.mocked(api.getDashboardSnapshot).mock.calls[1][0];

        second.resolve(snapshot(secondRequest, {
            summary: { ...snapshot(secondRequest).summary, total_logs: 222 },
        }));
        await secondLoad;
        first.resolve(snapshot(firstRequest, {
            summary: { ...snapshot(firstRequest).summary, total_logs: 111 },
        }));
        await firstLoad;

        expect(dashboard.state.summary!.total_logs).toBe(222);
    });

    it('rejects an out-of-order range response', async () => {
        const dashboard = await loadDashboard();
        const older = deferred<DashboardRangeResponse>();
        const newer = deferred<DashboardRangeResponse>();
        vi.mocked(api.getDashboardRange)
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        stepToPreviousPeriod();
        const olderRequest = vi.mocked(api.getDashboardRange).mock.calls[1][0];
        stepToPreviousPeriod();
        const newerRequest = vi.mocked(api.getDashboardRange).mock.calls[2][0];
        newer.resolve(rangeResponse(newerRequest, 22));
        await vi.waitFor(() => {
            expect(dashboard.state.rangeData!.series[0]?.group_label).toBe('Marker 22');
        });
        older.resolve(rangeResponse(olderRequest, 11));
        await older.promise;
        await Promise.resolve();

        expect(dashboard.state.rangeData!.series[0]?.group_label).toBe('Marker 22');
    });

    it('surfaces a failure state on the chart and totals cards when the first range request fails', async () => {
        vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.mocked(api.getDashboardRange).mockRejectedValueOnce(new Error('range unavailable'));
        const dashboard = new DashboardTestHarness(container);
        dashboard.render();
        await dashboard.loadData();

        await vi.waitFor(() => {
            expect(cardHost('activity_flow')?.textContent).toContain('Unable to load chart data.');
        });
        expect(cardHost('activity_mix')?.textContent).toContain('Unable to load chart data.');
        expect(cardHost('period_stats')?.textContent).toContain('Unable to load chart data.');
        expect(cardHost('heatmap')?.textContent).not.toContain('Unable to load chart data.');
    });

    it('gives the heatmap a request host whose generation check follows the active load', async () => {
        const dashboard = await loadDashboard();
        const host = vi.mocked(Heatmap).mock.calls[0][2];

        const generation = host.currentGeneration();
        const requestId = host.nextRequestId();
        expect(host.isCurrent(generation, requestId, requestId)).toBe(true);

        await dashboard.loadData();

        expect(host.isCurrent(generation, requestId, requestId)).toBe(false);
    });

    it('should render the side panel toggle expanded by default', async () => {
        await loadDashboard();

        const toggle = container.querySelector('#dashboard-side-panel-toggle');
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('#dashboard-columns')?.classList.contains('is-side-panel-collapsed')).toBe(false);
    });

    it('should place the side panel toggle inside the controls card', async () => {
        await loadDashboard();

        expect(container.querySelector('.dashboard-controls-card #dashboard-side-panel-toggle')).not.toBeNull();
    });

    it('should collapse the side panel when the toggle is clicked', async () => {
        await loadDashboard();

        (container.querySelector('#dashboard-side-panel-toggle') as HTMLButtonElement).click();

        expect(container.querySelector('#dashboard-columns')?.classList.contains('is-side-panel-collapsed')).toBe(true);
        expect(container.querySelector('#dashboard-side-panel-toggle')?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should expand the side panel when the toggle is clicked twice', async () => {
        await loadDashboard();
        const toggle = container.querySelector('#dashboard-side-panel-toggle') as HTMLButtonElement;

        toggle.click();
        toggle.click();

        expect(container.querySelector('#dashboard-columns')?.classList.contains('is-side-panel-collapsed')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('should keep the side panel collapsed across a data refresh', async () => {
        const dashboard = await loadDashboard();
        (container.querySelector('#dashboard-side-panel-toggle') as HTMLButtonElement).click();

        await dashboard.loadData();

        expect(container.querySelector('#dashboard-columns')?.classList.contains('is-side-panel-collapsed')).toBe(true);
    });

    it('lets the visibility revision win over a stale hidden-cards read from an overlapping reload', async () => {
        const dashboard = await loadDashboard();

        const { promise: readPromise, resolve: resolveRead } = deferred<string | null>();
        vi.mocked(api.getSetting).mockReturnValueOnce(readPromise);
        const reload = dashboard.loadData();
        await vi.waitFor(() => expect(api.getSetting).toHaveBeenCalledTimes(2));

        openCardsMenu();
        toggleCardCheckbox('heatmap');
        await vi.mocked(api.setSetting).mock.results[0].value;
        await Promise.resolve();
        await Promise.resolve();

        resolveRead('[]');
        await reload;

        expect(isCardHiddenAccordingToMenu('heatmap')).toBe(true);
    });

    describe('hidden-cards write coalescing', () => {
        it('keeps exactly one write in flight and writes the final coalesced value once it settles', async () => {
            await loadDashboard();
            const firstWrite = deferred<void>();
            vi.mocked(api.setSetting).mockReturnValueOnce(firstWrite.promise);

            openCardsMenu();
            toggleCardCheckbox('heatmap');
            expect(api.setSetting).toHaveBeenCalledTimes(1);

            toggleCardCheckbox('activity_flow');
            toggleCardCheckbox('recent_activity');
            expect(api.setSetting).toHaveBeenCalledTimes(1);

            firstWrite.resolve();
            await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledTimes(2));

            expect(JSON.parse(vi.mocked(api.setSetting).mock.calls[1][1])).toEqual([
                'heatmap', 'activity_flow', 'recent_activity',
            ]);
        });

        it('is unaffected by out-of-order write resolution because only one write is ever in flight', async () => {
            await loadDashboard();
            const firstWrite = deferred<void>();
            const secondWrite = deferred<void>();
            vi.mocked(api.setSetting)
                .mockReturnValueOnce(firstWrite.promise)
                .mockReturnValueOnce(secondWrite.promise);

            openCardsMenu();
            toggleCardCheckbox('heatmap');
            toggleCardCheckbox('activity_flow');
            expect(api.setSetting).toHaveBeenCalledTimes(1);

            secondWrite.resolve();
            await Promise.resolve();
            await Promise.resolve();
            expect(api.setSetting).toHaveBeenCalledTimes(1);

            firstWrite.resolve();
            await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledTimes(2));

            expect(JSON.parse(vi.mocked(api.setSetting).mock.calls[1][1])).toEqual(['heatmap', 'activity_flow']);
        });

        it('does not write once per card when every card is hidden in one sweep', async () => {
            await loadDashboard();

            openCardsMenu();
            for (const id of [
                'heatmap', 'activity_flow', 'activity_mix', 'weekday_rhythm',
                'period_stats', 'categories', 'highlights', 'recent_activity',
            ]) {
                toggleCardCheckbox(id);
            }

            await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledTimes(2));
            expect(api.setSetting).not.toHaveBeenCalledTimes(8);
        });

        it('recovers after a rejected write without leaving a queued value stranded', async () => {
            await loadDashboard();
            const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
            vi.mocked(api.setSetting).mockRejectedValueOnce(new Error('write failed'));

            openCardsMenu();
            toggleCardCheckbox('heatmap');
            await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith(
                'Failed to save dashboard hidden cards setting',
                expect.any(Error),
            ));

            toggleCardCheckbox('activity_flow');
            await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledTimes(2));

            expect(JSON.parse(vi.mocked(api.setSetting).mock.calls[1][1])).toEqual(['heatmap', 'activity_flow']);
        });
    });

    it('keeps requiring range data when only the weekday card is hidden', async () => {
        const dashboard = await loadDashboard();
        expect(api.getDashboardRange).toHaveBeenCalledTimes(1);

        openCardsMenu();
        toggleCardCheckbox('weekday_rhythm');
        vi.mocked(api.getSetting).mockResolvedValueOnce(JSON.stringify(['weekday_rhythm']));
        await dashboard.loadData();

        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledTimes(2));
    });

    it('renders the radar from the snapshot alone and skips the range fetch once every range card is hidden', async () => {
        const dashboard = await loadDashboard();
        const rangeCardIds = ['activity_flow', 'activity_mix', 'period_stats', 'categories', 'highlights'];

        openCardsMenu();
        for (const id of rangeCardIds) {
            toggleCardCheckbox(id);
        }

        vi.mocked(api.getDashboardRange).mockClear();
        vi.mocked(api.getSetting).mockResolvedValueOnce(JSON.stringify(rangeCardIds));
        await dashboard.loadData();
        await vi.waitFor(() => expect(WeekdayRhythm).toHaveBeenCalled());

        expect(api.getDashboardRange).not.toHaveBeenCalled();
        expect(dashboard.state.weekdayDistribution).not.toBeNull();
    });

    it('clears stale range data before a repeat load\'s new range response arrives', async () => {
        const dashboard = await loadDashboard();
        expect(dashboard.state.rangeData).not.toBeNull();

        const pendingRange = deferred<DashboardRangeResponse>();
        vi.mocked(api.getDashboardRange).mockReturnValueOnce(pendingRange.promise);

        const reload = dashboard.loadData();
        await vi.waitFor(() => expect(dashboard.state.rangeData).toBeNull());

        pendingRange.resolve(rangeResponse(vi.mocked(api.getDashboardRange).mock.calls.at(-1)![0]));
        await reload;

        expect(dashboard.state.rangeData).not.toBeNull();
    });

    it('resets a stuck "Loading page…" flag when a reload invalidates an in-flight page request', async () => {
        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => snapshot(request, {
            recent_logs: {
                request_id: request.request_id,
                offset: 0,
                limit: 15,
                total_count: 20,
                items: Array.from({ length: 15 }, (_, index) => recentLog({ id: index + 1 })),
            },
        }));
        const dashboard = await loadDashboard();

        const pendingPage = deferred<DashboardRecentPage>();
        vi.mocked(api.getDashboardRecentLogs).mockReturnValueOnce(pendingPage.promise);
        (container.querySelector('#next-page') as HTMLButtonElement).click();
        expect(container.querySelector('#recent-logs-list')?.textContent).toContain('Loading page');

        await dashboard.loadData();

        expect(container.querySelector('#recent-logs-list')?.textContent).not.toContain('Loading page');
        expect(container.querySelectorAll('.dashboard-activity-item')).toHaveLength(15);
        expect(container.querySelector('#current-page-display')?.textContent).toBe('1');

        pendingPage.resolve({ request_id: 999, offset: 15, limit: 15, total_count: 20, items: [] });
        await Promise.resolve();
        await Promise.resolve();
        expect(container.querySelector('#recent-logs-list')?.textContent).not.toContain('Loading page');
    });
});

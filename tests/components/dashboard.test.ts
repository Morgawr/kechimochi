import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/dashboard/Dashboard';
import * as api from '../../src/api';
import type {
    DashboardRangeRequest,
    DashboardRangeResponse,
    DashboardRecentLog,
    DashboardSnapshot,
    DashboardSnapshotRequest,
} from '../../src/types';
import { customConfirm } from '../../src/modal_base';
import { HeatmapView } from '../../src/dashboard/HeatmapView';
import { ActivityCharts } from '../../src/dashboard/ActivityCharts';
import { StatsCard } from '../../src/dashboard/StatsCard';
import { Logger } from '../../src/logger';

vi.mock('../../src/api', () => ({
    getDashboardSnapshot: vi.fn(),
    getDashboardRange: vi.fn(),
    getDashboardHeatmapYear: vi.fn(),
    getDashboardRecentLogs: vi.fn(),
    deleteLog: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({ customConfirm: vi.fn() }));
vi.mock('../../src/activity_modal', () => ({ showLogActivityModal: vi.fn() }));
vi.mock('../../src/dashboard/StatsCard');
vi.mock('../../src/dashboard/HeatmapView');
vi.mock('../../src/dashboard/ActivityCharts');
vi.mock('../../src/dashboard/QuickLog');
vi.mock('../../src/dashboard/ActivityTotals');

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
        category_totals: [],
        highlights: [],
    };
}

function snapshot(request: DashboardSnapshotRequest, overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
    const range: DashboardRangeResponse = {
        request_id: request.request_id,
        start_date: request.today,
        end_date: request.today,
        bucket: 'day',
        group_by: 'activity_type',
        series: [],
        bucket_totals: [],
        category_totals: [],
        highlights: [],
    };
    return {
        request_id: request.request_id,
        settings: {
            chart_type: 'bar',
            group_by: 'activity_type',
            week_start_day: 1,
            migrate_legacy_group_by: false,
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
        range,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

describe('Dashboard', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
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
    });

    async function loadDashboard(): Promise<Dashboard> {
        const dashboard = new Dashboard(container);
        dashboard.render();
        await dashboard.loadData();
        return dashboard;
    }

    it('mounts the shell first and loads one bounded snapshot', async () => {
        const pending = deferred<DashboardSnapshot>();
        vi.mocked(api.getDashboardSnapshot).mockReturnValueOnce(pending.promise);
        const dashboard = new Dashboard(container);
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
        expect(ActivityCharts).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({ snapshotRequestId: request.request_id }),
            expect.any(Function),
        );
        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.isInitialized).toBe(true);
        expect(ActivityCharts).toHaveBeenCalledTimes(1);
    });

    it('reuses mounted components and does not explicitly render after setState', async () => {
        const dashboard = await loadDashboard();
        const stats = vi.mocked(StatsCard).mock.results[0].value;
        const charts = vi.mocked(ActivityCharts).mock.results[0].value;
        expect(stats.render).toHaveBeenCalledTimes(1);
        expect(charts.render).toHaveBeenCalledTimes(1);

        await dashboard.loadData();

        expect(StatsCard).toHaveBeenCalledTimes(1);
        expect(ActivityCharts).toHaveBeenCalledTimes(1);
        expect(stats.setState).toHaveBeenCalledTimes(1);
        expect(stats.render).toHaveBeenCalledTimes(1);
        expect(charts.setState).toHaveBeenCalledTimes(1);
        expect(charts.render).toHaveBeenCalledTimes(1);
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
        const dashboard = await loadDashboard();

        (container.querySelector('#next-page') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.getDashboardRecentLogs).toHaveBeenCalledWith(expect.objectContaining({
            offset: 15,
            limit: 15,
        })));
        await vi.waitFor(() => {
            // @ts-expect-error state is intentionally inspected as component contract coverage
            expect(dashboard.state.currentPage).toBe(2);
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
            },
        }));
        const dashboard = await loadDashboard();

        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.chartParams).toMatchObject({
            chartType: 'line',
            groupByMode: 'activity_type',
            weekStartDay: 0,
        });
        expect(api.setSetting).toHaveBeenCalledWith('dashboard_group_by', 'activity_type');
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
            },
        }));
        const dashboard = await loadDashboard();

        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.isInitialized).toBe(true);
        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith(
            'Failed to migrate dashboard group by setting',
            migrationError,
        ));
    });

    it('requests an explicit range when a heatmap day is selected', async () => {
        const clickedDate = getLocalISODate(new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)));
        const dashboard = await loadDashboard();
        const onDateSelect = vi.mocked(HeatmapView).mock.calls[0]?.[3] as ((date: string) => void);
        onDateSelect(clickedDate);

        const expectedOffset = getWeeklyOffset(clickedDate);
        await vi.waitFor(() => expect(api.getDashboardRange).toHaveBeenCalledWith(expect.objectContaining({
            bucket: 'day',
            group_by: 'activity_type',
        })));
        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.chartParams).toMatchObject({ timeRangeDays: 7, timeRangeOffset: expectedOffset });
    });

    it('rejects an older snapshot so profile data cannot blend after a refresh', async () => {
        const first = deferred<DashboardSnapshot>();
        const second = deferred<DashboardSnapshot>();
        vi.mocked(api.getDashboardSnapshot)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const dashboard = new Dashboard(container);
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

        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.summary.total_logs).toBe(222);
    });

    it('rejects an out-of-order range response', async () => {
        const dashboard = await loadDashboard();
        const chartCallback = vi.mocked(ActivityCharts).mock.calls[0][2] as (params: Record<string, unknown>) => void;
        const older = deferred<DashboardRangeResponse>();
        const newer = deferred<DashboardRangeResponse>();
        vi.mocked(api.getDashboardRange)
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        chartCallback({ timeRangeOffset: 1 });
        const olderRequest = vi.mocked(api.getDashboardRange).mock.calls[0][0];
        chartCallback({ timeRangeOffset: 2 });
        const newerRequest = vi.mocked(api.getDashboardRange).mock.calls[1][0];
        newer.resolve(rangeResponse(newerRequest, 22));
        await vi.waitFor(() => {
            // @ts-expect-error state is intentionally inspected as component contract coverage
            expect(dashboard.state.rangeData.series[0]?.group_label).toBe('Marker 22');
        });
        older.resolve(rangeResponse(olderRequest, 11));
        await older.promise;
        await Promise.resolve();

        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.rangeData.series[0]?.group_label).toBe('Marker 22');
    });

    it('rejects an out-of-order heatmap-year response', async () => {
        const dashboard = await loadDashboard();
        const yearCallback = vi.mocked(HeatmapView).mock.calls[0][2] as (direction: number) => void;
        const older = deferred<Awaited<ReturnType<typeof api.getDashboardHeatmapYear>>>();
        const newer = deferred<Awaited<ReturnType<typeof api.getDashboardHeatmapYear>>>();
        vi.mocked(api.getDashboardHeatmapYear)
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        yearCallback(-1);
        const olderRequest = vi.mocked(api.getDashboardHeatmapYear).mock.calls[0][0];
        yearCallback(-1);
        const newerRequest = vi.mocked(api.getDashboardHeatmapYear).mock.calls[1][0];
        newer.resolve({ request_id: newerRequest.request_id, year: newerRequest.year, days: [{ date: `${newerRequest.year}-01-02`, total_minutes: 2, total_characters: 0 }] });
        await vi.waitFor(() => {
            // @ts-expect-error state is intentionally inspected as component contract coverage
            expect(dashboard.state.heatmapData[0]?.total_minutes).toBe(2);
        });
        older.resolve({ request_id: olderRequest.request_id, year: olderRequest.year, days: [{ date: `${olderRequest.year}-01-01`, total_minutes: 1, total_characters: 0 }] });
        await older.promise;
        await Promise.resolve();

        // @ts-expect-error state is intentionally inspected as component contract coverage
        expect(dashboard.state.heatmapData[0]?.total_minutes).toBe(2);
    });
});

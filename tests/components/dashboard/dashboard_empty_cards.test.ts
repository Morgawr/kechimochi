import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../../src/dashboard/Dashboard';
import * as api from '../../../src/api';
import type { DashboardSnapshot, DashboardSnapshotRequest } from '../../../src/types';
import { DASHBOARD_CARD_ORDER } from '../../../src/dashboard/dashboard_cards';

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));

vi.mock('../../../src/media/cover_loader', () => ({
    MediaCoverLoader: { load: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../../src/api', () => ({
    getDashboardSnapshot: vi.fn(),
    getDashboardRange: vi.fn(),
    getDashboardHeatmapYear: vi.fn(),
    getDashboardRecentLogs: vi.fn(),
    deleteLog: vi.fn(),
    setSetting: vi.fn(),
    getSetting: vi.fn(),
}));

vi.mock('../../../src/modal_base', () => ({ customConfirm: vi.fn() }));
vi.mock('../../../src/activity_modal', () => ({ showLogActivityModal: vi.fn() }));
vi.mock('../../../src/dashboard/StatsCard');
vi.mock('../../../src/dashboard/QuickLog');

function emptySnapshot(request: DashboardSnapshotRequest): DashboardSnapshot {
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
        recent_logs: { request_id: request.request_id, offset: 0, limit: request.recent_limit, total_count: 0, items: [] },
        heatmap: { request_id: request.request_id, year: request.heatmap_year, days: [] },
        weekday_distribution: { start_date: request.today, end_date: request.today, days: [] },
    };
}

describe('Dashboard — every card on an empty snapshot', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }));

        vi.mocked(api.getDashboardSnapshot).mockImplementation(async request => emptySnapshot(request));
        vi.mocked(api.getDashboardRange).mockImplementation(async request => ({
            request_id: request.request_id,
            start_date: request.start_date,
            end_date: request.end_date,
            bucket: request.bucket,
            group_by: request.group_by,
            series: [],
            bucket_totals: [],
            previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
            category_totals: [],
            highlights: [],
        }));
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

    it('renders a .card in every registered host instead of a future card regressing to an empty string', async () => {
        const dashboard = new Dashboard(container);
        dashboard.render();
        await dashboard.loadData();

        await vi.waitFor(() => {
            for (const { id } of DASHBOARD_CARD_ORDER) {
                const host = container.querySelector<HTMLElement>(`[data-dashboard-card="${id}"]`);
                expect(host, `host for ${id}`).not.toBeNull();
                expect(host!.querySelector('.card'), `${id} should contain a .card`).not.toBeNull();
            }
        });
    });
});

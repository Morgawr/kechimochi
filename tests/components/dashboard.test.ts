import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dashboard } from '../../src/dashboard/Dashboard';
import * as api from '../../src/api';
import { ActivitySummary } from '../../src/api';
import { customConfirm } from '../../src/modal_base';
import { HeatmapView } from '../../src/dashboard/HeatmapView';
import { ActivityCharts } from '../../src/dashboard/ActivityCharts';

vi.mock('../../src/api', () => ({
    getLogs: vi.fn(),
    getHeatmap: vi.fn(),
    getAllMedia: vi.fn(),
    deleteLog: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({
    customConfirm: vi.fn(),
}));

vi.mock('../../src/activity_modal', () => ({
    showLogActivityModal: vi.fn(),
}));

vi.mock('../../src/dashboard/StatsCard');
vi.mock('../../src/dashboard/HeatmapView');
vi.mock('../../src/dashboard/ActivityCharts');

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
    const currentWeekStart = getUtcWeekStart(getLocalISODate(new Date()));
    const selectedWeekStart = getUtcWeekStart(dateStr);

    return Math.max(0, Math.round((currentWeekStart - selectedWeekStart) / millisecondsPerWeek));
}

describe('Dashboard', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();

        // Mock localStorage
        const store: Record<string, string> = {
            'kechimochi_profile': 'default'
        };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => store[key] || null),
            setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
            removeItem: vi.fn((key: string) => { delete store[key]; }),
            clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
            length: 1,
            key: vi.fn((index: number) => Object.keys(store)[index] || null)
        });
    });

    it('should initialize and load data', async () => {
        vi.mocked(api.getLogs).mockResolvedValue([]);
        vi.mocked(api.getHeatmap).mockResolvedValue([]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);

        const dashboard = new Dashboard(container);
        await vi.waitFor(() => {
            dashboard.render();
            // @ts-expect-error - accessing private state
            if (!dashboard.state.isInitialized) throw new Error('Not initialized');
        });

        expect(api.getLogs).toHaveBeenCalled();
        expect(container.querySelector('.dashboard-root')).not.toBeNull();
    });

    it('should handle pagination', async () => {
        const mockLog = { id: 1, title: 'T', media_id: 1, duration_minutes: 10, characters: 0, date: '2024-01-01', media_type: 'Type', language: 'Japanese' };
        const logs: ActivitySummary[] = Array.from({ length: 20 }, () => ({ ...mockLog }));
        vi.mocked(api.getLogs).mockResolvedValue(logs);
        vi.mocked(api.getHeatmap).mockResolvedValue([]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);

        const dashboard = new Dashboard(container);
        await vi.waitFor(() => {
            dashboard.render();
            // @ts-expect-error - accessing private state
            if (!dashboard.state.isInitialized) throw new Error('Not initialized');
        });

        const nextPage = container.querySelector('#next-page') as HTMLElement;
        expect(nextPage).not.toBeNull();
        nextPage.click();

        // @ts-expect-error - accessing private state
        expect(dashboard.state.currentPage).toBe(2);
    });

    it('should prompt before deleting a log', async () => {
        const logs: ActivitySummary[] = [{ id: 456, title: 'To Delete', media_id: 1, duration_minutes: 10, characters: 0, date: '2024-01-01', media_type: 'Type', language: 'Japanese' }];
        vi.mocked(api.getLogs).mockResolvedValue(logs);
        vi.mocked(api.getHeatmap).mockResolvedValue([]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        
        vi.mocked(customConfirm).mockResolvedValue(true);

        const dashboard = new Dashboard(container);
        await vi.waitFor(() => {
            dashboard.render();
            // @ts-expect-error - accessing private state
            if (!dashboard.state.isInitialized) throw new Error('Not initialized');
        });

        const deleteBtn = container.querySelector('.delete-log-btn') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => {
            expect(customConfirm).toHaveBeenCalled();
            expect(api.deleteLog).toHaveBeenCalledWith(456);
        });
    });
    it('should load chart settings on mount', async () => {
        vi.mocked(api.getLogs).mockResolvedValue([]);
        vi.mocked(api.getHeatmap).mockResolvedValue([]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'dashboard_chart_type') return 'line';
            if (key === 'dashboard_group_by') return 'log_name';
            return null;
        });

        const dashboard = new Dashboard(container);
        await vi.waitFor(() => {
            dashboard.render();
            // @ts-expect-error - accessing private state
            if (!dashboard.state.isInitialized) throw new Error('Not initialized');
        });

        // @ts-expect-error - accessing private state
        expect(dashboard.state.chartParams.chartType).toBe('line');
        // @ts-expect-error - accessing private state
        expect(dashboard.state.chartParams.groupByMode).toBe('log_name');
    });

    it('should switch the activity charts to the clicked heatmap week', async () => {
        const clickedDate = getLocalISODate(new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)));

        vi.mocked(api.getLogs).mockResolvedValue([]);
        vi.mocked(api.getHeatmap).mockResolvedValue([
            { date: clickedDate, total_minutes: 45, total_characters: 1800 }
        ]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'dashboard_chart_type') return 'line';
            if (key === 'dashboard_group_by') return 'log_name';
            return null;
        });

        const dashboard = new Dashboard(container);
        await vi.waitFor(() => {
            dashboard.render();
            // @ts-expect-error - accessing private state
            if (!dashboard.state.isInitialized) throw new Error('Not initialized');
        });

        const initialChartChange = vi.mocked(ActivityCharts).mock.calls[0]?.[2] as ((params: Record<string, unknown>) => void) | undefined;
        expect(initialChartChange).toBeTypeOf('function');
        initialChartChange?.({ timeRangeDays: 30, timeRangeOffset: 2, metric: 'characters' });

        const onDateSelect = vi.mocked(HeatmapView).mock.calls[0]?.[3] as ((dateStr: string) => void) | undefined;
        expect(onDateSelect).toBeTypeOf('function');
        onDateSelect?.(clickedDate);

        const expectedOffset = getWeeklyOffset(clickedDate);
        const latestChartState = vi.mocked(ActivityCharts).mock.calls.at(-1)?.[1];

        expect(latestChartState).toMatchObject({
            timeRangeDays: 7,
            timeRangeOffset: expectedOffset,
            chartType: 'line',
            groupByMode: 'log_name',
            metric: 'characters'
        });

        // @ts-expect-error - accessing private state
        expect(dashboard.state.chartParams).toMatchObject({
            timeRangeDays: 7,
            timeRangeOffset: expectedOffset,
            metric: 'characters'
        });
    });
});

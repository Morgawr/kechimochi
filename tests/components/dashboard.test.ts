import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dashboard } from '../../src/components/dashboard';
import * as api from '../../src/api';
import { ActivityLog } from '../../src/api';
import { customConfirm } from '../../src/modals';

vi.mock('../../src/api', () => ({
    getLogs: vi.fn(),
    getHeatmap: vi.fn(),
    getAllMedia: vi.fn(),
    deleteLog: vi.fn(),
}));

vi.mock('../../src/modals', () => ({
    customConfirm: vi.fn(),
    showAddMediaModal: vi.fn(),
}));

vi.mock('../../src/components/dashboard/StatsCard');
vi.mock('../../src/components/dashboard/HeatmapView');
vi.mock('../../src/components/dashboard/ActivityCharts');

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
        const mockLog = { id: 1, title: 'T', media_id: 1, duration_minutes: 10, date: '2024-01-01', media_type: 'Type', language: 'J' };
        const logs = Array.from({ length: 20 }, () => ({ ...mockLog }));
        vi.mocked(api.getLogs).mockResolvedValue(logs as unknown as ActivityLog[]);
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
        const logs = [{ id: 456, title: 'To Delete', media_id: 1, duration_minutes: 10, date: '2024-01-01', media_type: 'Type', language: 'J' }];
        vi.mocked(api.getLogs).mockResolvedValue(logs as unknown as ActivityLog[]);
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
});

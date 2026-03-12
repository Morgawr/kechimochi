import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileView } from '../../src/components/profile';
import * as api from '../../src/api';

vi.mock('../../src/api', () => ({
    getSetting: vi.fn(),
    getAppVersion: vi.fn(),
    getAllMedia: vi.fn(),
    listProfiles: vi.fn(),
    setSetting: vi.fn(),
    switchProfile: vi.fn(),
    getLogsForMedia: vi.fn(),
    importCsv: vi.fn(),
    exportCsv: vi.fn(),
    clearActivities: vi.fn(),
}));

vi.mock('../../src/utils/dialogs', () => ({
    open: vi.fn(),
    save: vi.fn(),
}));

vi.mock('../../src/modals', () => ({
    customAlert: vi.fn(),
    customConfirm: vi.fn(),
    customPrompt: vi.fn(),
    showExportCsvModal: vi.fn(),
}));

import * as modals from '../../src/modals';

describe('ProfileView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        
        // Mock localStorage
        const store: Record<string, string> = { 'kechimochi_profile': 'test-user' };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(key => store[key] || null),
            setItem: vi.fn((key, val) => store[key] = val),
        });
    });

    it('should load settings and render profile name', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'theme') return 'pastel-pink';
            if (key === 'stats_report_timestamp') return '2024-01-01T00:00:00Z';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.2.3');

        const view = new ProfileView(container);
        await view.render();

        expect(container.textContent).toContain('test-user');
        expect(container.textContent).toContain('v1.2.3');
        expect(container.textContent).toContain('Since 2024-01-01');
    });

    it('should change theme', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('dark');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');

        const view = new ProfileView(container);
        // We need to wait for loadData to finish which calls getSetting('stats_report_timestamp')
        // Since we mocked it to return 'dark', we must pass a valid date instead.
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'theme') return 'dark';
            if (key === 'stats_report_timestamp') return '';
            return '0';
        });

        await view.render();

        const select = container.querySelector('#profile-select-theme') as HTMLSelectElement;
        select.value = 'molokai';
        select.dispatchEvent(new Event('change'));

        expect(api.setSetting).toHaveBeenCalledWith('theme', 'molokai');
    });

    it('should calculate report', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getAllMedia).mockResolvedValue([{
            id: 1, title: 'M1', tracking_status: 'Complete', content_type: 'Novel', extra_data: '{"Character count":"10,000"}'
        }] as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{ date: new Date().toISOString().split('T')[0], duration_minutes: 60 }] as any);

        const view = new ProfileView(container);
        await view.render();

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith('stats_novel_speed', '10000'));
        expect(modals.customAlert).toHaveBeenCalledWith("Success", expect.stringContaining("calculated"));
    });

    it('should handle report calculation failure', async () => {
        vi.mocked(api.getAllMedia).mockRejectedValue(new Error('API Error'));
        const view = new ProfileView(container);
        await view.render();

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith("Error", expect.stringContaining("Failed")));
    });

    it('should handle different content types in report calculation', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([
            { id: 1, title: 'M1', tracking_status: 'Complete', content_type: 'Manga', extra_data: '{"Character count":"100"}' },
            { id: 2, title: 'VN', tracking_status: 'Complete', content_type: 'Visual Novel', extra_data: '{"Character count":"5000"}' }
        ] as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{ date: new Date().toISOString(), duration_minutes: 60 }] as any);

        const view = new ProfileView(container);
        await view.render();

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith('stats_manga_speed', '100'));
        expect(api.setSetting).toHaveBeenCalledWith('stats_vn_speed', '5000');
    });

    it('should clear activities on confirm', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const view = new ProfileView(container);
        await view.render();

        const clearBtn = container.querySelector('#profile-btn-clear-activities') as HTMLElement;
        await clearBtn.click();

        expect(modals.customConfirm).toHaveBeenCalled();
        expect(api.clearActivities).toHaveBeenCalled();
    });
});

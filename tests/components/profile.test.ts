import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileView } from '../../src/components/profile';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { STORAGE_KEYS, SETTING_KEYS } from '../../src/constants';
import { Logger } from '../../src/core/logger';

vi.mock('../../src/api', () => ({
    getSetting: vi.fn(),
    getAppVersion: vi.fn(),
    getProfilePicture: vi.fn(() => Promise.resolve(null)),
    uploadProfilePicture: vi.fn(),
    getAllMedia: vi.fn(),
    listProfiles: vi.fn(),
    setSetting: vi.fn(),
    switchProfile: vi.fn(),
    getLogsForMedia: vi.fn(),
    importCsv: vi.fn(),
    exportCsv: vi.fn(),
    clearActivities: vi.fn(),
    exportFullBackup: vi.fn(),
    importFullBackup: vi.fn(),
}));

const mockServices = {
    pickAndImportActivities: vi.fn(),
    exportActivities: vi.fn(),
    analyzeMediaCsvFromPick: vi.fn(),
    exportMediaLibrary: vi.fn(),
};

vi.mock('../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
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
    showBlockingStatus: vi.fn(() => ({ close: vi.fn() })),
}));

import * as modals from '../../src/modals';

describe('ProfileView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        
        // Mock localStorage
        const store: Record<string, string> = { [STORAGE_KEYS.CURRENT_PROFILE]: 'test-user' };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(key => store[key] || null),
            setItem: vi.fn((key, val) => store[key] = val),
            clear: vi.fn(() => {
                for (const key of Object.keys(store)) {
                    delete store[key];
                }
            }),
            removeItem: vi.fn((key) => delete store[key]),
        });
    });

    it('should load settings and render profile name', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '2024-01-01T00:00:00Z';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.2.3');

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.textContent).toContain('test-user'));
        expect(container.textContent).toContain('v1.2.3');
        expect(container.textContent).toContain('Since 2024-01-01');
    });

    it('should render profile picture preview when one exists', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.2.3');
        vi.mocked(api.getProfilePicture).mockResolvedValue({
            mime_type: 'image/png',
            base64_data: 'YWJj',
            byte_size: 3,
            width: 1,
            height: 1,
            updated_at: '2026-03-23T00:00:00Z',
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-hero-avatar img')).not.toBeNull());
    });

    it('should still render the profile view if profile picture loading fails', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.2.3');
        vi.mocked(api.getProfilePicture).mockRejectedValue(new Error('missing backend route'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-name')?.textContent).toBe('test-user'));
        expect(container.querySelector('#profile-hero-avatar img')).toBeNull();
    });

    it('should upload a profile picture by double-clicking the hero avatar', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.2.3');
        vi.mocked(api.uploadProfilePicture).mockResolvedValue({
            mime_type: 'image/png',
            base64_data: 'YWJj',
            byte_size: 3,
            width: 1,
            height: 1,
            updated_at: '2026-03-23T00:00:00Z',
        });

        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-hero-avatar')).not.toBeNull());

        container.querySelector('#profile-hero-avatar')?.dispatchEvent(new MouseEvent('dblclick'));
        await vi.waitFor(() => expect(api.uploadProfilePicture).toHaveBeenCalled());

        await vi.waitFor(() => expect(container.querySelector('#profile-hero-avatar img')).not.toBeNull());
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-updated' }));
    });

    it('should change theme', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('dark');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');

        const view = new ProfileView(container);
        // We need to wait for loadData to finish which calls getSetting('stats_report_timestamp')
        // Since we mocked it to return 'dark', we must pass a valid date instead.
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.THEME) return 'dark';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });

        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-select-theme')).not.toBeNull());

        const select = container.querySelector('#profile-select-theme') as HTMLSelectElement;
        select.value = 'molokai';
        select.dispatchEvent(new Event('change'));

        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.THEME, 'molokai');
    });

    it('should calculate report', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getAllMedia).mockResolvedValue([{
            id: 1, title: 'M1', tracking_status: 'Complete', content_type: 'Novel', extra_data: '{"Character count":"10,000"}'
        }] as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{ id: 1, media_id: 1, title: 'M1', media_type: 'Reading', language: 'Japanese', date: new Date().toISOString().split('T')[0], duration_minutes: 60, characters: 0 }] as unknown as api.ActivitySummary[]);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-calculate-report')).not.toBeNull());

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.STATS_NOVEL_SPEED, '10000'));
        expect(modals.customAlert).toHaveBeenCalledWith("Success", expect.stringContaining("calculated"));
    });

    it('should handle report calculation failure', async () => {
        vi.mocked(api.getAllMedia).mockRejectedValue(new Error('API Error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-calculate-report')).not.toBeNull());

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith("Error", expect.stringContaining("Failed")));
        consoleSpy.mockRestore();
    });

    it('should handle different content types in report calculation', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([
            { id: 1, title: 'M1', tracking_status: 'Complete', content_type: 'Manga', extra_data: '{"Character count":"100"}' },
            { id: 2, title: 'VN', tracking_status: 'Complete', content_type: 'Visual Novel', extra_data: '{"Character count":"5000"}' }
        ] as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{ id: 1, media_id: 1, title: 'M1', media_type: 'Reading', language: 'Japanese', date: new Date().toISOString(), duration_minutes: 60, characters: 0 }] as unknown as api.ActivitySummary[]);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-calculate-report')).not.toBeNull());

        const calcBtn = container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
        calcBtn.click();

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.STATS_MANGA_SPEED, '100'));
        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.STATS_VN_SPEED, '5000');
    });

    it('should clear activities on confirm', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-clear-activities')).not.toBeNull());

        const clearBtn = container.querySelector('#profile-btn-clear-activities') as HTMLElement;
        clearBtn.click();

        await vi.waitFor(() => {
            expect(modals.customConfirm).toHaveBeenCalled();
            expect(api.clearActivities).toHaveBeenCalled();
        });
    });

    it('should call exportFullBackup when export button is clicked', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.exportFullBackup).mockResolvedValue(true);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-export-full-backup')).not.toBeNull());

        const exportBtn = container.querySelector('#profile-btn-export-full-backup') as HTMLElement;
        exportBtn.click();

        await vi.waitFor(() => {
            expect(api.getAppVersion).toHaveBeenCalled();
            expect(api.exportFullBackup).toHaveBeenCalled();
            expect(modals.showBlockingStatus).toHaveBeenCalledWith("Exporting Full Backup", "Export in progress...");
            expect(modals.customAlert).toHaveBeenCalledWith("Success", "Full backup export completed.");
        });
    });

    it('should call importFullBackup when import button is clicked and confirmed', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.importFullBackup).mockResolvedValue('{"theme":"dark"}');

        // Mock window.location.reload
        const originalLocation = globalThis.location;
        Object.defineProperty(globalThis, 'location', {
            value: { reload: vi.fn() },
            configurable: true,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-import-full-backup')).not.toBeNull());

        const importBtn = container.querySelector('#profile-btn-import-full-backup') as HTMLElement;
        importBtn.click();

        await vi.waitFor(() => {
            expect(modals.customConfirm).toHaveBeenCalled();
            expect(api.importFullBackup).toHaveBeenCalled();
            expect(modals.customAlert).toHaveBeenCalledWith("Success", expect.stringContaining("imported"));
            expect(globalThis.location.reload).toHaveBeenCalled();
        });

        // Restore
        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            configurable: true,
        });
        expect(localStorage.getItem('theme')).toBe('dark');
    });
});

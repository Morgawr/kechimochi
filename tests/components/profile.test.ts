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
    getSyncStatus: vi.fn(),
    connectGoogleDrive: vi.fn(),
    disconnectGoogleDrive: vi.fn(),
    listRemoteSyncProfiles: vi.fn(),
    previewAttachRemoteSyncProfile: vi.fn(),
    createRemoteSyncProfile: vi.fn(),
    attachRemoteSyncProfile: vi.fn(),
    runSync: vi.fn(),
    getSyncConflicts: vi.fn(),
    resolveSyncConflict: vi.fn(),
    subscribeSyncProgress: vi.fn(() => Promise.resolve(() => undefined)),
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
    isDesktop: vi.fn(() => true),
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
    showSyncEnablementWizard: vi.fn(),
    showSyncAttachPreview: vi.fn(),
    showInstalledUpdateModal: vi.fn(() => Promise.resolve()),
    showAvailableUpdateModal: vi.fn(() => Promise.resolve()),
}));

import * as modals from '../../src/modals';

describe('ProfileView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        mockServices.isDesktop.mockReturnValue(true);
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        const globals = globalThis as Record<string, unknown>;
        globals.__APP_BUILD_CHANNEL__ = 'release';
        globals.__APP_RELEASE_STAGE__ = 'beta';
        vi.mocked(api.getSyncStatus).mockResolvedValue({
            state: 'disconnected',
            google_authenticated: false,
            sync_profile_id: null,
            profile_name: null,
            google_account_email: null,
            last_sync_at: null,
            device_name: null,
            conflict_count: 0,
        });
        vi.mocked(api.getSyncConflicts).mockResolvedValue([]);

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
        expect(container.textContent).toContain('Kechimochi BETA VERSION 1.2.3');
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

    it('should render update controls and forward update actions', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');

        const subscribe = vi.fn((listener: (state: unknown) => void) => {
            listener({
                checking: false,
                autoCheckEnabled: true,
                availableRelease: { version: '1.0.1' },
                installedVersion: '1.0.0',
                isSupported: true,
            });
            return vi.fn();
        });
        const updateManager = {
            getState: vi.fn(() => ({
                checking: false,
                autoCheckEnabled: true,
                availableRelease: { version: '1.0.1' },
                installedVersion: '1.0.0',
                isSupported: true,
            })),
            subscribe,
            setAutoCheckEnabled: vi.fn(() => Promise.resolve()),
            checkForUpdates: vi.fn(() => Promise.resolve(null)),
        };

        const view = new ProfileView(container, updateManager as never);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-check-updates')).not.toBeNull());
        expect(container.textContent).toContain('Latest available version:');

        const checkbox = container.querySelector('#profile-updates-auto-check') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
        expect(updateManager.setAutoCheckEnabled).toHaveBeenCalledWith(false);

        (container.querySelector('#profile-btn-check-updates') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(updateManager.checkForUpdates).toHaveBeenCalledWith({ manual: true }));
    });

    it('should render the Cloud Sync card when disconnected', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-sync-card')).not.toBeNull());
        expect(container.textContent).toContain('Cloud Sync');
        expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull();
    });

    it('should enable sync by creating a new remote profile', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce({
                state: 'disconnected',
                google_authenticated: false,
                sync_profile_id: null,
                profile_name: null,
                google_account_email: null,
                last_sync_at: null,
                device_name: null,
                conflict_count: 0,
            })
            .mockResolvedValueOnce({
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            });
        vi.mocked(api.connectGoogleDrive).mockResolvedValue({
            device_id: 'dev_1',
            google_account_email: 'sync@example.com',
            access_token_expires_at: null,
        });
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({ action: 'create_new' });
        vi.mocked(api.createRemoteSyncProfile).mockResolvedValue({
            sync_status: {
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            },
            safety_backup_path: '/home/testuser/pre_sync_backup.zip',
            published_snapshot_id: 'snap_1',
            lost_race: false,
            remote_changed: false,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.createRemoteSyncProfile).toHaveBeenCalled());
        expect(api.connectGoogleDrive).toHaveBeenCalled();
        expect(api.listRemoteSyncProfiles).toHaveBeenCalled();
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.showSyncEnablementWizard).toHaveBeenCalledWith([], 'sync@example.com');
        expect(modals.customAlert).toHaveBeenCalledWith('Cloud Sync Enabled', expect.stringContaining('Cloud Sync is now enabled'));
    });

    it('should offer reconnect when a sync profile is attached but Google auth is missing', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce({
                state: 'connected_clean',
                google_authenticated: false,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            })
            .mockResolvedValueOnce({
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            });
        vi.mocked(api.connectGoogleDrive).mockResolvedValue({
            device_id: 'dev_1',
            google_account_email: 'sync@example.com',
            access_token_expires_at: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-reconnect-sync')).not.toBeNull());
        expect(container.textContent).toContain('Reconnect Needed');
        expect(container.textContent).toContain('needs to be reconnected');

        (container.querySelector('#profile-btn-reconnect-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.connectGoogleDrive).toHaveBeenCalled());
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Google Drive Reconnected',
            expect.stringContaining('sync again now')
        ));
    });

    it('should subscribe to sync progress while attaching an existing cloud profile', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce({
                state: 'disconnected',
                google_authenticated: true,
                sync_profile_id: null,
                profile_name: null,
                google_account_email: 'sync@example.com',
                last_sync_at: null,
                device_name: null,
                conflict_count: 0,
            })
            .mockResolvedValueOnce({
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            });
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([{
            profile_id: 'prof_1',
            profile_name: 'test-user',
            snapshot_id: 'snap_1',
            remote_generation: 1,
            updated_at: '2026-04-02T00:00:00Z',
            last_writer_device_id: 'Desk',
        }]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({
            action: 'attach',
            profileId: 'prof_1',
        });
        vi.mocked(api.previewAttachRemoteSyncProfile).mockResolvedValue({
            profile_id: 'prof_1',
            profile_name: 'test-user',
            local_only_media_count: 0,
            remote_only_media_count: 0,
            matched_media_count: 3,
            potential_duplicate_titles: [],
            conflict_count: 0,
        });
        vi.mocked(modals.showSyncAttachPreview).mockResolvedValue(true);
        vi.mocked(api.attachRemoteSyncProfile).mockResolvedValue({
            sync_status: {
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            },
            safety_backup_path: '/home/testuser/pre_sync_backup.zip',
            published_snapshot_id: 'snap_2',
            lost_race: false,
            remote_changed: true,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.attachRemoteSyncProfile).toHaveBeenCalledWith('prof_1'));
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Attached',
            expect.stringContaining('The profile was attached successfully')
        );
    });

    it('should subscribe to sync progress while running sync', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus).mockResolvedValue({
            state: 'connected_clean',
            google_authenticated: true,
            sync_profile_id: 'prof_1',
            profile_name: 'test-user',
            google_account_email: 'sync@example.com',
            last_sync_at: '2026-04-02T00:00:00Z',
            device_name: 'Desk',
            conflict_count: 0,
        });
        vi.mocked(api.runSync).mockResolvedValue({
            sync_status: {
                state: 'connected_clean',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:10:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            },
            safety_backup_path: null,
            published_snapshot_id: 'snap_2',
            lost_race: false,
            remote_changed: true,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-run-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-run-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalled());
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.customAlert).toHaveBeenCalledWith(
            'Sync Complete',
            expect.stringContaining('Cloud Sync completed successfully')
        );
    });

    it('should show a setup message when Google OAuth is not configured', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Google Drive sync is not configured. Set `plugins.kechimochiSync.clientId` in src-tauri/tauri.conf.json or export KECHIMOCHI_GOOGLE_CLIENT_ID before launching the app.')
        );

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Setup Needed',
            expect.stringContaining('plugins.kechimochiSync.clientId')
        ));
    });

    it('should show a specific message when the configured Google OAuth client requires a secret', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Server returned error response: invalid_request: client_secret is missing.')
        );

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync OAuth Config Error',
            expect.stringContaining('plugins.kechimochiSync.clientSecret')
        ));
    });

    it('should time out the enable sync browser handoff and close the blocking modal', async () => {
        vi.useFakeTimers();
        const close = vi.fn();
        vi.mocked(modals.showBlockingStatus).mockReturnValue({ close });
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.connectGoogleDrive).mockImplementation(
            () => new Promise(() => undefined)
        );

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.advanceTimersByTimeAsync(60_000);

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Google Sign-In Timed Out',
            expect.stringContaining('try Enable Sync again')
        ));
        expect(close).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should show a specific timeout message when creating a cloud profile stalls', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.connectGoogleDrive).mockResolvedValue({
            device_id: 'dev_1',
            google_account_email: 'sync@example.com',
            access_token_expires_at: null,
        });
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({ action: 'create_new' });
        vi.mocked(api.createRemoteSyncProfile).mockRejectedValue(
            new Error('Google Drive request timed out. Please try again.')
        );

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Timed Out',
            expect.stringContaining('took too long to respond')
        ));
    });

    it('should show a busy message when a previous sync attempt still holds the lock', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Another sync operation is already in progress')
        );

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Busy',
            expect.stringContaining('previous sync attempt')
        ));
    });

    it('should show sync conflicts and resolve them from the profile card', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce({
                state: 'conflict_pending',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 1,
            })
            .mockResolvedValueOnce({
                state: 'dirty',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            });
        vi.mocked(api.getSyncConflicts).mockResolvedValue([{
            kind: 'media_field_conflict',
            media_uid: 'uid_1',
            field_name: 'title',
            base_value: null,
            local_value: 'Local Title',
            remote_value: 'Remote Title',
        }]);
        vi.mocked(api.resolveSyncConflict).mockResolvedValue({
            sync_status: {
                state: 'dirty',
                google_authenticated: true,
                sync_profile_id: 'prof_1',
                profile_name: 'test-user',
                google_account_email: 'sync@example.com',
                last_sync_at: '2026-04-02T00:00:00Z',
                device_name: 'Desk',
                conflict_count: 0,
            },
            safety_backup_path: null,
            published_snapshot_id: null,
            lost_race: false,
            remote_changed: false,
        });

        const view = new ProfileView(container);
        await view.loadData();
        view.setState({ showSyncConflicts: true });

        await vi.waitFor(() => expect(container.querySelector('[data-sync-resolution-kind="media_field"]')).not.toBeNull());
        (container.querySelector('[data-sync-resolution-kind="media_field"][data-sync-resolution-side="remote"]') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.resolveSyncConflict).toHaveBeenCalledWith(0, { kind: 'media_field', side: 'remote' }));
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'All Conflicts Resolved',
            expect.stringContaining('Run Sync Now')
        ));
    });

    it('should warn before renaming a synced profile', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'pastel-pink';
            if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return '';
            return '0';
        });
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getSyncStatus).mockResolvedValue({
            state: 'connected_clean',
            google_authenticated: true,
            sync_profile_id: 'prof_1',
            profile_name: 'test-user',
            google_account_email: 'sync@example.com',
            last_sync_at: '2026-04-02T00:00:00Z',
            device_name: 'Desk',
            conflict_count: 0,
        });
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull());
        container.querySelector('#profile-name')?.dispatchEvent(new MouseEvent('dblclick'));

        await vi.waitFor(() => expect(modals.customConfirm).toHaveBeenCalledWith(
            'Rename Synced Profile',
            expect.stringContaining('synced display name'),
            'btn-primary',
            'Continue'
        ));
        expect(container.querySelector('input[type="text"]')).not.toBeNull();
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

    it('should calculate report with case-insensitive character count keys', async () => {
        vi.mocked(api.getSetting).mockResolvedValue('0');
        vi.mocked(api.getAppVersion).mockResolvedValue('1.0.0');
        vi.mocked(api.getAllMedia).mockResolvedValue([{
            id: 1, title: 'M1', tracking_status: 'Complete', content_type: 'Novel', extra_data: '{"CHARACTER COUNT":"10,000"}'
        }] as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{
            id: 1,
            media_id: 1,
            title: 'M1',
            media_type: 'Reading',
            language: 'Japanese',
            date: new Date().toISOString().split('T')[0],
            duration_minutes: 60,
            characters: 0
        }] as unknown as api.ActivitySummary[]);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-calculate-report')).not.toBeNull());

        (container.querySelector('#profile-btn-calculate-report') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.STATS_NOVEL_SPEED, '10000'));
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { ProfileView } from '../../src/profile/ProfileView';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { STORAGE_KEYS, SETTING_KEYS } from '../../src/constants';
import { Logger } from '../../src/logger';
import {
    buildConnectedSyncStatus,
    buildGoogleDriveAuthSession,
    buildRemoteSyncProfileSummary,
    buildSyncActionResult,
    buildSyncAttachPreview,
    buildSyncStatus,
} from '../sync-fixtures';

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
    replaceLocalFromRemote: vi.fn(),
    forcePublishLocalAsRemote: vi.fn(),
    getSyncConflicts: vi.fn(),
    resolveSyncConflict: vi.fn(),
    subscribeSyncProgress: vi.fn(() => Promise.resolve(() => undefined)),
    getAllMedia: vi.fn(),
    listProfiles: vi.fn(),
    setSetting: vi.fn(),
    switchProfile: vi.fn(),
    getLogsForMedia: vi.fn(),
    applyMediaImport: vi.fn(),
    importMilestonesCsv: vi.fn(),
    exportMilestonesCsv: vi.fn(),
    importCsv: vi.fn(),
    exportCsv: vi.fn(),
    clearActivities: vi.fn(),
    wipeEverything: vi.fn(),
    exportFullBackup: vi.fn(),
    importFullBackup: vi.fn(),
    clearSyncBackups: vi.fn(),
    isDesktop: vi.fn(() => true),
    getLocalHttpApiStatus: vi.fn(),
    saveLocalHttpApiConfig: vi.fn(),
}));

const mockServices = {
    pickAndImportActivities: vi.fn(),
    exportActivities: vi.fn(),
    analyzeMediaCsvFromPick: vi.fn(),
    exportMediaLibrary: vi.fn(),
    isDesktop: vi.fn(() => true),
    supportsLocalHttpApi: vi.fn(() => true),
    supportsWindowControls: vi.fn(() => true),
};

vi.mock('../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

vi.mock('../../src/file_dialogs', () => ({
    open: vi.fn(),
    save: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({
    customAlert: vi.fn(),
    customConfirm: vi.fn(),
    customPrompt: vi.fn(),
    showBlockingStatus: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../../src/activity_modal', () => ({
    showExportCsvModal: vi.fn(),
}));

vi.mock('../../src/media/modal', () => ({
    showMediaCsvConflictModal: vi.fn(),
}));

vi.mock('../../src/sync_modal', () => ({
    showSyncEnablementWizard: vi.fn(),
    showSyncAttachPreview: vi.fn(),
}));

import * as modalBase from '../../src/modal_base';
import * as activityModal from '../../src/activity_modal';
import * as mediaModal from '../../src/media/modal';
import * as syncModal from '../../src/sync_modal';
const modals = { ...modalBase, ...activityModal, ...mediaModal, ...syncModal };

function mockStandardProfileLoad(options?: {
    appVersion?: string;
    profileName?: string;
    theme?: string;
    statsReportTimestamp?: string;
}) {
    const {
        appVersion = '1.0.0',
        profileName = 'test-user',
        theme = 'pastel-pink',
        statsReportTimestamp = '',
    } = options ?? {};

    vi.mocked(api.getSetting).mockImplementation(async (key) => {
        if (key === SETTING_KEYS.PROFILE_NAME) return profileName;
        if (key === SETTING_KEYS.THEME) return theme;
        if (key === SETTING_KEYS.STATS_REPORT_TIMESTAMP) return statsReportTimestamp;
        return '0';
    });
    vi.mocked(api.getAppVersion).mockResolvedValue(appVersion);
}

async function renderAndClickEnableSync(container: HTMLElement) {
    const view = new ProfileView(container);
    view.render();

    await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
    (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

    return view;
}

async function expectLatestAlert(title: string, message: string) {
    await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
        title,
        expect.stringContaining(message)
    ));
}

describe('ProfileView', () => {
    let container: HTMLElement;
    const SAFE_BACKUP_PATH = resolve(process.cwd(), 'e2e', 'fixtures', 'recovery.zip');

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        mockServices.isDesktop.mockReturnValue(true);
        mockServices.supportsLocalHttpApi.mockReturnValue(true);
        mockServices.pickAndImportActivities.mockResolvedValue(null);
        mockServices.exportActivities.mockResolvedValue(null);
        mockServices.analyzeMediaCsvFromPick.mockResolvedValue(null);
        mockServices.exportMediaLibrary.mockResolvedValue(null);
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        const globals = globalThis as Record<string, unknown>;
        globals.__APP_BUILD_CHANNEL__ = 'release';
        globals.__APP_RELEASE_STAGE__ = 'beta';
        mockStandardProfileLoad();
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildSyncStatus());
        vi.mocked(api.getSyncConflicts).mockResolvedValue([]);
        vi.mocked(api.applyMediaImport).mockResolvedValue(0);
        vi.mocked(api.importMilestonesCsv).mockResolvedValue(0);
        vi.mocked(api.exportMilestonesCsv).mockResolvedValue(0);
        vi.mocked(api.exportFullBackup).mockResolvedValue(false);
        vi.mocked(api.importFullBackup).mockResolvedValue(null);
        vi.mocked(api.clearSyncBackups).mockResolvedValue();
        vi.mocked(api.disconnectGoogleDrive).mockResolvedValue();
        vi.mocked(api.wipeEverything).mockResolvedValue();
        vi.mocked(api.getLocalHttpApiStatus).mockResolvedValue({
            supported: true,
            enabled: false,
            running: false,
            bindHost: '127.0.0.1',
            port: 3031,
            scope: 'automation',
            allowedOrigins: [],
            url: null,
            lastError: null,
        });

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
        mockStandardProfileLoad({
            appVersion: '1.2.3',
            statsReportTimestamp: '2024-01-01T00:00:00Z',
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.textContent).toContain('test-user'));
        expect(container.textContent).toContain('Kechimochi BETA VERSION 1.2.3');
        expect(container.textContent).toContain('Since 2024-01-01');
    });

    it('should render profile picture preview when one exists', async () => {
        mockStandardProfileLoad({ appVersion: '1.2.3' });
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
        mockStandardProfileLoad({ appVersion: '1.2.3' });
        vi.mocked(api.getProfilePicture).mockRejectedValue(new Error('missing backend route'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-name')?.textContent).toBe('test-user'));
        expect(container.querySelector('#profile-hero-avatar img')).toBeNull();
    });

    it('should upload a profile picture by double-clicking the hero avatar', async () => {
        mockStandardProfileLoad({ appVersion: '1.2.3' });
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
        mockStandardProfileLoad({ theme: 'dark' });

        const view = new ProfileView(container);

        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-select-theme')).not.toBeNull());

        const select = container.querySelector('#profile-select-theme') as HTMLSelectElement;
        select.value = 'molokai';
        select.dispatchEvent(new Event('change'));

        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.THEME, 'molokai');
    });

    it('should render update controls and forward update actions', async () => {
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
        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-sync-card')).not.toBeNull());
        expect(container.textContent).toContain('Cloud Sync');
        expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull();
    });

    it('should enable sync by creating a new remote profile', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildSyncStatus())
            .mockResolvedValueOnce(buildConnectedSyncStatus());
        vi.mocked(api.connectGoogleDrive).mockResolvedValue(buildGoogleDriveAuthSession());
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({ action: 'create_new' });
        vi.mocked(api.createRemoteSyncProfile).mockResolvedValue(buildSyncActionResult({
            safety_backup_path: '/home/testuser/pre_sync_backup.zip',
            published_snapshot_id: 'snap_1',
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.createRemoteSyncProfile).toHaveBeenCalled());
        expect(api.connectGoogleDrive).toHaveBeenCalled();
        expect(api.listRemoteSyncProfiles).toHaveBeenCalled();
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.showSyncEnablementWizard).toHaveBeenCalledWith([], 'sync@example.com', undefined);
        expect(modals.customAlert).toHaveBeenCalledWith('Cloud Sync Enabled', expect.stringContaining('Cloud Sync is now enabled'));
    });

    it('should offer reconnect when a sync profile is attached but Google auth is missing', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildConnectedSyncStatus({ google_authenticated: false }))
            .mockResolvedValueOnce(buildConnectedSyncStatus());
        vi.mocked(api.connectGoogleDrive).mockResolvedValue(buildGoogleDriveAuthSession());

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
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildSyncStatus({
                google_authenticated: true,
                google_account_email: 'sync@example.com',
            }))
            .mockResolvedValueOnce(buildConnectedSyncStatus());
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([buildRemoteSyncProfileSummary()]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({
            action: 'attach',
            profileId: 'prof_1',
        });
        vi.mocked(api.previewAttachRemoteSyncProfile).mockResolvedValue(buildSyncAttachPreview());
        vi.mocked(modals.showSyncAttachPreview).mockResolvedValue(true);
        vi.mocked(api.attachRemoteSyncProfile).mockResolvedValue(buildSyncActionResult({
            safety_backup_path: '/home/testuser/pre_sync_backup.zip',
            published_snapshot_id: 'snap_2',
            remote_changed: true,
        }));

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
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        vi.mocked(api.runSync).mockResolvedValue(buildSyncActionResult({
            sync_status: { last_sync_at: '2026-04-02T00:10:00Z' },
            published_snapshot_id: 'snap_2',
            remote_changed: true,
        }));

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

    it('should simplify sync card details and hide generic device placeholders', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            state: 'dirty',
            google_account_email: null,
            device_name: 'Device',
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-sync-card')).not.toBeNull());

        expect(container.textContent).toContain('Unsynced Changes');
        expect(container.textContent).not.toContain('Unsynced local changes');
        expect(container.textContent).not.toContain('Google account');
        expect(container.textContent).not.toContain('Device name');
        expect(container.textContent).not.toContain('Current installation');
        expect(container.querySelector('#profile-btn-replace-local-from-remote')).toBeNull();

        (container.querySelector('#profile-btn-toggle-sync-recovery') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-replace-local-from-remote')).not.toBeNull());
    });

    it('should replace local data from remote after confirmation', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.replaceLocalFromRemote).mockResolvedValue(buildSyncActionResult({
            sync_status: { last_sync_at: '2026-04-02T00:20:00Z' },
            safety_backup_path: SAFE_BACKUP_PATH,
            remote_changed: true,
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-toggle-sync-recovery')).not.toBeNull());
        (container.querySelector('#profile-btn-toggle-sync-recovery') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-replace-local-from-remote')).not.toBeNull());
        (container.querySelector('#profile-btn-replace-local-from-remote') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.replaceLocalFromRemote).toHaveBeenCalled());
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.customAlert).toHaveBeenCalledWith(
            'Local Recovery Complete',
            expect.stringContaining('latest cloud snapshot')
        );
    });

    it('should force publish local data after confirmation', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({ state: 'dirty' }));
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.forcePublishLocalAsRemote).mockResolvedValue(buildSyncActionResult({
            sync_status: { last_sync_at: '2026-04-02T00:30:00Z' },
            safety_backup_path: SAFE_BACKUP_PATH,
            published_snapshot_id: 'snap_force_1',
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-toggle-sync-recovery')).not.toBeNull());
        (container.querySelector('#profile-btn-toggle-sync-recovery') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-force-publish-local')).not.toBeNull());
        (container.querySelector('#profile-btn-force-publish-local') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.forcePublishLocalAsRemote).toHaveBeenCalled());
        expect(api.subscribeSyncProgress).toHaveBeenCalled();
        expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Recovery Complete',
            expect.stringContaining('published as the new cloud snapshot')
        );
    });

    it('should show a setup message when Google OAuth is not configured', async () => {
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Google Drive sync is not configured for this build. Provide KECHIMOCHI_GOOGLE_CLIENT_ID and KECHIMOCHI_GOOGLE_CLIENT_SECRET in a private .env.local or release build environment before building the desktop app.')
        );

        await renderAndClickEnableSync(container);
        await expectLatestAlert('Cloud Sync Setup Needed', 'missing required authentication settings');
    });

    it('should show a specific message when the configured Google OAuth client requires a secret', async () => {
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Server returned error response: invalid_request: client_secret is missing.')
        );

        await renderAndClickEnableSync(container);
        await expectLatestAlert('Cloud Sync OAuth Config Error', 'missing part of its authentication setup');
    });

    it('should time out the enable sync browser handoff and close the blocking modal', async () => {
        vi.useFakeTimers();
        const close = vi.fn();
        vi.mocked(modals.showBlockingStatus).mockReturnValue({ close });
        vi.mocked(api.connectGoogleDrive).mockImplementation(
            () => new Promise(() => undefined)
        );

        await renderAndClickEnableSync(container);

        await vi.advanceTimersByTimeAsync(60_000);

        await expectLatestAlert('Google Sign-In Timed Out', 'try Enable Sync again');
        expect(close).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should show a specific timeout message when creating a cloud profile stalls', async () => {
        vi.mocked(api.connectGoogleDrive).mockResolvedValue(buildGoogleDriveAuthSession());
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({ action: 'create_new' });
        vi.mocked(api.createRemoteSyncProfile).mockRejectedValue(
            new Error('Google Drive request timed out. Please try again.')
        );

        await renderAndClickEnableSync(container);
        await expectLatestAlert('Cloud Sync Timed Out', 'took too long to respond');
    });

    it('should show a busy message when a previous sync attempt still holds the lock', async () => {
        vi.mocked(api.connectGoogleDrive).mockRejectedValue(
            new Error('Another sync operation is already in progress')
        );

        await renderAndClickEnableSync(container);
        await expectLatestAlert('Cloud Sync Busy', 'previous sync attempt');
    });

    it('should show sync conflicts and resolve them from the profile card', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildConnectedSyncStatus({
                state: 'conflict_pending',
                conflict_count: 1,
            }))
            .mockResolvedValueOnce(buildConnectedSyncStatus({
                state: 'dirty',
                conflict_count: 0,
            }));
        vi.mocked(api.getSyncConflicts).mockResolvedValue([{
            kind: 'media_field_conflict',
            media_uid: 'uid_1',
            field_name: 'title',
            base_value: null,
            local_value: 'Local Title',
            remote_value: 'Remote Title',
        }]);
        vi.mocked(api.resolveSyncConflict).mockResolvedValue(buildSyncActionResult({
            sync_status: { state: 'dirty', conflict_count: 0 },
        }));

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
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
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

    it('should show local backups size and allow clearing them', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            backup_size_bytes: 1024 * 1024 * 300.5, // 300.5 MB
        }));
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.clearSyncBackups).mockResolvedValue();

        const view = new ProfileView(container);
        await view.loadData();
        view.render();

        await vi.waitFor(() => expect(container.textContent).toContain('Local backups size'));
        expect(container.textContent).toContain('300.5 MB');

        const clearBtn = container.querySelector('#profile-btn-clear-sync-backups') as HTMLButtonElement;
        expect(clearBtn).not.toBeNull();
        clearBtn.click();

        await vi.waitFor(() => expect(modals.customConfirm).toHaveBeenCalledWith(
            "Clear Sync Backups",
            expect.stringContaining("delete all local emergency backups"),
            "btn-danger",
            "Clear"
        ));
        await vi.waitFor(() => expect(api.clearSyncBackups).toHaveBeenCalled());
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith("Success", "Sync backups cleared."));
    });

    it('renders the desktop-only sync card when sync is not available on web', async () => {
        mockServices.isDesktop.mockReturnValue(false);
        mockServices.supportsLocalHttpApi.mockReturnValue(false);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-sync-card')).not.toBeNull());
        expect(container.textContent).toContain('App Only');
        expect(container.textContent).toContain('Cloud Sync is only available in the app');
        expect(api.getSyncStatus).not.toHaveBeenCalled();
        expect(api.getLocalHttpApiStatus).not.toHaveBeenCalled();
        expect(container.querySelector('#profile-local-http-api-card')).toBeNull();
    });

    it('does not expose the HTTP API card on Android-style app runtimes', async () => {
        mockServices.isDesktop.mockReturnValue(true);
        mockServices.supportsLocalHttpApi.mockReturnValue(false);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-sync-card')).not.toBeNull());
        expect(api.getSyncStatus).toHaveBeenCalled();
        expect(api.getLocalHttpApiStatus).not.toHaveBeenCalled();
        expect(container.querySelector('#profile-local-http-api-card')).toBeNull();
    });

    it('renders HTTP API controls behind advanced settings', async () => {
        vi.mocked(api.getLocalHttpApiStatus).mockResolvedValue({
            supported: true,
            enabled: true,
            running: true,
            bindHost: '0.0.0.0',
            port: 3031,
            scope: 'full',
            allowedOrigins: ['https://example.com'],
            url: 'http://127.0.0.1:3031',
            lastError: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-local-http-api-card')).not.toBeNull());
        expect(container.querySelector('#profile-local-http-api-card h3')?.textContent).toBe('HTTP API');
        expect(container.textContent).not.toContain('Local HTTP API');
        const advanced = container.querySelector('#profile-local-api-advanced') as HTMLDetailsElement;
        expect(advanced).not.toBeNull();
        expect(advanced.open).toBe(false);
        const toggleSwitch = container.querySelector('#profile-toggle-local-http-api') as HTMLInputElement;
        expect(toggleSwitch).not.toBeNull();
        expect(toggleSwitch.checked).toBe(true);
        expect(toggleSwitch.getAttribute('role')).toBe('switch');
        expect(advanced.contains(toggleSwitch)).toBe(false);
        expect(container.querySelector('#profile-local-api-enabled')).toBeNull();
    });

    it('starts the HTTP API from the top-level switch', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.saveLocalHttpApiConfig).mockResolvedValue({
            supported: true,
            enabled: true,
            running: true,
            bindHost: '0.0.0.0',
            port: 3032,
            scope: 'full',
            allowedOrigins: ['https://example.com'],
            url: 'http://127.0.0.1:3032',
            lastError: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-toggle-local-http-api')).not.toBeNull());
        (container.querySelector('#profile-local-api-lan') as HTMLInputElement).checked = true;
        (container.querySelector('#profile-local-api-port') as HTMLInputElement).value = '3032';
        (container.querySelector('#profile-local-api-scope') as HTMLSelectElement).value = 'full';
        (container.querySelector('#profile-local-api-origins') as HTMLTextAreaElement).value = 'https://example.com';
        const toggleSwitch = container.querySelector('#profile-toggle-local-http-api') as HTMLInputElement;
        toggleSwitch.checked = true;
        toggleSwitch.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(api.saveLocalHttpApiConfig).toHaveBeenCalledWith({
            enabled: true,
            bindHost: '0.0.0.0',
            port: 3032,
            scope: 'full',
            allowedOrigins: ['https://example.com'],
        }));
        expect(modals.customConfirm).toHaveBeenCalledWith(
            'Enable HTTP API',
            expect.stringContaining('LAN access and Full API mode are enabled'),
            'btn-danger',
            'Enable API'
        );
    });

    it('saves advanced HTTP API settings without starting a stopped server', async () => {
        vi.mocked(api.saveLocalHttpApiConfig).mockResolvedValue({
            supported: true,
            enabled: false,
            running: false,
            bindHost: '0.0.0.0',
            port: 3032,
            scope: 'full',
            allowedOrigins: ['https://example.com'],
            url: null,
            lastError: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-save-local-http-api')).not.toBeNull());
        (container.querySelector('#profile-local-api-lan') as HTMLInputElement).checked = true;
        (container.querySelector('#profile-local-api-port') as HTMLInputElement).value = '3032';
        (container.querySelector('#profile-local-api-scope') as HTMLSelectElement).value = 'full';
        (container.querySelector('#profile-local-api-origins') as HTMLTextAreaElement).value = 'https://example.com';
        (container.querySelector('#profile-btn-save-local-http-api') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.saveLocalHttpApiConfig).toHaveBeenCalledWith({
            enabled: false,
            bindHost: '0.0.0.0',
            port: 3032,
            scope: 'full',
            allowedOrigins: ['https://example.com'],
        }));
        expect(modals.customConfirm).not.toHaveBeenCalled();
    });

    it('stops the HTTP API from the top-level switch', async () => {
        vi.mocked(api.getLocalHttpApiStatus).mockResolvedValue({
            supported: true,
            enabled: true,
            running: true,
            bindHost: '127.0.0.1',
            port: 3031,
            scope: 'automation',
            allowedOrigins: [],
            url: 'http://127.0.0.1:3031',
            lastError: null,
        });
        vi.mocked(api.saveLocalHttpApiConfig).mockResolvedValue({
            supported: true,
            enabled: false,
            running: false,
            bindHost: '127.0.0.1',
            port: 3031,
            scope: 'automation',
            allowedOrigins: [],
            url: null,
            lastError: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect((container.querySelector('#profile-toggle-local-http-api') as HTMLInputElement | null)?.checked).toBe(true));
        (container.querySelector('#profile-local-api-port') as HTMLInputElement).value = 'not-a-port';
        const toggleSwitch = container.querySelector('#profile-toggle-local-http-api') as HTMLInputElement;
        toggleSwitch.checked = false;
        toggleSwitch.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(api.saveLocalHttpApiConfig).toHaveBeenCalledWith({
            enabled: false,
            bindHost: '127.0.0.1',
            port: 3031,
            scope: 'automation',
            allowedOrigins: [],
        }));
        expect(modals.customConfirm).not.toHaveBeenCalled();
    });

    it('restarts the running HTTP API when advanced settings are saved', async () => {
        vi.mocked(api.getLocalHttpApiStatus).mockResolvedValue({
            supported: true,
            enabled: true,
            running: true,
            bindHost: '127.0.0.1',
            port: 3031,
            scope: 'automation',
            allowedOrigins: [],
            url: 'http://127.0.0.1:3031',
            lastError: null,
        });
        vi.mocked(api.saveLocalHttpApiConfig).mockResolvedValue({
            supported: true,
            enabled: true,
            running: true,
            bindHost: '127.0.0.1',
            port: 3033,
            scope: 'automation',
            allowedOrigins: [],
            url: 'http://127.0.0.1:3033',
            lastError: null,
        });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-save-local-http-api')).not.toBeNull());
        (container.querySelector('#profile-local-api-port') as HTMLInputElement).value = '3033';
        (container.querySelector('#profile-btn-save-local-http-api') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.saveLocalHttpApiConfig).toHaveBeenCalledWith({
            enabled: true,
            bindHost: '127.0.0.1',
            port: 3033,
            scope: 'automation',
            allowedOrigins: [],
        }));
    });

    it('renders an unavailable sync card when sync status loading fails', async () => {
        vi.mocked(api.getSyncStatus).mockRejectedValue(new Error('backend unavailable'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-refresh-sync-status')).not.toBeNull());
        expect(container.textContent).toContain('Unavailable');
        expect(container.textContent).toContain('backend unavailable');
    });

    it('shows a conflict loading error inside the sync card', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            state: 'conflict_pending',
            conflict_count: 2,
        }));
        vi.mocked(api.getSyncConflicts).mockRejectedValue(new Error('conflict endpoint failed'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.textContent).toContain('Failed to load pending conflicts'));
        expect(container.textContent).toContain('conflict endpoint failed');
    });

    it('renders every sync conflict shape and resolves a remaining conflict', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildConnectedSyncStatus({
                state: 'conflict_pending',
                conflict_count: 3,
            }))
            .mockResolvedValueOnce(buildConnectedSyncStatus({
                state: 'conflict_pending',
                conflict_count: 1,
            }));
        vi.mocked(api.getSyncConflicts).mockResolvedValue([
            {
                kind: 'extra_data_entry_conflict',
                media_uid: 'uid_extra',
                entry_key: 'Author',
                local_value: 'Local Author',
                remote_value: null,
            },
            {
                kind: 'delete_vs_update',
                media_uid: 'uid_delete',
                deleted_side: 'local',
                local_media: null,
                remote_media: { title: 'Remote Restored Title' },
                tombstone: { deleted_at: '2026-04-02T00:00:00Z' },
            },
            {
                kind: 'profile_picture_conflict',
                local_picture: null,
                remote_picture: {
                    mime_type: 'image/png',
                    base64_data: 'YWJj',
                    byte_size: 3,
                    width: 12,
                    height: 24,
                    updated_at: '2026-04-02T00:00:00Z',
                },
            },
        ] as never);
        vi.mocked(api.resolveSyncConflict).mockResolvedValue(buildSyncActionResult({
            sync_status: { state: 'conflict_pending', conflict_count: 1 },
        }));

        const view = new ProfileView(container);
        await view.loadData();
        view.setState({ showSyncConflicts: true });

        await vi.waitFor(() => expect(container.textContent).toContain('Extra data entry conflict'));
        expect(container.textContent).toContain('Discard entry');
        expect(container.textContent).toContain('Delete vs update conflict');
        expect(container.textContent).toContain('Remote Restored Title');
        expect(container.textContent).toContain('Profile picture conflict');
        expect(container.textContent).toContain('12x24 image/png');

        (container.querySelector('[data-sync-resolution-kind="extra_data_entry"][data-sync-resolution-side="remote"]') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.resolveSyncConflict).toHaveBeenCalledWith(0, {
            kind: 'extra_data_entry',
            side: 'remote',
        }));
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Conflict Resolved',
            expect.stringContaining('1 conflict still need review'),
        ));
    });

    it('ignores invalid sync conflict resolution buttons', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            state: 'conflict_pending',
            conflict_count: 1,
        }));
        vi.mocked(api.getSyncConflicts).mockResolvedValue([{
            kind: 'media_field_conflict',
            media_uid: 'uid_1',
            field_name: 'title',
            base_value: null,
            local_value: 'Local',
            remote_value: 'Remote',
        }]);

        const view = new ProfileView(container);
        await view.loadData();
        view.setState({ showSyncConflicts: true });

        const invalidIndex = document.createElement('button');
        invalidIndex.dataset.syncConflictIndex = 'not-a-number';
        container.querySelector('#profile-root')?.appendChild(invalidIndex);
        invalidIndex.click();

        const invalidKind = document.createElement('button');
        invalidKind.dataset.syncConflictIndex = '0';
        invalidKind.dataset.syncResolutionKind = 'unknown';
        invalidKind.dataset.syncResolutionSide = 'local';
        container.querySelector('#profile-root')?.appendChild(invalidKind);
        invalidKind.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api.resolveSyncConflict).not.toHaveBeenCalled();
    });

    it('surfaces sync conflict, lost race, and reconnect-needed outcomes while running sync', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        vi.mocked(api.runSync)
            .mockResolvedValueOnce(buildSyncActionResult({
                sync_status: { state: 'conflict_pending', conflict_count: 2 },
            }))
            .mockResolvedValueOnce(buildSyncActionResult({
                sync_status: { state: 'dirty' },
                lost_race: true,
            }))
            .mockRejectedValueOnce(new Error('Google Drive is not authenticated'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-run-sync')).not.toBeNull());
        const runButton = () => container.querySelector('#profile-btn-run-sync') as HTMLButtonElement;

        runButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Conflicts Need Review',
            expect.stringContaining('2 conflicts'),
        ));

        runButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Sync Needs Another Pass',
            expect.stringContaining('newer snapshot first'),
        ));

        runButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Google Drive Reconnect Needed',
            expect.stringContaining('no longer authenticated'),
        ));
    });

    it('handles recovery confirmation and failure branches', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({ state: 'dirty' }));
        vi.mocked(modals.customConfirm)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        vi.mocked(api.replaceLocalFromRemote).mockRejectedValue(new Error('replace failed'));
        vi.mocked(api.forcePublishLocalAsRemote).mockResolvedValue(buildSyncActionResult({
            sync_status: { state: 'dirty' },
            lost_race: true,
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-toggle-sync-recovery')).not.toBeNull());
        (container.querySelector('#profile-btn-toggle-sync-recovery') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-replace-local-from-remote')).not.toBeNull());

        (container.querySelector('#profile-btn-replace-local-from-remote') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api.replaceLocalFromRemote).not.toHaveBeenCalled();

        (container.querySelector('#profile-btn-replace-local-from-remote') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Recovery Failed',
            expect.stringContaining('replace failed'),
        ));

        (container.querySelector('#profile-btn-force-publish-local') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Recovery Needs Another Attempt',
            expect.stringContaining('newer snapshot'),
        ));
    });

    it('disconnects cloud sync and handles cancellation and errors', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        vi.mocked(modals.customConfirm)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        vi.mocked(api.disconnectGoogleDrive)
            .mockResolvedValueOnce()
            .mockRejectedValueOnce(new Error('disconnect failed'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-disconnect-sync')).not.toBeNull());
        const disconnectButton = () => container.querySelector('#profile-btn-disconnect-sync') as HTMLButtonElement;

        disconnectButton().click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api.disconnectGoogleDrive).not.toHaveBeenCalled();

        disconnectButton().click();
        await vi.waitFor(() => expect(api.disconnectGoogleDrive).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Disconnected',
            expect.stringContaining('disconnected from this device'),
        ));

        disconnectButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Error',
            expect.stringContaining('disconnect failed'),
        ));
    });

    it('renames a profile via keyboard and cancels rename on escape', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildSyncStatus());

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull());
        container.querySelector('#profile-name')?.dispatchEvent(new MouseEvent('dblclick'));
        const input = container.querySelector('input[type="text"]') as HTMLInputElement;
        input.value = 'renamed-user';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        input.dispatchEvent(new Event('blur'));

        await vi.waitFor(() => expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.PROFILE_NAME, 'renamed-user'));
        expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.CURRENT_PROFILE, 'renamed-user');

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull());
        container.querySelector('#profile-name')?.dispatchEvent(new MouseEvent('dblclick'));
        const cancelInput = container.querySelector('input[type="text"]') as HTMLInputElement;
        cancelInput.value = 'ignored-user';
        cancelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await vi.waitFor(() => expect(container.querySelector('#profile-name')?.textContent).toBe('renamed-user'));
    });

    it('covers activity, media, milestone, backup, and avatar error paths', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildSyncStatus());
        vi.mocked(mockServices.pickAndImportActivities).mockRejectedValueOnce(new Error('activity import failed'));
        vi.mocked(modals.showExportCsvModal)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ mode: 'range', start: '2026-01-01', end: '2026-01-31' });
        vi.mocked(mockServices.exportActivities).mockRejectedValueOnce(new Error('activity export failed'));
        vi.mocked(mockServices.analyzeMediaCsvFromPick)
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('media import failed'));
        vi.mocked(mockServices.exportMediaLibrary).mockRejectedValueOnce(new Error('media export failed'));
        vi.mocked(api.uploadProfilePicture).mockRejectedValueOnce(new Error('avatar failed'));
        vi.mocked(api.importMilestonesCsv).mockRejectedValueOnce(new Error('milestone import failed'));
        vi.mocked(api.exportMilestonesCsv).mockRejectedValueOnce(new Error('milestone export failed'));
        vi.mocked(api.exportFullBackup).mockRejectedValueOnce(new Error('backup export failed'));
        vi.mocked(modals.customConfirm).mockResolvedValueOnce(true);
        vi.mocked(api.importFullBackup).mockRejectedValueOnce(new Error('backup import failed'));

        const view = new ProfileView(container);
        view.render();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-import-csv')).not.toBeNull());

        (container.querySelector('#profile-btn-import-csv') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('activity import failed')));

        (container.querySelector('#profile-btn-export-csv') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.showExportCsvModal).toHaveBeenCalledTimes(1));
        (container.querySelector('#profile-btn-export-csv') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(mockServices.exportActivities).toHaveBeenCalledWith('2026-01-01', '2026-01-31'));
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('activity export failed')));

        (container.querySelector('#profile-btn-import-media') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Info', expect.stringContaining('No valid media rows')));
        (container.querySelector('#profile-btn-import-media') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('media import failed')));

        (container.querySelector('#profile-btn-export-media') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('media export failed')));

        container.querySelector('#profile-hero-avatar')?.dispatchEvent(new MouseEvent('dblclick'));
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('avatar failed')));

        (container.querySelector('#profile-btn-import-milestones') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('milestone import failed')));

        (container.querySelector('#profile-btn-export-milestones') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('milestone export failed')));

        (container.querySelector('#profile-btn-export-full-backup') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('backup export failed')));

        (container.querySelector('#profile-btn-import-full-backup') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('backup import failed')));
    });

    it('supports local theme overrides from the profile controls', async () => {
        localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, '1');
        localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE, 'dark');
        mockStandardProfileLoad({ theme: 'pastel-pink' });

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-select-theme-local')).not.toBeNull());

        const localSelect = container.querySelector('#profile-select-theme-local') as HTMLSelectElement;
        localSelect.value = 'molokai';
        localSelect.dispatchEvent(new Event('change'));

        expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.THEME_OVERRIDE, 'molokai');
        expect(document.body.dataset.theme).toBe('molokai');

        const checkbox = container.querySelector('#profile-checkbox-theme-override') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(container.querySelector('#profile-select-theme-local')).toBeNull());
        expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, '0');
        expect(document.body.dataset.theme).toBe('pastel-pink');
    });

    it('renders edge-case sync status labels and timestamps', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            state: 'error',
            last_sync_at: 'not-a-date',
        }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.textContent).toContain('Error'));
        expect(container.textContent).toContain('Retry Sync');
        expect(container.textContent).toContain('not-a-date');
    });

    it('disconnects a Google account that is not attached to a sync profile', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildSyncStatus({
            google_authenticated: true,
            google_account_email: 'sync@example.com',
        }));
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-disconnect-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-disconnect-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customConfirm).toHaveBeenCalledWith(
            'Disconnect Cloud Sync',
            'Disconnecting will remove the saved Google account from this device.',
            'btn-danger',
            'Disconnect',
        ));
        await vi.waitFor(() => expect(api.disconnectGoogleDrive).toHaveBeenCalled());
    });

    it('handles successful import and export actions', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildSyncStatus());
        vi.mocked(mockServices.pickAndImportActivities).mockResolvedValueOnce(3);
        vi.mocked(modals.showExportCsvModal).mockResolvedValueOnce({ mode: 'all' });
        vi.mocked(mockServices.exportActivities).mockResolvedValueOnce(4);
        vi.mocked(mockServices.analyzeMediaCsvFromPick).mockResolvedValueOnce([
            { row: { title: 'CSV Title' }, existing: null, conflicts: [] },
        ] as never);
        vi.mocked(modals.showMediaCsvConflictModal).mockResolvedValueOnce([
            { title: 'CSV Title' },
        ] as never);
        vi.mocked(api.applyMediaImport).mockResolvedValueOnce(1);
        vi.mocked(mockServices.exportMediaLibrary).mockResolvedValueOnce(2);
        vi.mocked(api.importMilestonesCsv).mockResolvedValueOnce(5);
        vi.mocked(api.exportMilestonesCsv).mockResolvedValueOnce(6);

        const view = new ProfileView(container);
        view.render();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-import-csv')).not.toBeNull());

        (container.querySelector('#profile-btn-import-csv') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('3 activity logs')));

        (container.querySelector('#profile-btn-export-csv') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(mockServices.exportActivities).toHaveBeenCalledWith());
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('4 activity logs')));

        (container.querySelector('#profile-btn-import-media') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.applyMediaImport).toHaveBeenCalled());
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('1 media library entries')));

        (container.querySelector('#profile-btn-export-media') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('2 media library entries')));

        (container.querySelector('#profile-btn-import-milestones') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('5 milestones')));

        (container.querySelector('#profile-btn-export-milestones') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Success', expect.stringContaining('6 milestones')));
    });

    it('handles destructive maintenance edge cases', async () => {
        const reload = vi.fn();
        const originalLocation = globalThis.location;
        Object.defineProperty(globalThis, 'location', {
            value: { reload },
            configurable: true,
        });
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            backup_size_bytes: 1024,
        }));
        vi.mocked(modals.customConfirm)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        vi.mocked(api.clearSyncBackups).mockRejectedValueOnce(new Error('clear failed'));
        vi.mocked(api.importFullBackup).mockResolvedValueOnce('{not valid json');
        vi.mocked(modals.customPrompt).mockResolvedValueOnce('WIPE_EVERYTHING');

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-toggle-sync-recovery')).not.toBeNull());
        const clearBackups = container.querySelector('#profile-btn-clear-sync-backups') as HTMLButtonElement;
        clearBackups.click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith('Error', expect.stringContaining('clear failed')));

        (container.querySelector('#profile-btn-import-full-backup') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith(
            'Failed to parse or apply local storage from backup',
            expect.any(Error),
        ));
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

        (container.querySelector('#profile-btn-wipe-everything') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.wipeEverything).toHaveBeenCalled());
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.CURRENT_PROFILE);
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.THEME_OVERRIDE_ENABLED);
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.THEME_OVERRIDE);
        expect(reload).toHaveBeenCalledTimes(2);

        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            configurable: true,
        });
        loggerSpy.mockRestore();
    });

    it('covers sync enablement cancellations, attach notes, and generic errors', async () => {
        vi.mocked(api.connectGoogleDrive).mockResolvedValue(buildGoogleDriveAuthSession());
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([buildRemoteSyncProfileSummary()]);
        vi.mocked(modals.showSyncEnablementWizard)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ action: 'attach', profileId: 'prof_1' })
            .mockResolvedValueOnce({ action: 'attach', profileId: 'prof_1' });
        vi.mocked(api.previewAttachRemoteSyncProfile)
            .mockResolvedValueOnce(buildSyncAttachPreview({
                potential_duplicate_titles: ['Duplicate Title'],
            }))
            .mockResolvedValueOnce(buildSyncAttachPreview({
                conflict_count: 2,
            }));
        vi.mocked(modals.showSyncAttachPreview).mockResolvedValue(true);
        vi.mocked(api.attachRemoteSyncProfile)
            .mockResolvedValueOnce(buildSyncActionResult())
            .mockResolvedValueOnce(buildSyncActionResult({
                sync_status: { state: 'conflict_pending', conflict_count: 2 },
            }));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-enable-sync')).not.toBeNull());
        const enableButton = () => container.querySelector('#profile-btn-enable-sync') as HTMLButtonElement;

        enableButton().click();
        await vi.waitFor(() => expect(modals.showSyncEnablementWizard).toHaveBeenCalledTimes(1));
        expect(api.attachRemoteSyncProfile).not.toHaveBeenCalled();

        enableButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Attached',
            expect.stringContaining('Potential duplicate titles'),
        ));

        enableButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Attached',
            expect.stringContaining('2 conflicts need review'),
        ));

        vi.mocked(api.connectGoogleDrive).mockRejectedValueOnce('plain failure');
        enableButton().click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Error',
            expect.stringContaining('plain failure'),
        ));
    });

    it('cancels synced profile rename when confirmation is declined', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        vi.mocked(modals.customConfirm).mockResolvedValue(false);

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull());
        container.querySelector('#profile-name')?.dispatchEvent(new MouseEvent('dblclick'));

        await vi.waitFor(() => expect(modals.customConfirm).toHaveBeenCalledWith(
            'Rename Synced Profile',
            expect.stringContaining('synced display name'),
            'btn-primary',
            'Continue',
        ));
        expect(container.querySelector('input[type="text"]')).toBeNull();
    });

    it('handles reconnect and sync error branches from configured sync actions', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            google_authenticated: false,
        }));
        vi.mocked(api.connectGoogleDrive).mockRejectedValueOnce(new Error('reconnect failed'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-reconnect-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-reconnect-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Error',
            expect.stringContaining('reconnect failed'),
        ));
        await new Promise(resolve => setTimeout(resolve, 0));

        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus());
        view.setState({ syncStatus: buildConnectedSyncStatus() });
        vi.mocked(api.runSync).mockRejectedValueOnce(new Error('plain sync failed'));

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-run-sync')).not.toBeNull());
        (container.querySelector('#profile-btn-run-sync') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Sync Error',
            expect.stringContaining('plain sync failed'),
        ));
    });

    it('reconnects before shell sync and reports dirty sync completion notes', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            google_authenticated: false,
        }));
        vi.mocked(api.connectGoogleDrive).mockResolvedValue(buildGoogleDriveAuthSession());
        vi.mocked(api.runSync).mockResolvedValue(buildSyncActionResult({
            sync_status: { state: 'dirty' },
        }));

        const view = new ProfileView(container);

        await view.runSyncNowFromShell();

        expect(api.connectGoogleDrive).toHaveBeenCalled();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Sync Complete',
            expect.stringContaining('Local changes remain on this device'),
        ));
    });

    it('handles force-publish cancellation and failure branches', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({ state: 'dirty' }));
        vi.mocked(modals.customConfirm)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        vi.mocked(api.forcePublishLocalAsRemote).mockRejectedValueOnce(new Error('force failed'));

        const view = new ProfileView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#profile-btn-toggle-sync-recovery')).not.toBeNull());
        (container.querySelector('#profile-btn-toggle-sync-recovery') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-force-publish-local')).not.toBeNull());

        (container.querySelector('#profile-btn-force-publish-local') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api.forcePublishLocalAsRemote).not.toHaveBeenCalled();

        (container.querySelector('#profile-btn-force-publish-local') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Recovery Failed',
            expect.stringContaining('force failed'),
        ));
    });

    it('resolves delete-vs-update conflicts with a valid restore choice', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(buildConnectedSyncStatus({
                state: 'conflict_pending',
                conflict_count: 1,
            }))
            .mockResolvedValueOnce(buildConnectedSyncStatus());
        vi.mocked(api.getSyncConflicts).mockResolvedValue([{
            kind: 'delete_vs_update',
            media_uid: 'uid_restore',
            deleted_side: 'remote',
            local_media: { title: 'Local Restored Title' },
            remote_media: null,
            tombstone: { deleted_at: '2026-04-02T00:00:00Z' },
        }] as never);
        vi.mocked(api.resolveSyncConflict).mockResolvedValue(buildSyncActionResult({
            sync_status: { state: 'dirty', conflict_count: 0 },
        }));

        const view = new ProfileView(container);
        await view.loadData();
        view.setState({ showSyncConflicts: true });

        await vi.waitFor(() => expect(container.textContent).toContain('Local Restored Title'));
        (container.querySelector('[data-sync-resolution-kind="delete_vs_update"][data-sync-resolution-choice="restore"]') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.resolveSyncConflict).toHaveBeenCalledWith(0, {
            kind: 'delete_vs_update',
            choice: 'restore',
        }));
    });

    it('covers remaining conflict resolution and refresh failure guards', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(buildConnectedSyncStatus({
            state: 'conflict_pending',
            conflict_count: 2,
        }));
        vi.mocked(api.getSyncConflicts).mockResolvedValue([
            {
                kind: 'media_field_conflict',
                media_uid: 'uid_progress',
                field_name: 'progress',
                base_value: 1,
                local_value: { chapter: 4 },
                remote_value: { chapter: 5 },
            },
            {
                kind: 'delete_vs_update',
                media_uid: 'uid_remote_delete',
                deleted_side: 'remote',
                local_media: null,
                remote_media: null,
                tombstone: { deleted_at: '2026-04-02T00:00:00Z' },
            },
            {
                kind: 'profile_picture_conflict',
                local_picture: {
                    mime_type: 'image/png',
                    base64_data: 'YWJj',
                    byte_size: 3,
                    width: 8,
                    height: 8,
                    updated_at: '2026-04-02T00:00:00Z',
                },
                remote_picture: null,
            },
        ] as never);
        vi.mocked(api.resolveSyncConflict).mockRejectedValueOnce(new Error('resolve failed'));
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

        const view = new ProfileView(container);
        await view.loadData();
        view.setState({ showSyncConflicts: true });

        await vi.waitFor(() => expect(container.textContent).toContain('Progress conflict'));
        expect(container.textContent).toContain('"chapter": 4');
        expect(container.textContent).toContain('uid_remote_delete');
        expect(container.textContent).toContain('No picture');

        const missingKind = document.createElement('button');
        missingKind.dataset.syncConflictIndex = '0';
        container.querySelector('#profile-root')?.appendChild(missingKind);
        missingKind.click();

        const badChoice = document.createElement('button');
        badChoice.dataset.syncConflictIndex = '1';
        badChoice.dataset.syncResolutionKind = 'delete_vs_update';
        badChoice.dataset.syncResolutionChoice = 'bad_choice';
        container.querySelector('#profile-root')?.appendChild(badChoice);
        badChoice.click();

        const badSide = document.createElement('button');
        badSide.dataset.syncConflictIndex = '2';
        badSide.dataset.syncResolutionKind = 'profile_picture';
        badSide.dataset.syncResolutionSide = 'middle';
        container.querySelector('#profile-root')?.appendChild(badSide);
        badSide.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api.resolveSyncConflict).not.toHaveBeenCalled();

        (container.querySelector('[data-sync-resolution-kind="media_field"][data-sync-resolution-side="local"]') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith(
            'Conflict Resolution Failed',
            expect.stringContaining('resolve failed'),
        ));
        await new Promise(resolve => setTimeout(resolve, 0));

        vi.mocked(api.getSetting).mockRejectedValueOnce(new Error('refresh failed'));
        view.setState({ syncStatus: null, syncError: 'offline' });
        await vi.waitFor(() => expect(container.querySelector('#profile-btn-refresh-sync-status')).not.toBeNull());
        (container.querySelector('#profile-btn-refresh-sync-status') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith(
            'Failed to refresh sync data',
            expect.any(Error),
        ));
        loggerSpy.mockRestore();
    });

    it('removes the update listener when the profile view is destroyed', async () => {
        const unsubscribe = vi.fn();
        const updateManager = {
            getState: vi.fn(() => ({
                checking: false,
                autoCheckEnabled: true,
                availableRelease: null,
                installedVersion: '1.0.0',
                isSupported: true,
            })),
            subscribe: vi.fn(() => unsubscribe),
            setAutoCheckEnabled: vi.fn(),
            checkForUpdates: vi.fn(),
        };

        const view = new ProfileView(container, updateManager as never);
        view.triggerMount();
        view.destroy();

        expect(unsubscribe).toHaveBeenCalled();
    });
});

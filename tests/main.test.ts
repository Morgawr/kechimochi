import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '../src/api';
import { EVENTS, SETTING_KEYS } from '../src/constants';
import { Logger } from '../src/logger';
import {
    getMainModalMock,
    renderMainAppShell,
    resetMainApiMocks,
    resetMainModalMocks,
    setBuildGlobals,
    stubMainStorage,
} from './helpers/main_harness';

const modals = getMainModalMock();

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

const mockWindow = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    toggleMaximize: vi.fn(),
};

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => mockWindow),
}));

vi.mock('chart.js/auto', async () => {
    const { createChartJsAutoMock } = await import('./helpers/main_harness');
    return createChartJsAutoMock();
});

vi.mock('../src/api', async () => {
    const { createMainApiMock } = await import('./helpers/main_harness');
    return createMainApiMock();
});

vi.mock('../src/modal_base', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        customAlert: mocks.customAlert,
        customConfirm: mocks.customConfirm,
        customPrompt: mocks.customPrompt,
        showBlockingStatus: mocks.showBlockingStatus,
    };
});

vi.mock('../src/profile/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showInitialSetupPrompt: mocks.showInitialSetupPrompt,
    };
});

vi.mock('../src/activity_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showLogActivityModal: mocks.showLogActivityModal,
    };
});

vi.mock('../src/media/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showAddMediaModal: mocks.showAddMediaModal,
        showImportMergeModal: mocks.showImportMergeModal,
        showJitenSearchModal: mocks.showJitenSearchModal,
        showMediaCsvConflictModal: mocks.showMediaCsvConflictModal,
    };
});

vi.mock('../src/milestone_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showAddMilestoneModal: mocks.showAddMilestoneModal,
    };
});

vi.mock('../src/sync_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showSyncEnablementWizard: mocks.showSyncEnablementWizard,
        showSyncAttachPreview: mocks.showSyncAttachPreview,
    };
});

vi.mock('../src/update/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showInstalledUpdateModal: mocks.showInstalledUpdateModal,
        showAvailableUpdateModal: mocks.showAvailableUpdateModal,
    };
});

const createSyncStatusMock = (overrides: Partial<Awaited<ReturnType<typeof api.getSyncStatus>>> = {}) => ({
    state: 'dirty' as const,
    google_authenticated: true,
    sync_profile_id: 'prof_1',
    profile_name: 'Remote User',
    google_account_email: 'sync@example.com',
    last_sync_at: '2026-04-03T00:00:00Z',
    device_name: 'Desktop',
    conflict_count: 0,
    backup_size_bytes: 0,
    ...overrides,
});

describe('main.ts initialization', () => {
    const bootApp = async () => {
        const { App } = await import('../src/main');
        await App.start();
        await vi.waitFor(() => expect(api.initializeUserDb).toHaveBeenCalled());
    };

    const clickView = async (view: 'dashboard' | 'media' | 'timeline' | 'profile') => {
        const link = document.querySelector(`[data-view="${view}"]`);
        link?.dispatchEvent(new Event('click'));
        await vi.waitFor(() => expect(link?.classList.contains('active')).toBe(true));
        return link;
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        vi.spyOn(Logger, 'info').mockImplementation(() => {});
        resetMainApiMocks(api);
        resetMainModalMocks(modals);
        setBuildGlobals('0.1.0-dev.test', 'dev', 'beta');
        renderMainAppShell();
        stubMainStorage();
    });

    it('should initialize the App', async () => {
        await bootApp();
        expect(localStorage.getItem).toHaveBeenCalled();
    });

    it('continues startup when reading startup error state fails', async () => {
        vi.mocked(api.getStartupError).mockRejectedValueOnce(new Error('startup marker unavailable'));

        await bootApp();

        expect(Logger.warn).toHaveBeenCalledWith(
            '[kechimochi] Failed to read startup error state, continuing normal startup.',
            expect.any(Error),
        );
        expect(api.initializeUserDb).toHaveBeenCalled();
    });

    it('logs and continues when update manager initialization fails', async () => {
        const { App } = await import('../src/main');
        const manager = {
            getState: vi.fn(() => ({
                checking: false,
                autoCheckEnabled: true,
                availableRelease: null,
                installedVersion: '0.1.0',
                isSupported: true,
            })),
            subscribe: vi.fn(() => vi.fn()),
            initialize: vi.fn(() => Promise.reject(new Error('update init failed'))),
            openAvailableUpdateModal: vi.fn(),
        };

        await App.start(manager as never);

        await vi.waitFor(() => expect(manager.initialize).toHaveBeenCalled());
        expect(Logger.warn).toHaveBeenCalledWith(
            '[kechimochi] Failed to initialize update manager:',
            expect.any(Error),
        );
    });

    it('should keep the startup loader visible until the initial dashboard is ready', async () => {
        const logsDeferred = createDeferred<Awaited<ReturnType<typeof api.getLogs>>>();
        vi.mocked(api.getLogs).mockImplementation(() => logsDeferred.promise);

        const { App } = await import('../src/main');
        const startPromise = App.start();

        await vi.waitFor(() => expect(document.getElementById('app')?.dataset.bootState).toBe('loading'));
        expect(document.getElementById('app-startup-loader')).not.toBeNull();

        logsDeferred.resolve([]);

        await startPromise;
        await vi.waitFor(() => expect(document.getElementById('app')?.dataset.bootState).toBe('ready'));
    });

    it('creates a startup loader when the shell does not already include one', async () => {
        document.getElementById('app-startup-loader')?.remove();

        await bootApp();

        expect(document.getElementById('app-startup-loader')).not.toBeNull();
    });

    it('should not fetch inactive view data during startup', async () => {
        await bootApp();

        expect(api.getTimelineEvents).not.toHaveBeenCalled();
        expect(api.getLogsForMedia).not.toHaveBeenCalled();

        const requestedSettings = vi.mocked(api.getSetting).mock.calls.map(([key]) => key);
        expect(requestedSettings).not.toContain(SETTING_KEYS.GRID_HIDE_ARCHIVED);
        expect(requestedSettings).not.toContain(SETTING_KEYS.LIBRARY_LAYOUT_MODE);
    });

    it('should show the dev build badge by default', async () => {
        await bootApp();
        expect(document.getElementById('dev-build-badge')?.textContent).toBe('DEV BUILD 0.1.0-dev.test');
        expect(document.getElementById('mobile-build-badge')?.textContent).toBe('DEV BUILD 0.1.0-dev.test');
    });

    it('should show the beta release badge for release builds', async () => {
        setBuildGlobals('0.1.0', 'release', 'beta');

        await bootApp();

        expect(document.getElementById('dev-build-badge')?.textContent).toBe('BETA VERSION 0.1.0');
        expect(document.getElementById('mobile-build-badge')?.textContent).toBe('BETA VERSION 0.1.0');
    });

    it('should run sync from the mobile sync button when changes are pending', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock());

        await bootApp();

        (document.getElementById('mobile-sync-status-btn') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalled());
    });

    it('should run sync from the desktop nav sync button when changes are pending', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock());

        await bootApp();

        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalled());
    });

    it('marks sync chrome as conflict when pending conflicts are reported', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock({
            state: 'conflict_pending',
            conflict_count: 2,
        }));

        await bootApp();

        const navSyncButton = document.getElementById('nav-sync-status-btn') as HTMLButtonElement;
        await vi.waitFor(() => expect(navSyncButton.dataset.syncState).toBe('conflict'));
        expect(navSyncButton.title).toBe('Resolve 2 sync conflicts');
    });

    it('marks sync chrome as unavailable when sync status fails to load', async () => {
        vi.mocked(api.getSyncStatus).mockRejectedValue(new Error('sync unavailable'));

        await bootApp();
        globalThis.dispatchEvent(new Event(EVENTS.LOCAL_DATA_CHANGED));

        const navSyncButton = document.getElementById('nav-sync-status-btn') as HTMLButtonElement;
        await vi.waitFor(() => expect(navSyncButton.dataset.syncState).toBe('error'));
        expect(navSyncButton.title).toBe('Open cloud sync settings');
    });

    it('skips sync chrome updates when the shell has no sync controls', async () => {
        document.getElementById('nav-sync-status-btn')?.remove();
        document.getElementById('mobile-sync-status-btn')?.remove();

        const { App } = await import('../src/main');
        const manager = {
            getState: vi.fn(() => ({
                checking: false,
                autoCheckEnabled: true,
                availableRelease: null,
                installedVersion: '0.1.0',
                isSupported: true,
            })),
            subscribe: vi.fn(() => vi.fn()),
            initialize: vi.fn(() => Promise.resolve()),
            openAvailableUpdateModal: vi.fn(),
        };

        await App.start(manager as never);
        await vi.waitFor(() => expect(api.initializeUserDb).toHaveBeenCalled());
        expect(api.getSyncStatus).not.toHaveBeenCalled();
    });

    it('uses singular conflict copy for one pending sync conflict', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock({
            state: 'conflict_pending',
            conflict_count: 1,
        }));

        await bootApp();

        const navSyncButton = document.getElementById('nav-sync-status-btn') as HTMLButtonElement;
        await vi.waitFor(() => expect(navSyncButton.title).toBe('Resolve 1 sync conflict'));
    });

    it('marks sync chrome as disabled while syncing and as error when auth is missing', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock({
            state: 'syncing',
        }));

        await bootApp();

        const navSyncButton = document.getElementById('nav-sync-status-btn') as HTMLButtonElement;
        await vi.waitFor(() => expect(navSyncButton.dataset.syncState).toBe('syncing'));
        expect(navSyncButton.disabled).toBe(true);
        expect(navSyncButton.title).toBe('Cloud sync status');

        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock({
            state: 'connected_clean',
            google_authenticated: false,
        }));
        globalThis.dispatchEvent(new Event(EVENTS.LOCAL_DATA_CHANGED));

        await vi.waitFor(() => expect(navSyncButton.dataset.syncState).toBe('error'));
    });

    it('opens the profile view from sync chrome when sync cannot run immediately', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock({
            sync_profile_id: null,
            google_authenticated: false,
            state: 'disconnected',
        }));

        await bootApp();

        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();

        const profileLink = document.querySelector('[data-view="profile"]');
        await vi.waitFor(() => expect(profileLink?.classList.contains('active')).toBe(true));
    });

    it('refreshes the active view after running sync from shell chrome', async () => {
        vi.mocked(api.getSyncStatus).mockResolvedValue(createSyncStatusMock());

        await bootApp();

        await clickView('media');
        const mediaCalls = vi.mocked(api.getAllMedia).mock.calls.length;
        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(vi.mocked(api.getAllMedia).mock.calls.length).toBeGreaterThan(mediaCalls));

        await clickView('timeline');
        const timelineCalls = vi.mocked(api.getTimelineEvents).mock.calls.length;
        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(vi.mocked(api.getTimelineEvents).mock.calls.length).toBeGreaterThan(timelineCalls));

        await clickView('profile');
        const settingsCalls = vi.mocked(api.getSetting).mock.calls.length;
        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(api.runSync).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => expect(vi.mocked(api.getSetting).mock.calls.length).toBeGreaterThan(settingsCalls));
    });

    it('refreshes sync chrome when the shell sync action cannot read status', async () => {
        vi.mocked(api.getSyncStatus)
            .mockResolvedValueOnce(createSyncStatusMock())
            .mockResolvedValueOnce(createSyncStatusMock())
            .mockRejectedValueOnce(new Error('sync status failed'))
            .mockRejectedValueOnce(new Error('sync status failed'));

        await bootApp();

        (document.getElementById('nav-sync-status-btn') as HTMLButtonElement).click();

        const navSyncButton = document.getElementById('nav-sync-status-btn') as HTMLButtonElement;
        await vi.waitFor(() => expect(navSyncButton.dataset.syncState).toBe('error'));
    });


    it('should switch views', async () => {
        await bootApp();

        const mediaLink = await clickView('media');
        expect(mediaLink?.classList.contains('active')).toBe(true);

        const timelineLink = await clickView('timeline');
        expect(timelineLink?.classList.contains('active')).toBe(true);

        const profileLink = await clickView('profile');
        expect(profileLink?.classList.contains('active')).toBe(true);

        const dashboardLink = await clickView('dashboard');
        expect(dashboardLink?.classList.contains('active')).toBe(true);
    });

    it('should handle app-navigate event', async () => {
        await bootApp();

        globalThis.dispatchEvent(new CustomEvent('app-navigate', { 
            detail: { view: 'media', focusMediaId: 123 } 
        }));
        
        const mediaLink = document.querySelector('[data-view="media"]');
        await vi.waitFor(() => expect(mediaLink?.classList.contains('active')).toBe(true));
    });

    it('should initialize a new local profile from the first-run setup modal', async () => {
        vi.mocked(api.getSetting).mockResolvedValue(null);
        stubMainStorage(null);
        vi.mocked(modals.showInitialSetupPrompt).mockResolvedValue({ action: 'create_local', profileName: 'new-user' });
        
        await bootApp();
        
        await vi.waitFor(() => expect(modals.showInitialSetupPrompt).toHaveBeenCalled());
        expect(api.initializeUserDb).toHaveBeenCalledWith('new-user');
        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.PROFILE_NAME, 'new-user');
    });

    it('migrates a legacy localStorage profile when no stored profile setting exists', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.THEME) return 'dark';
            return null;
        });
        vi.mocked(api.shouldSkipLegacyLocalProfileMigration).mockResolvedValue(false);
        stubMainStorage('LEGACYUSER');

        await bootApp();

        expect(api.initializeUserDb).toHaveBeenCalledWith('LEGACYUSER');
        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.PROFILE_NAME, 'LEGACYUSER');
        expect(localStorage.setItem).toHaveBeenCalledWith('kechimochi_profile', 'LEGACYUSER');
    });

    it('falls back to first-run setup when reading the profile setting fails', async () => {
        let shouldThrowProfileLookup = true;
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME && shouldThrowProfileLookup) {
                shouldThrowProfileLookup = false;
                throw new Error('settings table missing');
            }
            if (key === SETTING_KEYS.THEME) return 'dark';
            return null;
        });
        stubMainStorage(null);
        vi.mocked(modals.showInitialSetupPrompt).mockResolvedValue({ action: 'create_local', profileName: 'fresh-user' });

        await bootApp();

        expect(Logger.info).toHaveBeenCalledWith(
            '[kechimochi] DB uninitialized (no settings table found), proceeding with fallback.',
            expect.any(Error),
        );
        expect(api.initializeUserDb).toHaveBeenCalledWith('fresh-user');
    });

    it('skips legacy profile migration when the backend says to ignore localStorage', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.THEME) return 'dark';
            return null;
        });
        vi.mocked(api.shouldSkipLegacyLocalProfileMigration).mockResolvedValue(true);
        stubMainStorage('LEGACYUSER');
        vi.mocked(modals.showInitialSetupPrompt).mockResolvedValue({ action: 'create_local', profileName: 'fresh-user' });

        await bootApp();

        expect(api.initializeUserDb).toHaveBeenCalledWith('fresh-user');
        expect(api.initializeUserDb).not.toHaveBeenCalledWith('LEGACYUSER');
    });

    it('loops back to local profile setup if cloud import setup is cancelled', async () => {
        vi.mocked(api.getSetting).mockResolvedValue(null);
        stubMainStorage(null);
        vi.mocked(modals.showInitialSetupPrompt)
            .mockResolvedValueOnce({ action: 'sync_remote' })
            .mockResolvedValueOnce({ action: 'create_local', profileName: 'fallback-user' });
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue(null);

        await bootApp();

        expect(modals.showInitialSetupPrompt).toHaveBeenCalledTimes(2);
        expect(api.initializeUserDb).toHaveBeenCalledWith('fallback-user');
        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.PROFILE_NAME, 'fallback-user');
    });

    it('shows a cloud sync error and retries setup when cloud import fails', async () => {
        vi.mocked(api.getSetting).mockResolvedValue(null);
        stubMainStorage(null);
        vi.mocked(modals.showInitialSetupPrompt)
            .mockResolvedValueOnce({ action: 'sync_remote' })
            .mockResolvedValueOnce({ action: 'create_local', profileName: 'fallback-user' });
        vi.mocked(api.connectGoogleDrive).mockRejectedValueOnce(new Error('oauth failed'));

        await bootApp();

        expect(modals.customAlert).toHaveBeenCalledWith(
            'Cloud Sync Error',
            expect.stringContaining('oauth failed'),
        );
        expect(api.initializeUserDb).toHaveBeenCalledWith('fallback-user');
    });

    it('should attach an existing cloud profile during first-run setup', async () => {
        let attached = false;
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) {
                return attached ? 'Remote User' : null;
            }
            if (key === SETTING_KEYS.THEME) return 'dark';
            return null;
        });
        stubMainStorage(null);
        vi.mocked(modals.showInitialSetupPrompt).mockResolvedValue({ action: 'sync_remote' });
        vi.mocked(api.listRemoteSyncProfiles).mockResolvedValue([{
            profile_id: 'prof_1',
            profile_name: 'Remote User',
            snapshot_id: 'snap_1',
            remote_generation: 1,
            updated_at: '2026-04-03T00:00:00Z',
            last_writer_device_id: 'Desktop',
        }]);
        vi.mocked(modals.showSyncEnablementWizard).mockResolvedValue({ action: 'attach', profileId: 'prof_1' });
        vi.mocked(api.attachRemoteSyncProfile).mockImplementation(async () => {
            attached = true;
            return {
                sync_status: {
                    state: 'connected_clean',
                    google_authenticated: true,
                    sync_profile_id: 'prof_1',
                    profile_name: 'Remote User',
                    google_account_email: 'sync@example.com',
                    last_sync_at: '2026-04-03T00:00:00Z',
                    device_name: 'Desktop',
                    conflict_count: 0,
                    backup_size_bytes: 0,
                },
                safety_backup_path: null,
                published_snapshot_id: 'snap_1',
                lost_race: false,
                remote_changed: false,
            };
        });

        await bootApp();

        expect(api.initializeUserDb).toHaveBeenCalledWith();
        expect(api.connectGoogleDrive).toHaveBeenCalled();
        expect(modals.showSyncEnablementWizard).toHaveBeenCalledWith(
            expect.any(Array),
            'sync@example.com',
            { allowCreateNew: false, title: 'Import From Google Drive' },
        );
        expect(api.previewAttachRemoteSyncProfile).toHaveBeenCalledWith('prof_1');
        expect(api.attachRemoteSyncProfile).toHaveBeenCalledWith('prof_1');
        await vi.waitFor(() => expect(document.getElementById('nav-user-name')?.textContent).toBe('Remote User'));
    });

    it('should handle global add activity button', async () => {
        await bootApp();
        
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        
        const addActivityBtn = document.getElementById('btn-add-activity');
        addActivityBtn?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(modals.showLogActivityModal).toHaveBeenCalled());
    });

    it('should block startup and show a user-facing error when the database is unsupported', async () => {
        vi.mocked(api.getStartupError).mockResolvedValue(
            'Kechimochi could not open this database safely.\n\nDatabase schema version 3 is newer than this app supports (2)'
        );

        const { App } = await import('../src/main');
        await App.start();

        expect(api.initializeUserDb).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(document.getElementById('alert-body')?.textContent).toContain(
            'Database schema version 3 is newer than this app supports (2)'
        ));
        expect(document.getElementById('alert-ok')).not.toBeNull();
    });

    it('should refresh timeline data after logging activity from the timeline view', async () => {
        await bootApp();

        expect(api.getTimelineEvents).not.toHaveBeenCalled();

        await clickView('timeline');
        await vi.waitFor(() => expect(api.getTimelineEvents).toHaveBeenCalled());
        const callsAfterNavigation = vi.mocked(api.getTimelineEvents).mock.calls.length;

        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        document.getElementById('btn-add-activity')?.dispatchEvent(new Event('click'));

        await vi.waitFor(() =>
            expect(vi.mocked(api.getTimelineEvents).mock.calls.length).toBeGreaterThan(callsAfterNavigation),
        );
    });

    it('should handle profile updated event', async () => {
        await bootApp();

        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'updated-user';
            return null;
        });
        globalThis.dispatchEvent(new Event('profile-updated'));

        await vi.waitFor(() => expect(document.getElementById('nav-user-name')?.textContent).toBe('updated-user'));
    });

    it('should show avatar image when a profile picture exists', async () => {
        vi.mocked(api.getProfilePicture).mockResolvedValue({
            mime_type: 'image/png',
            base64_data: 'YWJj',
            byte_size: 3,
            width: 1,
            height: 1,
            updated_at: '2026-03-23T00:00:00Z',
        });

        await bootApp();

        const img = document.getElementById('nav-user-avatar-image') as HTMLImageElement;
        await vi.waitFor(() => expect(img.style.display).toBe('block'));
        expect(img.src).toContain('data:image/png;base64,YWJj');
    });

    it('should fall back to initials when profile picture loading fails', async () => {
        vi.mocked(api.getProfilePicture).mockRejectedValue(new Error('missing backend route'));

        await bootApp();

        const fallback = document.getElementById('nav-user-avatar-fallback');
        const currentName = document.getElementById('nav-user-name')?.textContent ?? '';
        await vi.waitFor(() => expect(fallback?.textContent).toBe(currentName.slice(0, 2).toUpperCase()));
    });

    it('should handle window controls', async () => {
        await bootApp();

        const minBtn = document.getElementById('win-min');
        const maxBtn = document.getElementById('win-max');
        const closeBtn = document.getElementById('win-close');

        minBtn?.dispatchEvent(new Event('click'));
        maxBtn?.dispatchEvent(new Event('click'));
        closeBtn?.dispatchEvent(new Event('click'));

        const mockWindow = vi.mocked(getCurrentWindow)();
        expect(mockWindow.minimize).toHaveBeenCalled();
        expect(mockWindow.toggleMaximize).toHaveBeenCalled();
        expect(mockWindow.close).toHaveBeenCalled();
    });
});

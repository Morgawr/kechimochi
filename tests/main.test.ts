import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '../src/api';
import * as modals from '../src/modals';
import { SETTING_KEYS } from '../src/constants';
import { Logger } from '../src/core/logger';
import {
    renderMainAppShell,
    resetMainApiMocks,
    resetMainModalMocks,
    setBuildGlobals,
    stubMainStorage,
} from './helpers/main_harness';

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

vi.mock('../src/modals', async () => {
    const { createMainModalMock } = await import('./helpers/main_harness');
    return createMainModalMock();
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
    });

    it('should show the beta release badge for release builds', async () => {
        setBuildGlobals('0.1.0', 'release', 'beta');

        await bootApp();

        expect(document.getElementById('dev-build-badge')?.textContent).toBe('BETA VERSION 0.1.0');
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

    it('should resolve bundled asset URLs when loading a managed custom theme at startup', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
            if (key === SETTING_KEYS.THEME) return 'custom:bundle-theme';
            return null;
        });
        vi.mocked(api.getManagedThemePack).mockResolvedValue(JSON.stringify({
            version: 1,
            id: 'custom:bundle-theme',
            name: 'Bundle Theme',
            variables: {
                'surface-base': '#101010',
                'surface-card': '#202020',
                'surface-card-hover': '#303030',
                'text-primary': '#ffffff',
                'text-secondary': '#cccccc',
                'accent-primary': '#00ff88',
                'accent-primary-hover': '#22ffaa',
                'accent-danger': '#ff4466',
                'accent-interactive': '#4488ff',
                'accent-highlight': '#ffdd44',
                'accent-secondary': '#aa66ff',
                'border-subtle': '#444444',
                'shadow-soft': '0 2px 4px rgba(0,0,0,0.2)',
                'shadow-strong': '0 4px 12px rgba(0,0,0,0.4)',
                'heatmap-hue': '180',
                'heatmap-saturation-base': '40',
                'heatmap-saturation-range': '50',
                'heatmap-lightness-base': '45',
                'heatmap-lightness-range': '35',
                'accent-contrast': '#000000',
                'chart-series-1': '#111111',
                'chart-series-2': '#222222',
                'chart-series-3': '#333333',
                'chart-series-4': '#444444',
                'chart-series-5': '#555555'
            },
            background: {
                type: 'video',
                src: 'assets/bg.mp4',
                poster: 'assets/poster.webp'
            },
            fonts: [{
                family: 'Reload Sans',
                src: 'assets/reload.woff2',
                format: 'woff2'
            }],
        }));
        vi.mocked(api.resolveManagedThemeAssetUrl).mockImplementation(async (_themeId, assetPath) => `asset://${assetPath}`);

        await bootApp();

        expect(api.getManagedThemePack).toHaveBeenCalledWith('custom:bundle-theme');
        expect(api.resolveManagedThemeAssetUrl).toHaveBeenCalledWith('custom:bundle-theme', 'assets/bg.mp4');
        expect(api.resolveManagedThemeAssetUrl).toHaveBeenCalledWith('custom:bundle-theme', 'assets/poster.webp');
        expect(api.resolveManagedThemeAssetUrl).toHaveBeenCalledWith('custom:bundle-theme', 'assets/reload.woff2');
        const backdrop = document.getElementById('kechimochi-custom-theme-backdrop');
        expect(backdrop).not.toBeNull();
        expect((backdrop?.firstElementChild as HTMLVideoElement | null)?.src).toContain('asset://assets/bg.mp4');
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

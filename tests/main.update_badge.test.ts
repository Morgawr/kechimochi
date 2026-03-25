import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import { STORAGE_KEYS, SETTING_KEYS } from '../src/constants';
import type { UpdateState } from '../src/types';

vi.mock('../src/api', () => ({
    initializeUserDb: vi.fn(() => Promise.resolve()),
    getUsername: vi.fn(() => Promise.resolve('os-user')),
    getSetting: vi.fn((key) => {
        if (key === SETTING_KEYS.THEME) return Promise.resolve('dark');
        if (key === SETTING_KEYS.PROFILE_NAME) return Promise.resolve('test-user');
        return Promise.resolve(null);
    }),
    setSetting: vi.fn(() => Promise.resolve()),
    getProfilePicture: vi.fn(() => Promise.resolve(null)),
    getLogs: vi.fn(() => Promise.resolve([])),
    getAllMedia: vi.fn(() => Promise.resolve([])),
    getTimelineEvents: vi.fn(() => Promise.resolve([])),
    getHeatmap: vi.fn(() => Promise.resolve([])),
    getMilestones: vi.fn(() => Promise.resolve([])),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
    getLogsForMedia: vi.fn(() => Promise.resolve([])),
    clearMilestones: vi.fn(),
    deleteMilestone: vi.fn(),
}));

vi.mock('../src/modals', () => ({
    initialProfilePrompt: vi.fn(() => Promise.resolve('new-user')),
    customAlert: vi.fn(() => Promise.resolve()),
    customConfirm: vi.fn(() => Promise.resolve(false)),
    customPrompt: vi.fn(() => Promise.resolve(null)),
    showLogActivityModal: vi.fn(() => Promise.resolve(false)),
    showInstalledUpdateModal: vi.fn(() => Promise.resolve()),
    showAvailableUpdateModal: vi.fn(() => Promise.resolve()),
}));

vi.mock('chart.js/auto', () => ({
    default: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
        update: vi.fn(),
    })),
}));

describe('App update badge', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const globals = globalThis as Record<string, unknown>;
        globals.__APP_VERSION__ = '1.0.0';
        globals.__APP_BUILD_CHANNEL__ = 'release';
        globals.__APP_RELEASE_STAGE__ = 'beta';

        document.body.innerHTML = `
            <div id="view-container"></div>
            <div id="nav-user-avatar"></div>
            <img id="nav-user-avatar-image" />
            <span id="nav-user-avatar-fallback"></span>
            <span id="nav-user-name"></span>
            <div id="dev-build-badge"></div>
            <button id="update-available-badge" style="display: none;"></button>
            <div class="nav-link" data-view="dashboard"></div>
            <div class="nav-link" data-view="media"></div>
            <div class="nav-link" data-view="profile"></div>
            <button id="win-min"></button>
            <button id="win-max"></button>
            <button id="win-close"></button>
            <button id="btn-add-activity"></button>
        `;

        const store: Record<string, string> = { [STORAGE_KEYS.CURRENT_PROFILE]: 'test-user' };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(key => store[key] || null),
            setItem: vi.fn((key, val) => store[key] = val),
            removeItem: vi.fn((key) => delete store[key]),
        });
        vi.stubGlobal('sessionStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(() => {}),
        });
    });

    it('shows the update badge and opens the update modal when clicked', async () => {
        const { App } = await import('../src/main');
        const visibleState: UpdateState = {
            checking: false,
            autoCheckEnabled: true,
            availableRelease: {
                version: '1.0.1',
                body: '## [1.0.1]',
                url: 'https://example.com',
                publishedAt: '',
                prerelease: false,
            },
            installedVersion: '1.0.0',
            isSupported: true,
        };
        const manager = {
            getState: vi.fn(() => visibleState),
            subscribe: vi.fn((cb: (state: UpdateState) => void) => {
                cb(visibleState);
                return vi.fn();
            }),
            initialize: vi.fn(() => Promise.resolve()),
            openAvailableUpdateModal: vi.fn(() => Promise.resolve()),
        };

        await App.start(manager as never);

        const badge = document.getElementById('update-available-badge') as HTMLButtonElement;
        expect(badge.style.display).toBe('inline-flex');
        expect(badge.textContent).toContain('1.0.1');

        badge.click();
        expect(manager.openAvailableUpdateModal).toHaveBeenCalled();
        expect(api.initializeUserDb).toHaveBeenCalled();
    });
});

import { vi } from 'vitest';
import type * as api from '../../src/api';
import type { ActivitySummary } from '../../src/api';
import { STORAGE_KEYS, SETTING_KEYS } from '../../src/constants';
import type * as modals from '../../src/modals';

const defaultActivitySummary: ActivitySummary = {
    id: 0,
    date: '2024-01-01',
    duration_minutes: 0,
    title: 'T',
    media_id: 1,
    media_type: 'M',
    language: 'Japanese',
};

export function createMainApiMock() {
    return {
        initializeUserDb: vi.fn(() => Promise.resolve()),
        getUsername: vi.fn(() => Promise.resolve('os-user')),
        getStartupError: vi.fn(() => Promise.resolve(null)),
        getSetting: vi.fn((key: string) => Promise.resolve(getDefaultSettingValue(key))),
        setSetting: vi.fn(() => Promise.resolve()),
        getProfilePicture: vi.fn(() => Promise.resolve(null)),
        getLogs: vi.fn(() => Promise.resolve([defaultActivitySummary])),
        getLogsForMedia: vi.fn(() => Promise.resolve([])),
        getAllMedia: vi.fn(() => Promise.resolve([])),
        getTimelineEvents: vi.fn(() => Promise.resolve([])),
        getHeatmap: vi.fn(() => Promise.resolve([{ date: '2024-01-01', total_minutes: 10 }])),
        getMilestones: vi.fn(() => Promise.resolve([])),
        getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
        clearMilestones: vi.fn(),
        deleteMilestone: vi.fn(),
    };
}

export function createMainModalMock() {
    return {
        initialProfilePrompt: vi.fn(() => Promise.resolve('new-user')),
        customAlert: vi.fn(() => Promise.resolve()),
        customConfirm: vi.fn(() => Promise.resolve(false)),
        customPrompt: vi.fn(() => Promise.resolve(null)),
        showLogActivityModal: vi.fn(() => Promise.resolve(false)),
        showInstalledUpdateModal: vi.fn(() => Promise.resolve()),
        showAvailableUpdateModal: vi.fn(() => Promise.resolve()),
    };
}

export function createChartJsAutoMock() {
    return {
        default: vi.fn().mockImplementation(() => ({
            destroy: vi.fn(),
            update: vi.fn(),
        })),
    };
}

export function resetMainApiMocks(mockedApi: typeof api) {
    vi.mocked(mockedApi.initializeUserDb).mockResolvedValue();
    vi.mocked(mockedApi.getUsername).mockResolvedValue('os-user');
    vi.mocked(mockedApi.getStartupError).mockResolvedValue(null);
    vi.mocked(mockedApi.getSetting).mockImplementation(async (key) => getDefaultSettingValue(key));
    vi.mocked(mockedApi.setSetting).mockResolvedValue();
    vi.mocked(mockedApi.getProfilePicture).mockResolvedValue(null);
    vi.mocked(mockedApi.getLogs).mockResolvedValue([defaultActivitySummary]);
    vi.mocked(mockedApi.getLogsForMedia).mockResolvedValue([]);
    vi.mocked(mockedApi.getAllMedia).mockResolvedValue([]);
    vi.mocked(mockedApi.getTimelineEvents).mockResolvedValue([]);
    vi.mocked(mockedApi.getHeatmap).mockResolvedValue([{ date: '2024-01-01', total_minutes: 10 }]);
    vi.mocked(mockedApi.getMilestones).mockResolvedValue([]);
    vi.mocked(mockedApi.getAppVersion).mockResolvedValue('1.0.0');
    vi.mocked(mockedApi.clearMilestones).mockImplementation(() => {});
    vi.mocked(mockedApi.deleteMilestone).mockImplementation(() => {});
}

export function resetMainModalMocks(mockedModals: typeof modals) {
    vi.mocked(mockedModals.initialProfilePrompt).mockResolvedValue('new-user');
    vi.mocked(mockedModals.customAlert).mockResolvedValue();
    vi.mocked(mockedModals.customConfirm).mockResolvedValue(false);
    vi.mocked(mockedModals.customPrompt).mockResolvedValue(null);
    vi.mocked(mockedModals.showLogActivityModal).mockResolvedValue(false);
    vi.mocked(mockedModals.showInstalledUpdateModal).mockResolvedValue();
    vi.mocked(mockedModals.showAvailableUpdateModal).mockResolvedValue();
}

export function renderMainAppShell() {
    document.body.innerHTML = `
        <div id="app">
            <div id="desktop-title-bar"></div>
            <header>
                <div id="nav-user-avatar"></div>
                <img id="nav-user-avatar-image" />
                <span id="nav-user-avatar-fallback"></span>
                <span id="nav-user-name"></span>
                <div id="dev-build-badge"></div>
                <button id="update-available-badge"></button>
                <div class="nav-link" data-view="dashboard"></div>
                <div class="nav-link" data-view="media"></div>
                <div class="nav-link" data-view="timeline"></div>
                <div class="nav-link" data-view="profile"></div>
                <button id="win-min"></button>
                <button id="win-max"></button>
                <button id="win-close"></button>
                <button id="btn-add-activity"></button>
            </header>
            <div id="view-container"></div>
        </div>
    `;
}

export function setBuildGlobals(
    version: string,
    channel: 'dev' | 'release',
    releaseStage: 'beta' | 'stable',
) {
    const globals = globalThis as Record<string, unknown>;
    globals.__APP_VERSION__ = version;
    globals.__APP_BUILD_CHANNEL__ = channel;
    globals.__APP_RELEASE_STAGE__ = releaseStage;
}

export function stubMainStorage(currentProfile: string | null = 'test-user') {
    const store: Record<string, string> = currentProfile
        ? { [STORAGE_KEYS.CURRENT_PROFILE]: currentProfile }
        : {};

    vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
    });

    vi.stubGlobal('sessionStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {}),
    });

    return store;
}

function getDefaultSettingValue(key: string): string | null {
    if (key === SETTING_KEYS.THEME) return 'dark';
    if (key === SETTING_KEYS.PROFILE_NAME) return 'test-user';
    return null;
}

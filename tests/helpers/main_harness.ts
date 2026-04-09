import { vi } from 'vitest';
import { STORAGE_KEYS, SETTING_KEYS } from '../../src/constants';

type ActivitySummary = import('../../src/api').ActivitySummary;
type ApiModule = typeof import('../../src/api');
type ModalsModule = typeof import('../../src/modals');

const defaultActivitySummary: ActivitySummary = {
    id: 0,
    date: '2024-01-01',
    duration_minutes: 0,
    characters: 0,
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
        shouldSkipLegacyLocalProfileMigration: vi.fn(() => Promise.resolve(false)),
        getSetting: vi.fn((key: string) => Promise.resolve(getDefaultSettingValue(key))),
        setSetting: vi.fn(() => Promise.resolve()),
        getProfilePicture: vi.fn(() => Promise.resolve(null)),
        pickThemePackImportSelection: vi.fn(() => Promise.resolve(null)),
        importThemePackFromSelection: vi.fn(() => Promise.resolve({
            themeId: 'custom:test-theme',
            themeName: 'Test Theme',
            content: '{"name":"Theme"}',
            fileName: 'theme.json',
        })),
        pickThemePackExportSelection: vi.fn(() => Promise.resolve(null)),
        exportThemePackToSelection: vi.fn(() => Promise.resolve(true)),
        listManagedThemePackSummaries: vi.fn(() => Promise.resolve([])),
        getManagedThemePack: vi.fn(() => Promise.resolve(null)),
        resolveManagedThemeAssetUrl: vi.fn(() => Promise.resolve(null)),
        saveManagedThemePack: vi.fn(() => Promise.resolve()),
        deleteManagedThemePack: vi.fn(() => Promise.resolve()),
        getLogs: vi.fn(() => Promise.resolve([defaultActivitySummary])),
        getLogsForMedia: vi.fn(() => Promise.resolve([])),
        getAllMedia: vi.fn(() => Promise.resolve([])),
        getTimelineEvents: vi.fn(() => Promise.resolve([])),
        getHeatmap: vi.fn(() => Promise.resolve([{ date: '2024-01-01', total_minutes: 10, total_characters: 0 }])),
        getMilestones: vi.fn(() => Promise.resolve([])),
        getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
        connectGoogleDrive: vi.fn(() => Promise.resolve({
            device_id: 'dev_1',
            google_account_email: 'sync@example.com',
            access_token_expires_at: null,
        })),
        listRemoteSyncProfiles: vi.fn(() => Promise.resolve([])),
        previewAttachRemoteSyncProfile: vi.fn(() => Promise.resolve({
            profile_id: 'prof_1',
            profile_name: 'Remote User',
            local_only_media_count: 0,
            remote_only_media_count: 10,
            matched_media_count: 0,
            potential_duplicate_titles: [],
            conflict_count: 0,
        })),
        attachRemoteSyncProfile: vi.fn(() => Promise.resolve({
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
        })),
        subscribeSyncProgress: vi.fn(() => Promise.resolve(() => undefined)),
        clearMilestones: vi.fn(),
        deleteMilestone: vi.fn(),
    };
}

export function createMainModalMock() {
    return {
        showInitialSetupPrompt: vi.fn(() => Promise.resolve({ action: 'create_local', profileName: 'new-user' })),
        customAlert: vi.fn(() => Promise.resolve()),
        customConfirm: vi.fn(() => Promise.resolve(false)),
        customPrompt: vi.fn(() => Promise.resolve(null)),
        showLogActivityModal: vi.fn(() => Promise.resolve(false)),
        showSyncEnablementWizard: vi.fn(() => Promise.resolve(null)),
        showSyncAttachPreview: vi.fn(() => Promise.resolve(true)),
        showBlockingStatus: vi.fn(() => ({
            close: vi.fn(),
            setText: vi.fn(),
            setProgress: vi.fn(),
        })),
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

export function resetMainApiMocks(mockedApi: ApiModule) {
    vi.mocked(mockedApi.initializeUserDb).mockResolvedValue();
    vi.mocked(mockedApi.getUsername).mockResolvedValue('os-user');
    vi.mocked(mockedApi.getStartupError).mockResolvedValue(null);
    vi.mocked(mockedApi.shouldSkipLegacyLocalProfileMigration).mockResolvedValue(false);
    vi.mocked(mockedApi.getSetting).mockImplementation(async (key) => getDefaultSettingValue(key));
    vi.mocked(mockedApi.setSetting).mockResolvedValue();
    vi.mocked(mockedApi.getProfilePicture).mockResolvedValue(null);
    vi.mocked(mockedApi.pickThemePackImportSelection).mockResolvedValue(null);
    vi.mocked(mockedApi.importThemePackFromSelection).mockResolvedValue({
        themeId: 'custom:test-theme',
        themeName: 'Test Theme',
        content: '{"name":"Theme"}',
        fileName: 'theme.json',
    });
    vi.mocked(mockedApi.pickThemePackExportSelection).mockResolvedValue(null);
    vi.mocked(mockedApi.exportThemePackToSelection).mockResolvedValue(true);
    vi.mocked(mockedApi.listManagedThemePackSummaries).mockResolvedValue([]);
    vi.mocked(mockedApi.getManagedThemePack).mockResolvedValue(null);
    vi.mocked(mockedApi.resolveManagedThemeAssetUrl).mockResolvedValue(null);
    vi.mocked(mockedApi.saveManagedThemePack).mockResolvedValue();
    vi.mocked(mockedApi.deleteManagedThemePack).mockResolvedValue();
    vi.mocked(mockedApi.getLogs).mockResolvedValue([defaultActivitySummary]);
    vi.mocked(mockedApi.getLogsForMedia).mockResolvedValue([]);
    vi.mocked(mockedApi.getAllMedia).mockResolvedValue([]);
    vi.mocked(mockedApi.getTimelineEvents).mockResolvedValue([]);
    vi.mocked(mockedApi.getHeatmap).mockResolvedValue([{ date: '2024-01-01', total_minutes: 10, total_characters: 0 }]);
    vi.mocked(mockedApi.getMilestones).mockResolvedValue([]);
    vi.mocked(mockedApi.getAppVersion).mockResolvedValue('1.0.0');
    vi.mocked(mockedApi.connectGoogleDrive).mockResolvedValue({
        device_id: 'dev_1',
        google_account_email: 'sync@example.com',
        access_token_expires_at: null,
    });
    vi.mocked(mockedApi.listRemoteSyncProfiles).mockResolvedValue([]);
    vi.mocked(mockedApi.previewAttachRemoteSyncProfile).mockResolvedValue({
        profile_id: 'prof_1',
        profile_name: 'Remote User',
        local_only_media_count: 0,
        remote_only_media_count: 10,
        matched_media_count: 0,
        potential_duplicate_titles: [],
        conflict_count: 0,
    });
    vi.mocked(mockedApi.attachRemoteSyncProfile).mockResolvedValue({
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
    });
    vi.mocked(mockedApi.subscribeSyncProgress).mockResolvedValue(() => undefined);
    vi.mocked(mockedApi.clearMilestones).mockResolvedValue();
    vi.mocked(mockedApi.deleteMilestone).mockResolvedValue();
}

export function resetMainModalMocks(mockedModals: ModalsModule) {
    vi.mocked(mockedModals.showInitialSetupPrompt).mockResolvedValue({ action: 'create_local', profileName: 'new-user' });
    vi.mocked(mockedModals.customAlert).mockResolvedValue();
    vi.mocked(mockedModals.customConfirm).mockResolvedValue(false);
    vi.mocked(mockedModals.customPrompt).mockResolvedValue(null);
    vi.mocked(mockedModals.showLogActivityModal).mockResolvedValue(false);
    vi.mocked(mockedModals.showSyncEnablementWizard).mockResolvedValue(null);
    vi.mocked(mockedModals.showSyncAttachPreview).mockResolvedValue(true);
    vi.mocked(mockedModals.showBlockingStatus).mockReturnValue({
        close: vi.fn(),
        setText: vi.fn(),
        setProgress: vi.fn(),
    });
    vi.mocked(mockedModals.showInstalledUpdateModal).mockResolvedValue();
    vi.mocked(mockedModals.showAvailableUpdateModal).mockResolvedValue();
}

export function renderMainAppShell() {
    document.body.innerHTML = `
        <div id="app" data-boot-state="loading">
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
            <output id="app-startup-loader" class="app-startup-loader" aria-label="Loading">
                <span class="app-startup-loader__spinner" aria-hidden="true"></span>
            </output>
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareSemver, parseSemver, selectLatestEligibleRelease, UpdateManager } from '../../src/updates/manager';
import type { AppServices } from '../../src/services';
import * as api from '../../src/api';
import * as modals from '../../src/modals';
import { Logger } from '../../src/core/logger';

vi.mock('../../src/api', () => ({
    getSetting: vi.fn(),
    setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/modals', () => ({
    customAlert: vi.fn(() => Promise.resolve()),
    showInstalledUpdateModal: vi.fn(() => Promise.resolve()),
    showAvailableUpdateModal: vi.fn(() => Promise.resolve()),
}));

function createServices(): AppServices & { fetchExternalJson: ReturnType<typeof vi.fn> } {
    return {
        isDesktop: () => true,
        fetchExternalJson: vi.fn(),
        getAllMedia: vi.fn(),
        addMedia: vi.fn(),
        updateMedia: vi.fn(),
        deleteMedia: vi.fn(),
        addLog: vi.fn(),
        updateLog: vi.fn(),
        deleteLog: vi.fn(),
        getLogs: vi.fn(),
        getHeatmap: vi.fn(),
        getLogsForMedia: vi.fn(),
        initializeUserDb: vi.fn(),
        clearActivities: vi.fn(),
        wipeEverything: vi.fn(),
        getSetting: vi.fn(),
        setSetting: vi.fn(),
        getUsername: vi.fn(),
        getAppVersion: vi.fn(),
        getProfilePicture: vi.fn(),
        deleteProfilePicture: vi.fn(),
        pickAndImportActivities: vi.fn(),
        exportActivities: vi.fn(),
        analyzeMediaCsvFromPick: vi.fn(),
        exportMediaLibrary: vi.fn(),
        applyMediaImport: vi.fn(),
        pickAndExportFullBackup: vi.fn(),
        pickAndImportFullBackup: vi.fn(),
        getMilestones: vi.fn(),
        addMilestone: vi.fn(),
        updateMilestone: vi.fn(),
        deleteMilestone: vi.fn(),
        clearMilestones: vi.fn(),
        exportMilestonesCsv: vi.fn(),
        importMilestonesCsv: vi.fn(),
        pickAndUploadProfilePicture: vi.fn(),
        pickAndUploadCover: vi.fn(),
        downloadAndSaveImage: vi.fn(),
        loadCoverImage: vi.fn(),
        fetchRemoteBytes: vi.fn(),
        minimizeWindow: vi.fn(),
        maximizeWindow: vi.fn(),
        closeWindow: vi.fn(),
    };
}

describe('UpdateManager helpers', () => {
    it('parses and compares semantic versions', () => {
        expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
        expect(parseSemver('1.2')).toBeNull();
        expect(compareSemver('1.2.3', '1.2.2')).toBe(1);
        expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
        expect(compareSemver('1.2.3', '1.3.0')).toBe(-1);
    });

    it('selects the newest non-prerelease GitHub release with a valid semver tag', () => {
        expect(selectLatestEligibleRelease([
            { tag_name: 'v1.0.0', prerelease: false, draft: false, body: 'stable', html_url: 'https://example.com/1' },
            { tag_name: 'v1.2.0', prerelease: true, draft: false, body: 'beta', html_url: 'https://example.com/2' },
            { tag_name: 'v1.1.0', prerelease: false, draft: false, body: 'new', html_url: 'https://example.com/3' },
            { tag_name: 'nightly', prerelease: false, draft: false, body: 'skip', html_url: 'https://example.com/4' },
        ]))?.toMatchObject({
            version: '1.1.0',
            url: 'https://example.com/3',
        });
    });
});

describe('UpdateManager', () => {
    let services: AppServices & { fetchExternalJson: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        services = createServices();
        vi.clearAllMocks();
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        const globals = globalThis as Record<string, unknown>;
        globals.__APP_VERSION__ = '1.0.0';
        globals.__APP_BUILD_CHANNEL__ = 'release';
        globals.__APP_RELEASE_STAGE__ = 'beta';
        globals.__APP_RELEASE_NOTES__ = '## [1.0.0] - 2026-03-24\n\n### Added\n- Installed notes';
    });

    it('seeds the seen-version marker on fresh install without showing the installed-update modal', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_auto_check_enabled') return 'false';
            return null;
        });

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: true });

        expect(modals.showInstalledUpdateModal).not.toHaveBeenCalled();
        expect(api.setSetting).toHaveBeenCalledWith('updates_last_seen_release_version', '1.0.0');
    });

    it('shows the installed-update modal once when an existing install has no seen marker', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_auto_check_enabled') return 'false';
            return null;
        });

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: false });

        expect(modals.showInstalledUpdateModal).toHaveBeenCalledWith('1.0.0', expect.stringContaining('Installed notes'));
        expect(api.setSetting).toHaveBeenCalledWith('updates_last_seen_release_version', '1.0.0');
    });

    it('supports an e2e-forced release version even when the compiled channel is dev', async () => {
        const globals = globalThis as Record<string, unknown>;
        globals.__APP_VERSION__ = '1.0.0-dev.test';
        globals.__APP_BUILD_CHANNEL__ = 'dev';

        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_e2e_release_version') return '1.0.0';
            if (key === 'updates_auto_check_enabled') return 'false';
            if (key === 'updates_last_seen_release_version') return '1.0.0';
            return null;
        });

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: false });

        expect(manager.getState()).toMatchObject({
            installedVersion: '1.0.0',
            isSupported: true,
        });
    });

    it('opens the remote update modal on a manual check when a newer stable release exists', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_auto_check_enabled') return 'false';
            if (key === 'updates_last_seen_release_version') return '1.0.0';
            return null;
        });
        services.fetchExternalJson.mockResolvedValue(JSON.stringify([
            {
                tag_name: 'v1.1.0',
                prerelease: false,
                draft: false,
                body: '## [1.1.0] - 2026-03-25\n\n### Added\n- Remote notes',
                html_url: 'https://example.com/release/1.1.0',
            },
        ]));

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: false });
        await manager.checkForUpdates({ manual: true });

        expect(modals.showAvailableUpdateModal).toHaveBeenCalledWith(
            '1.0.0',
            '1.1.0',
            expect.stringContaining('Remote notes'),
            'https://example.com/release/1.1.0',
        );
    });

    it('shows an up-to-date alert when a manual check finds no newer release', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_auto_check_enabled') return 'false';
            if (key === 'updates_last_seen_release_version') return '1.0.0';
            return null;
        });
        services.fetchExternalJson.mockResolvedValue(JSON.stringify([
            {
                tag_name: 'v1.0.0',
                prerelease: false,
                draft: false,
                body: '',
                html_url: 'https://example.com/release/1.0.0',
            },
        ]));

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: false });
        await manager.checkForUpdates({ manual: true });

        expect(modals.customAlert).toHaveBeenCalledWith('Up to date', 'Kechimochi 1.0.0 is up to date.');
    });

    it('fails silently for automatic checks but surfaces an error for manual checks', async () => {
        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === 'updates_auto_check_enabled') return 'false';
            if (key === 'updates_last_seen_release_version') return '1.0.0';
            return null;
        });
        services.fetchExternalJson.mockRejectedValue(new Error('network down'));

        const manager = new UpdateManager(services);
        await manager.initialize({ isFreshInstall: false });
        await manager.checkForUpdates();
        expect(modals.customAlert).not.toHaveBeenCalled();

        await manager.checkForUpdates({ manual: true });
        expect(modals.customAlert).toHaveBeenCalledWith(
            'Update Check Failed',
            'Could not check for updates right now. Please try again later.',
        );
    });
});

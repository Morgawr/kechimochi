import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopServices } from '../../src/services/desktop';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => ({
        minimize,
        toggleMaximize,
        close,
    })),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
    save: vi.fn(),
}));

describe('DesktopServices', () => {
    let services: DesktopServices;
    const SAFE_DIR = '/home/testuser/kechimochi-fixtures';

    beforeEach(() => {
        services = new DesktopServices();
        vi.clearAllMocks();
        delete (globalThis as Record<string, unknown>).mockOpenPath;
        delete (globalThis as Record<string, unknown>).mockSavePath;
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:desktop'),
        });
    });

    it('formats dev and release app versions correctly', async () => {
        const globals = globalThis as Record<string, unknown>;
        globals.__APP_VERSION__ = '0.1.0-dev.hash123';
        globals.__APP_BUILD_CHANNEL__ = 'dev';
        globals.__APP_RELEASE_STAGE__ = 'beta';

        await expect(services.getAppVersion()).resolves.toBe('0.1.0-dev.hash123');

        globals.__APP_VERSION__ = '0.1.0';
        globals.__APP_BUILD_CHANNEL__ = 'release';

        await expect(services.getAppVersion()).resolves.toBe('0.1.0');
    });

    it('imports activities from mock and dialog-selected paths', async () => {
        (globalThis as Record<string, unknown>).mockOpenPath = `${SAFE_DIR}/activities.csv`;
        vi.mocked(invoke).mockResolvedValueOnce(5).mockResolvedValueOnce(3);
        vi.mocked(tauriOpen).mockResolvedValue(`${SAFE_DIR}/from-dialog.csv`);

        await expect(services.pickAndImportActivities()).resolves.toBe(5);
        delete (globalThis as Record<string, unknown>).mockOpenPath;
        await expect(services.pickAndImportActivities()).resolves.toBe(3);

        expect(invoke).toHaveBeenNthCalledWith(1, 'import_csv', { filePath: `${SAFE_DIR}/activities.csv` });
        expect(invoke).toHaveBeenNthCalledWith(2, 'import_csv', { filePath: `${SAFE_DIR}/from-dialog.csv` });
    });

    it('returns null or false when import/export dialogs are cancelled', async () => {
        vi.mocked(tauriOpen).mockResolvedValue(null);
        vi.mocked(tauriSave).mockResolvedValue(null);

        await expect(services.pickAndImportActivities()).resolves.toBeNull();
        await expect(services.pickAndExportFullBackup('{}', '1.0.0')).resolves.toBe(false);
        await expect(services.pickAndUploadProfilePicture()).resolves.toBeNull();
    });

    it('exports media and full backups through invoke', async () => {
        vi.mocked(tauriSave)
            .mockResolvedValueOnce(`${SAFE_DIR}/library.csv`)
            .mockResolvedValueOnce(`${SAFE_DIR}/backup.zip`);
        vi.mocked(invoke).mockResolvedValueOnce(12).mockResolvedValueOnce(undefined);

        await expect(services.exportMediaLibrary('TESTUSER')).resolves.toBe(12);
        await expect(services.pickAndExportFullBackup('{"theme":"molokai"}', '1.0.0')).resolves.toBe(true);

        expect(invoke).toHaveBeenNthCalledWith(1, 'export_media_csv', { filePath: `${SAFE_DIR}/library.csv` });
        expect(invoke).toHaveBeenNthCalledWith(2, 'export_full_backup', {
            filePath: `${SAFE_DIR}/backup.zip`,
            localStorage: '{"theme":"molokai"}',
            version: '1.0.0',
        });
    });

    it('uses direct file paths or picker fallbacks for milestone import/export', async () => {
        vi.mocked(invoke).mockResolvedValueOnce(4).mockResolvedValueOnce(9).mockResolvedValueOnce(6).mockResolvedValueOnce(2);
        vi.mocked(tauriSave).mockResolvedValue(`${SAFE_DIR}/milestones.csv`);
        vi.mocked(tauriOpen).mockResolvedValue(`${SAFE_DIR}/import.csv`);

        await expect(services.exportMilestonesCsv(`${SAFE_DIR}/direct.csv`)).resolves.toBe(4);
        await expect(services.exportMilestonesCsv('')).resolves.toBe(9);
        await expect(services.importMilestonesCsv(`${SAFE_DIR}/direct.csv`)).resolves.toBe(6);
        await expect(services.importMilestonesCsv('')).resolves.toBe(2);
    });

    it('returns zero for milestone picker flows when no file is chosen', async () => {
        vi.mocked(tauriSave).mockResolvedValue(null);
        vi.mocked(tauriOpen).mockResolvedValue(null);

        await expect(services.exportMilestonesCsv('')).resolves.toBe(0);
        await expect(services.importMilestonesCsv('')).resolves.toBe(0);
    });

    it('loads cover images from bytes and handles read errors', async () => {
        vi.mocked(invoke).mockResolvedValueOnce([1, 2, 3]).mockRejectedValueOnce(new Error('missing file'));

        await expect(services.loadCoverImage(`${SAFE_DIR}/cover.png`)).resolves.toBe('blob:desktop');
        await expect(services.loadCoverImage(`${SAFE_DIR}/missing.png`)).resolves.toBeNull();
        await expect(services.loadCoverImage('')).resolves.toBeNull();
    });

    it('gets, uploads, and deletes profile pictures via invoke', async () => {
        vi.mocked(invoke)
            .mockResolvedValueOnce({ mime_type: 'image/png', base64_data: 'abc', byte_size: 3, width: 1, height: 1, updated_at: '2026-03-23T00:00:00Z' })
            .mockResolvedValueOnce({ mime_type: 'image/png', base64_data: 'abc', byte_size: 3, width: 1, height: 1, updated_at: '2026-03-23T00:00:00Z' })
            .mockResolvedValueOnce(undefined);
        vi.mocked(tauriOpen).mockResolvedValue(`${SAFE_DIR}/avatar.png`);

        await expect(services.getProfilePicture()).resolves.toMatchObject({ mime_type: 'image/png' });
        await expect(services.pickAndUploadProfilePicture()).resolves.toMatchObject({ width: 1 });
        await expect(services.deleteProfilePicture()).resolves.toBeUndefined();

        expect(invoke).toHaveBeenNthCalledWith(1, 'get_profile_picture');
        expect(invoke).toHaveBeenNthCalledWith(2, 'upload_profile_picture', { path: `${SAFE_DIR}/avatar.png` });
        expect(invoke).toHaveBeenNthCalledWith(3, 'delete_profile_picture');
    });

    it('caches the current window for window control methods', () => {
        services.minimizeWindow();
        services.maximizeWindow();
        services.closeWindow();

        expect(getCurrentWindow).toHaveBeenCalledTimes(1);
        expect(minimize).toHaveBeenCalled();
        expect(toggleMaximize).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('reports desktop runtime and proxies remote fetch helpers', async () => {
        vi.mocked(invoke).mockResolvedValueOnce('json-data').mockResolvedValueOnce([9, 8, 7]);

        expect(services.isDesktop()).toBe(true);
        await expect(services.fetchExternalJson('https://example.com', 'GET')).resolves.toBe('json-data');
        await expect(services.fetchRemoteBytes('https://example.com/img')).resolves.toEqual([9, 8, 7]);
    });

    it('loads timeline events through invoke', async () => {
        vi.mocked(invoke).mockResolvedValue([{ kind: 'started', mediaId: 1 }]);

        await expect(services.getTimelineEvents()).resolves.toEqual([{ kind: 'started', mediaId: 1 }]);
        expect(invoke).toHaveBeenCalledWith('get_timeline_events');
    });

    it('prefers mockExternalJSON for external JSON requests when present', async () => {
        (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON = {
            'api.github.com/repos/Morgawr/kechimochi/releases': [{ tag_name: 'v9.9.9' }],
        };

        await expect(
            services.fetchExternalJson('https://api.github.com/repos/Morgawr/kechimochi/releases?per_page=20', 'GET')
        ).resolves.toBe('[{"tag_name":"v9.9.9"}]');
        expect(invoke).not.toHaveBeenCalled();

        delete (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON;
    });
});

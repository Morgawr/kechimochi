import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebServices } from '../../src/services/web';
import type { ActivityLog, Media, MediaCsvRow, Milestone } from '../../src/types';

describe('WebServices', () => {
    let services: WebServices;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        services = new WebServices();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:test'),
            revokeObjectURL: vi.fn(),
        });
        delete (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON;
    });

    function mockFilePicker(file: File | null, eventType: 'change' | 'cancel' = 'change') {
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const el = originalCreateElement(tagName);
            if (tagName === 'input') {
                const input = el as HTMLInputElement;
                input.click = () => {
                    if (eventType === 'cancel') {
                        input.dispatchEvent(new Event('cancel'));
                        return;
                    }
                    Object.defineProperty(input, 'files', {
                        value: file ? [file] : [],
                        configurable: true,
                    });
                    input.onchange?.(new Event('change'));
                };
            }
            if (tagName === 'a') {
                (el as HTMLAnchorElement).click = vi.fn();
            }
            return el;
        });
    }

    function okJson(body: unknown) {
        return {
            ok: true,
            headers: {
                get: (name: string) => name === 'content-type' ? 'application/json' : null,
            },
            json: vi.fn().mockResolvedValue(body),
            text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        };
    }

    function okBlob(body: Blob, rowCount: string | null = '7') {
        return {
            ok: true,
            headers: {
                get: (name: string) => name === 'X-Row-Count' ? rowCount : null,
            },
            blob: vi.fn().mockResolvedValue(body),
            text: vi.fn().mockResolvedValue(''),
        };
    }

    const sampleMedia: Media = {
        id: 42,
        title: 'Example',
        media_type: 'Book',
        status: 'reading',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Reading',
        tracking_status: 'active',
    };

    const sampleLog: ActivityLog = {
        id: 12,
        media_id: 42,
        duration_minutes: 30,
        characters: 1200,
        date: '2026-03-23',
    };

    const sampleMilestone: Milestone = {
        id: 5,
        media_title: 'Example',
        name: 'Chapter 1',
        duration: 30,
        characters: 1200,
    };

    it('throws a helpful error when HTML is returned instead of JSON', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: { get: () => 'text/html' },
            text: vi.fn().mockResolvedValue('<!DOCTYPE html><html></html>'),
        });

        await expect(services.getAllMedia()).rejects.toThrow('Received HTML instead of JSON');
    });

    it('throws response text for non-ok API responses', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            text: vi.fn().mockResolvedValue('database unavailable'),
        });

        await expect(services.setSetting('theme', 'dark')).rejects.toThrow('database unavailable');
    });

    it('throws a response type hint for non-json API responses', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: { get: () => 'text/plain' },
            text: vi.fn().mockResolvedValue('plain text'),
        });

        await expect(services.getAllMedia()).rejects.toThrow('Unexpected response type: text/plain');
    });

    it('maps core data operations to HTTP endpoints', async () => {
        fetchMock.mockResolvedValue(okJson(null));

        await services.getAllMedia();
        await services.addMedia(sampleMedia);
        await services.updateMedia(sampleMedia);
        await services.deleteMedia(42);
        await services.addLog(sampleLog);
        await services.updateLog(sampleLog);
        await services.deleteLog(12);
        await services.getLogs();
        await services.getHeatmap();
        await services.getLogsForMedia(42);
        await services.initializeUserDb('alice');
        await services.clearActivities();
        await services.wipeEverything();
        await services.getSetting('profile name');
        await services.setSetting('profile name', 'Alice');
        await services.getUsername();
        await services.getProfilePicture();
        await services.deleteProfilePicture();

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/media');
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/media', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(sampleMedia),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/media/42', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify(sampleMedia),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/media/42', { method: 'DELETE' });
        expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/logs', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(sampleLog),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/logs/12', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify(sampleLog),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/logs/12', { method: 'DELETE' });
        expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/logs');
        expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/logs/heatmap');
        expect(fetchMock).toHaveBeenNthCalledWith(10, '/api/logs/media/42');
        expect(fetchMock).toHaveBeenNthCalledWith(11, '/api/profiles/initialize', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ fallback_username: 'alice' }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(12, '/api/activities/clear', expect.objectContaining({ method: 'POST' }));
        expect(fetchMock).toHaveBeenNthCalledWith(13, '/api/reset', expect.objectContaining({ method: 'POST' }));
        expect(fetchMock).toHaveBeenNthCalledWith(14, '/api/settings/profile%20name');
        expect(fetchMock).toHaveBeenNthCalledWith(15, '/api/settings/profile%20name', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ value: 'Alice' }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(16, '/api/username');
        expect(fetchMock).toHaveBeenNthCalledWith(17, '/api/profile-picture');
        expect(fetchMock).toHaveBeenNthCalledWith(18, '/api/profile-picture', { method: 'DELETE' });
    });

    it('loads timeline events from the timeline endpoint', async () => {
        fetchMock.mockResolvedValue(okJson([{ kind: 'started', mediaId: 1 }]));

        await expect(services.getTimelineEvents()).resolves.toEqual([{ kind: 'started', mediaId: 1 }]);
        expect(fetchMock).toHaveBeenCalledWith('/api/timeline');
    });

    it('reports build metadata without hitting the API', async () => {
        const globals = globalThis as unknown as Record<string, unknown>;
        globals.__APP_VERSION__ = '1.2.3';
        globals.__APP_BUILD_CHANNEL__ = 'release';

        await expect(services.getAppVersion()).resolves.toBe('1.2.3');
        await expect(services.getStartupError()).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('exports activities with query params and triggers a download', async () => {
        const blob = new Blob(['csv']);
        fetchMock.mockResolvedValue(okBlob(blob));
        const anchorClick = vi.fn();
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const el = document.createElementNS('http://www.w3.org/1999/xhtml', tagName);
            if (el instanceof HTMLAnchorElement) el.click = anchorClick;
            return el;
        });

        const count = await services.exportActivities('2024-01-01', '2024-01-31');

        expect(fetchMock).toHaveBeenCalledWith('/api/export/activities?start=2024-01-01&end=2024-01-31');
        expect(count).toBe(7);
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(anchorClick).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    });

    it('exports full backup and returns true after downloading the zip', async () => {
        const blob = new Blob(['zip']);
        fetchMock.mockResolvedValue(okBlob(blob));
        const anchorClick = vi.fn();
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const el = document.createElementNS('http://www.w3.org/1999/xhtml', tagName);
            if (el instanceof HTMLAnchorElement) el.click = anchorClick;
            return el;
        });

        const result = await services.pickAndExportFullBackup('{"theme":"molokai"}', '1.2.3');

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('/api/export/full-backup', expect.objectContaining({
            method: 'POST',
        }));
        expect(anchorClick).toHaveBeenCalled();
    });

    it('imports picked activity, media, and milestone CSV files', async () => {
        const file = new File(['csv'], 'import.csv', { type: 'text/csv' });
        mockFilePicker(file);
        const records: MediaCsvRow[] = [{
            Title: 'Example',
            'Media Type': 'Book',
            Status: 'reading',
            Language: 'Japanese',
            Description: '',
            'Content Type': 'Reading',
            'Extra Data': '{}',
            'Cover Image (Base64)': '',
        }];
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ count: 3 }), text: vi.fn() })
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([{ incoming: records[0] }]), text: vi.fn() })
            .mockResolvedValueOnce(okJson(2))
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ count: 4 }), text: vi.fn() });

        await expect(services.pickAndImportActivities()).resolves.toBe(3);
        await expect(services.analyzeMediaCsvFromPick()).resolves.toEqual([{ incoming: records[0] }]);
        await expect(services.applyMediaImport(records)).resolves.toBe(2);
        await expect(services.importMilestonesCsv('ignored.csv')).resolves.toBe(4);

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/import/activities', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/import/media/analyze', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/import/media/apply', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(records),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/import/milestones', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
    });

    it('returns nullish import results when file picking is cancelled', async () => {
        mockFilePicker(null, 'cancel');

        await expect(services.pickAndImportActivities()).resolves.toBeNull();
        await expect(services.analyzeMediaCsvFromPick()).resolves.toBeNull();
        await expect(services.importMilestonesCsv('ignored.csv')).resolves.toBe(0);
        await expect(services.pickAndUploadProfilePicture()).resolves.toBeNull();
        await expect(services.pickAndUploadCover(42)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('exports media and milestones CSV files', async () => {
        const blob = new Blob(['csv']);
        fetchMock
            .mockResolvedValueOnce(okBlob(blob, '8'))
            .mockResolvedValueOnce(okBlob(blob, '5'));
        const anchorClick = vi.fn();
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const el = document.createElementNS('http://www.w3.org/1999/xhtml', tagName);
            if (el instanceof HTMLAnchorElement) el.click = anchorClick;
            return el;
        });

        await expect(services.exportMediaLibrary('profile')).resolves.toBe(8);
        await expect(services.exportMilestonesCsv('ignored.csv')).resolves.toBe(5);

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/export/media');
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/export/milestones');
        expect(anchorClick).toHaveBeenCalledTimes(2);
    });

    it('imports a picked full backup zip and unwraps localStorage', async () => {
        const file = new File(['zip'], 'backup.zip', { type: 'application/zip' });
        mockFilePicker(file);
        fetchMock.mockResolvedValue(okJson({ localStorage: '{"restored":true}' }));

        const result = await services.pickAndImportFullBackup();

        expect(result).toBe('{"restored":true}');
        expect(fetchMock).toHaveBeenCalledWith('/api/import/full-backup', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
    });

    it('returns null when the user cancels full backup import', async () => {
        mockFilePicker(null, 'cancel');

        await expect(services.pickAndImportFullBackup()).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gets, uploads, and deletes profile pictures through the API', async () => {
        const file = new File(['img'], 'avatar.png', { type: 'image/png' });
        mockFilePicker(file);
        fetchMock
            .mockResolvedValueOnce(okJson({ mime_type: 'image/png', base64_data: 'abc', byte_size: 3, width: 1, height: 1, updated_at: '2026-03-23T00:00:00Z' }))
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ mime_type: 'image/png', base64_data: 'abc', byte_size: 3, width: 1, height: 1, updated_at: '2026-03-23T00:00:00Z' }),
                text: vi.fn().mockResolvedValue(''),
            })
            .mockResolvedValueOnce(okJson(null));

        await expect(services.getProfilePicture()).resolves.toMatchObject({ width: 1 });
        await expect(services.pickAndUploadProfilePicture()).resolves.toMatchObject({ mime_type: 'image/png' });
        await expect(services.deleteProfilePicture()).resolves.toBeNull();

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/profile-picture');
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/profile-picture', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/profile-picture', { method: 'DELETE' });
    });

    it('manages milestones through media-title endpoints', async () => {
        fetchMock.mockResolvedValue(okJson(null));

        await services.getMilestones('Example Title');
        await services.addMilestone(sampleMilestone);
        await services.updateMilestone(sampleMilestone);
        await services.deleteMilestone(5);
        await services.clearMilestones('Example Title');

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/milestones/media/Example%20Title');
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/milestones', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(sampleMilestone),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/milestones/5', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify(sampleMilestone),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/milestones/5', { method: 'DELETE' });
        expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/milestones/media/Example%20Title', { method: 'DELETE' });
    });

    it('uploads and downloads cover images through the API', async () => {
        const file = new File(['img'], 'cover.png', { type: 'image/png' });
        mockFilePicker(file);
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ path: '/covers/42.png' }), text: vi.fn() })
            .mockResolvedValueOnce(okJson({ path: '/covers/downloaded.png' }));

        await expect(services.pickAndUploadCover(42)).resolves.toBe('/covers/42.png');
        await expect(services.downloadAndSaveImage(42, 'https://example.com/cover.png')).resolves.toBe('/covers/downloaded.png');

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/covers/42', expect.objectContaining({
            method: 'POST',
            body: expect.any(FormData),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/covers/download', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ media_id: 42, url: 'https://example.com/cover.png' }),
        }));
    });

    it('does not skip legacy local profile migration in web mode', async () => {
        await expect(services.shouldSkipLegacyLocalProfileMigration()).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('loads cover images from API filenames and handles blank refs', async () => {
        expect(await services.loadCoverImage('')).toBeNull();
        expect(await services.loadCoverImage('/')).toBeNull();
        expect(await services.loadCoverImage(String.raw`C:\covers\sample image.png`)).toBe('/api/covers/file/sample%20image.png');
    });

    it('unwraps proxied fetch helpers', async () => {
        fetchMock
            .mockResolvedValueOnce(okJson({ data: '{"ok":true}' }))
            .mockResolvedValueOnce(okJson({ bytes: [1, 2, 3] }));

        await expect(services.fetchExternalJson('https://example.com/api', 'GET')).resolves.toBe('{"ok":true}');
        await expect(services.fetchRemoteBytes('https://example.com/image')).resolves.toEqual([1, 2, 3]);
    });

    it('prefers mockExternalJSON for external JSON requests when present', async () => {
        (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON = {
            'api.github.com/repos/Morgawr/kechimochi/releases': [{ tag_name: 'v9.9.9' }],
        };

        await expect(
            services.fetchExternalJson('https://api.github.com/repos/Morgawr/kechimochi/releases?per_page=20', 'GET')
        ).resolves.toBe('[{"tag_name":"v9.9.9"}]');
        expect(fetchMock).not.toHaveBeenCalled();

        delete (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON;
    });

    it('rejects cloud sync operations in web mode', async () => {
        const unsupportedCalls: Array<Promise<unknown>> = [
            services.getSyncStatus(),
            services.connectGoogleDrive(),
            services.disconnectGoogleDrive(),
            services.listRemoteSyncProfiles(),
            services.previewAttachRemoteSyncProfile('profile_1'),
            services.createRemoteSyncProfile(),
            services.attachRemoteSyncProfile('profile_1'),
            services.runSync(),
            services.replaceLocalFromRemote(),
            services.forcePublishLocalAsRemote(),
            services.getSyncConflicts(),
            services.resolveSyncConflict(0, { kind: 'media_field', side: 'local' }),
            services.clearSyncBackups(),
        ];

        for (const call of unsupportedCalls) {
            await expect(call).rejects.toThrow('Cloud Sync is only available in the app');
        }
    });

    it('provides browser-mode noops for sync progress, window controls, and runtime flags', async () => {
        const unsubscribe = await services.subscribeSyncProgress(() => undefined);

        expect(unsubscribe()).toBeUndefined();
        expect(services.minimizeWindow()).toBeUndefined();
        expect(services.maximizeWindow()).toBeUndefined();
        expect(services.closeWindow()).toBeUndefined();
        expect(services.isDesktop()).toBe(false);
        expect(services.supportsWindowControls()).toBe(false);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebServices } from '../../src/services/web';

describe('WebServices', () => {
    let services: WebServices;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        services = new WebServices();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:test'),
            revokeObjectURL: vi.fn(),
        });
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

    it('throws a helpful error when HTML is returned instead of JSON', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: { get: () => 'text/html' },
            text: vi.fn().mockResolvedValue('<!DOCTYPE html><html></html>'),
        });

        await expect(services.getAllMedia()).rejects.toThrow('Received HTML instead of JSON');
    });

    it('loads timeline events from the timeline endpoint', async () => {
        fetchMock.mockResolvedValue(okJson([{ kind: 'started', mediaId: 1 }]));

        await expect(services.getTimelineEvents()).resolves.toEqual([{ kind: 'started', mediaId: 1 }]);
        expect(fetchMock).toHaveBeenCalledWith('/api/timeline');
    });

    it('exports activities with query params and triggers a download', async () => {
        const blob = new Blob(['csv']);
        fetchMock.mockResolvedValue({
            ok: true,
            headers: { get: (name: string) => name === 'X-Row-Count' ? '7' : null },
            blob: vi.fn().mockResolvedValue(blob),
            text: vi.fn(),
        });
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
        fetchMock.mockResolvedValue({
            ok: true,
            blob: vi.fn().mockResolvedValue(blob),
            text: vi.fn(),
        });
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

    it('does not skip legacy local profile migration in web mode', async () => {
        await expect(services.shouldSkipLegacyLocalProfileMigration()).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('loads cover images from API filenames and handles blank refs', async () => {
        expect(await services.loadCoverImage('')).toBeNull();
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
});

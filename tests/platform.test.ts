import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchExternalJsonSpy = vi.fn();
const fetchRemoteBytesSpy = vi.fn();

vi.mock('../src/services/index', () => ({
    getServices: vi.fn(() => ({
        fetchExternalJson: fetchExternalJsonSpy,
        fetchRemoteBytes: fetchRemoteBytesSpy,
    })),
}));

describe('platform.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        fetchExternalJsonSpy.mockReset();
        fetchRemoteBytesSpy.mockReset();
        delete (globalThis as Record<string, unknown>).mockExternalJSON;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).mockExternalJSON;
    });

    it('returns mocked external JSON strings without hitting services', async () => {
        (globalThis as Record<string, unknown>).mockExternalJSON = {
            '/sample': '{"ok":true}',
        };

        const platform = await import('../src/platform');
        const result = await platform.fetchExternalJson('https://example.com/sample', 'GET');

        expect(result).toBe('{"ok":true}');
        expect(fetchExternalJsonSpy).not.toHaveBeenCalled();
    });

    it('stringifies mocked external JSON objects without hitting services', async () => {
        (globalThis as Record<string, unknown>).mockExternalJSON = {
            '/sample': { ok: true, count: 2 },
        };

        const platform = await import('../src/platform');
        const result = await platform.fetchExternalJson('https://example.com/sample', 'GET');

        expect(result).toBe(JSON.stringify({ ok: true, count: 2 }));
        expect(fetchExternalJsonSpy).not.toHaveBeenCalled();
    });

    it('delegates external JSON requests to services when no mocks match', async () => {
        fetchExternalJsonSpy.mockResolvedValue('live response');

        const platform = await import('../src/platform');
        const result = await platform.fetchExternalJson('https://example.com/live', 'POST', '{"x":1}', { Accept: 'application/json' });

        expect(fetchExternalJsonSpy).toHaveBeenCalledWith(
            'https://example.com/live',
            'POST',
            '{"x":1}',
            { Accept: 'application/json' },
        );
        expect(result).toBe('live response');
    });

    it('delegates remote byte requests to services', async () => {
        fetchRemoteBytesSpy.mockResolvedValue([1, 2, 3]);

        const platform = await import('../src/platform');
        const result = await platform.fetchRemoteBytes('https://example.com/image.png');

        expect(fetchRemoteBytesSpy).toHaveBeenCalledWith('https://example.com/image.png');
        expect(result).toEqual([1, 2, 3]);
    });
});

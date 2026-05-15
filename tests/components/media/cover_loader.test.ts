import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '../../../src/api';
import { MediaCoverLoader } from '../../../src/media/cover_loader';

vi.mock('../../../src/api', () => ({
    readFileBytes: vi.fn(),
}));

const mockServices = {
    isDesktop: vi.fn(() => true),
    supportsWindowControls: vi.fn(() => true),
    loadCoverImage: vi.fn(),
};

vi.mock('../../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

describe('MediaCoverLoader', () => {
    beforeEach(() => {
        MediaCoverLoader.clear();
        vi.clearAllMocks();
        mockServices.isDesktop.mockReturnValue(true);
        mockServices.loadCoverImage.mockResolvedValue('https://covers.example/from-web.jpg');
    });

    it('returns null for empty cover references', async () => {
        await expect(MediaCoverLoader.load('')).resolves.toBeNull();
        await expect(MediaCoverLoader.load('   ')).resolves.toBeNull();
        expect(api.readFileBytes).not.toHaveBeenCalled();
        expect(mockServices.loadCoverImage).not.toHaveBeenCalled();
    });

    it('loads and caches desktop covers', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:desktop-cover');

        await expect(MediaCoverLoader.load('/app/covers/cover.png')).resolves.toBe('blob:desktop-cover');
        await expect(MediaCoverLoader.load('/app/covers/cover.png')).resolves.toBe('blob:desktop-cover');

        expect(api.readFileBytes).toHaveBeenCalledTimes(1);
    });

    it('can load desktop covers without writing through to the shared cache', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn()
            .mockReturnValueOnce('blob:detail-cover-1')
            .mockReturnValueOnce('blob:detail-cover-2');

        await expect(MediaCoverLoader.load('/app/covers/cover.png', { cache: false, useCache: false })).resolves.toBe('blob:detail-cover-1');
        await expect(MediaCoverLoader.load('/app/covers/cover.png', { cache: false, useCache: false })).resolves.toBe('blob:detail-cover-2');

        expect(api.readFileBytes).toHaveBeenCalledTimes(2);
        expect(MediaCoverLoader.getCached('/app/covers/cover.png')).toBeNull();
    });

    it('revokes cached object URLs when clearing the shared cache', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:desktop-cover');
        globalThis.URL.revokeObjectURL = vi.fn();

        await MediaCoverLoader.load('/app/covers/cover.png');
        MediaCoverLoader.clear();

        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:desktop-cover');
    });

    it('uses web cover loading outside desktop mode', async () => {
        mockServices.isDesktop.mockReturnValue(false);

        await expect(MediaCoverLoader.load('remote-cover')).resolves.toBe('https://covers.example/from-web.jpg');
        expect(mockServices.loadCoverImage).toHaveBeenCalledWith('remote-cover');
        expect(api.readFileBytes).not.toHaveBeenCalled();
    });

    it('returns null when the underlying cover source cannot resolve a URL', async () => {
        mockServices.isDesktop.mockReturnValue(false);
        mockServices.loadCoverImage.mockResolvedValue(null);

        await expect(MediaCoverLoader.load('missing-cover')).resolves.toBeNull();
        await expect(MediaCoverLoader.load('missing-cover')).resolves.toBeNull();

        expect(mockServices.loadCoverImage).toHaveBeenCalledTimes(2);
    });
});

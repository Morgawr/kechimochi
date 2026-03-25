import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '../../../src/api';
import { MediaCoverLoader } from '../../../src/components/media/cover_loader';

vi.mock('../../../src/api', () => ({
    readFileBytes: vi.fn(),
}));

const mockServices = {
    isDesktop: vi.fn(() => true),
    loadCoverImage: vi.fn(),
};

vi.mock('../../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

describe('MediaCoverLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        MediaCoverLoader.clear();
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

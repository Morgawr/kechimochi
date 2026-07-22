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

        expect(mockServices.loadCoverImage).toHaveBeenCalledTimes(1);
    });

    it('negative-caches failed cover reads without leaking interaction errors', async () => {
        vi.mocked(api.readFileBytes).mockRejectedValue(new Error('cover file is missing'));

        await expect(MediaCoverLoader.load('/missing/cover.png')).resolves.toBeNull();
        await expect(MediaCoverLoader.load('/missing/cover.png')).resolves.toBeNull();

        expect(api.readFileBytes).toHaveBeenCalledTimes(1);
    });

    it('shares identical in-flight reads instead of starting duplicate work', async () => {
        mockServices.isDesktop.mockReturnValue(false);
        let resolveCover!: (value: string | null) => void;
        mockServices.loadCoverImage.mockImplementation(() => new Promise(resolve => {
            resolveCover = resolve;
        }));

        const first = MediaCoverLoader.load('shared-cover');
        const second = MediaCoverLoader.load('shared-cover');
        expect(mockServices.loadCoverImage).toHaveBeenCalledTimes(1);

        resolveCover('https://covers.example/shared.jpg');
        await expect(Promise.all([first, second])).resolves.toEqual([
            'https://covers.example/shared.jpg',
            'https://covers.example/shared.jpg',
        ]);
    });

    it('drops and revokes an old-generation result after data isolation is reset', async () => {
        let resolveBytes!: (value: number[]) => void;
        vi.mocked(api.readFileBytes).mockImplementation(() => new Promise(resolve => {
            resolveBytes = resolve;
        }));
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:old-generation');
        globalThis.URL.revokeObjectURL = vi.fn();

        const pending = MediaCoverLoader.load('/old/data/cover.png');
        MediaCoverLoader.clear();
        resolveBytes([1, 2, 3]);

        await expect(pending).resolves.toBeNull();
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-generation');
        expect(MediaCoverLoader.getCached('/old/data/cover.png')).toBeNull();
    });

    it('evicts least-recently-used entries when the bounded cache is full', async () => {
        mockServices.isDesktop.mockReturnValue(false);
        mockServices.loadCoverImage.mockImplementation(async coverRef => `https://covers.example/${coverRef}`);

        for (let index = 0; index < 97; index += 1) {
            await MediaCoverLoader.load(`cover-${index}`);
        }
        expect(mockServices.loadCoverImage).toHaveBeenCalledTimes(97);

        await MediaCoverLoader.load('cover-0');
        expect(mockServices.loadCoverImage).toHaveBeenCalledTimes(98);
    });
});

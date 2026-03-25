import { vi } from 'vitest';

export const mockServices = {
    isDesktop: vi.fn(() => true),
    loadCoverImage: vi.fn(),
};

export const observe = vi.fn();
export const disconnect = vi.fn();

vi.mock('../../../src/api', () => ({
    readFileBytes: vi.fn(),
}));

vi.mock('../../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

vi.stubGlobal('IntersectionObserver', vi.fn(() => ({
    observe,
    disconnect,
})));

export async function resetCoverLoaderTestState(resolvedUrl: string) {
    vi.clearAllMocks();
    mockServices.isDesktop.mockReturnValue(true);
    mockServices.loadCoverImage.mockResolvedValue(resolvedUrl);

    const { MediaCoverLoader } = await import('../../../src/components/media/cover_loader');
    MediaCoverLoader.clear();
}

export function triggerLatestIntersection(isIntersecting = true) {
    const observerCallback = vi.mocked(IntersectionObserver).mock.calls.at(-1)?.[0];
    if (!observerCallback) {
        throw new Error('No IntersectionObserver callback was registered.');
    }

    observerCallback([{ isIntersecting }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
}

import { vi } from 'vitest';

export const mockServices = {
    isDesktop: vi.fn(() => true),
    supportsWindowControls: vi.fn(() => true),
    loadCoverImage: vi.fn(),
};

export const observe = vi.fn();
export const disconnect = vi.fn();
export const unobserve = vi.fn();
let latestObservedTarget: Element | null = null;

vi.mock('../../../src/api', () => ({
    readFileBytes: vi.fn(),
}));

vi.mock('../../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

vi.stubGlobal('IntersectionObserver', vi.fn(() => ({
    observe: (target: Element) => {
        latestObservedTarget = target;
        observe(target);
    },
    unobserve,
    disconnect,
})));

export async function resetCoverLoaderTestState(resolvedUrl: string) {
    const { MediaCoverLoader } = await import('../../../src/media/cover_loader');
    MediaCoverLoader.clear();

    vi.clearAllMocks();
    mockServices.isDesktop.mockReturnValue(true);
    mockServices.loadCoverImage.mockResolvedValue(resolvedUrl);
    latestObservedTarget = null;
}

export function triggerLatestIntersection(isIntersecting = true) {
    const observerCallback = vi.mocked(IntersectionObserver).mock.calls.at(-1)?.[0];
    if (!observerCallback) {
        throw new Error('No IntersectionObserver callback was registered.');
    }

    observerCallback([{
        isIntersecting,
        target: latestObservedTarget,
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
}

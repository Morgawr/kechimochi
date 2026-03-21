import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaItem } from '../../../src/components/media/MediaItem';
import * as api from '../../../src/api';
import { Media } from '../../../src/api';

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

// Mock IntersectionObserver
const observe = vi.fn();
const disconnect = vi.fn();
vi.stubGlobal('IntersectionObserver', vi.fn(() => ({
    observe,
    disconnect,
})));

describe('MediaItem', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        mockServices.isDesktop.mockReturnValue(true);
        mockServices.loadCoverImage.mockResolvedValue('https://covers.example/test.jpg');
        // @ts-expect-error - accessing private static cache for test isolation
        MediaItem.imageCache.clear();
    });

    it('should render title and placeholder initially', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.textContent).toContain('Test Media');
        expect(container.textContent).toContain('No Image');
    });

    it('should trigger click callback', () => {
        const onClick = vi.fn();
        vi.stubGlobal('alert', vi.fn());
        const media = { title: 'T', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const item = new MediaItem(container, media as unknown as Media, onClick);
        expect(item).toBeDefined();
        
        container.click();
        expect(onClick).toHaveBeenCalled();
    });

    it('should load image when intersecting', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        // Mock URL.createObjectURL
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:abc');

        const media = { title: 'T', cover_image: '/path/to/img.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        
        // Simulate intersection
        const observerCallback = (vi.mocked(IntersectionObserver)).mock.calls[0][0];
        observerCallback([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => component.state.imgSrc === 'blob:abc');
        component.render();

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img?.src).toBe('blob:abc');
        expect(disconnect).toHaveBeenCalled();
    });

    it('should load images through web services outside desktop runtime', async () => {
        mockServices.isDesktop.mockReturnValue(false);

        const media = { title: 'Web Item', cover_image: '/path/to/web.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());

        const observerCallback = (vi.mocked(IntersectionObserver)).mock.calls[0][0];
        observerCallback([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);

        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => component.state.imgSrc === 'https://covers.example/test.jpg');
        expect(mockServices.loadCoverImage).toHaveBeenCalledWith('/path/to/web.jpg');
        expect(api.readFileBytes).not.toHaveBeenCalled();
    });

    it('should reuse cached cover images without reading bytes again', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:cached');

        const media = { title: 'Cached', cover_image: '/path/to/cached.jpg', status: 'Active' };
        const first = new MediaItem(document.createElement('div'), media as unknown as Media, vi.fn());
        let observerCallback = (vi.mocked(IntersectionObserver)).mock.calls.at(-1)?.[0];
        observerCallback?.([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => first.state.imgSrc === 'blob:cached');

        const second = new MediaItem(container, media as unknown as Media, vi.fn());
        observerCallback = (vi.mocked(IntersectionObserver)).mock.calls.at(-1)?.[0];
        observerCallback?.([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => second.state.imgSrc === 'blob:cached');

        expect(api.readFileBytes).toHaveBeenCalledTimes(1);
    });


    it('should handle image load failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.mocked(api.readFileBytes).mockRejectedValue(new Error('File not found'));
        const media = { title: 'T', cover_image: '/bad/path.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        
        const observerCallback = (vi.mocked(IntersectionObserver)).mock.calls[0][0];
        observerCallback([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        
        // Wait a bit for the async image loading to "fail"
        await new Promise(r => setTimeout(r, 10));
        // @ts-expect-error - accessing private state
        expect(component.state.imgSrc).toBeNull();

        consoleSpy.mockRestore();
    });

    it('should render status LED for tracked media', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        const led = container.querySelector('.status-led');
        expect(led).not.toBeNull();
        expect(led?.classList.contains('status-ongoing')).toBe(true);
        expect((led as HTMLElement).title).toBe('Status: Ongoing');
    });

    it('should NOT render status LED for untracked media', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        const led = container.querySelector('.status-led');
        expect(led).toBeNull();
    });

    it('should render archived items dimmed and omit the badge for unknown content types', () => {
        const media = { title: 'Archived Item', status: 'Archived', content_type: 'Unknown', tracking_status: 'Complete' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.style.opacity).toBe('0.6');
        expect(container.querySelector('.grid-item-type-badge')).toBeNull();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    disconnect,
    mockServices,
    resetCoverLoaderTestState,
    triggerLatestIntersection,
} from './media_cover_test_utils';
import { MediaItem } from '../../../src/media/MediaItem';
import * as api from '../../../src/api';
import { Media } from '../../../src/api';

describe('MediaItem', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        return resetCoverLoaderTestState('https://covers.example/test.jpg');
    });

    it('should render title and placeholder initially', () => {
        const media = { title: 'Test Media', variant: 'TV Series', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.textContent).toContain('Test Media');
        expect(container.textContent).toContain('TV Series');
        expect(container.title).toBe('Test Media — TV Series');
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
        component.render();
        
        // Simulate intersection
        triggerLatestIntersection();
        
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => component.state.imgSrc === 'blob:abc');

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img?.src).toBe('blob:abc');
        expect(img?.classList.contains('progressive-cover-image')).toBe(true);
        expect(disconnect).toHaveBeenCalled();
    });

    it('should load images through web services outside desktop runtime', async () => {
        mockServices.isDesktop.mockReturnValue(false);

        const media = { title: 'Web Item', cover_image: '/path/to/web.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());

        triggerLatestIntersection();

        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => component.state.imgSrc === 'https://covers.example/test.jpg');
        expect(mockServices.loadCoverImage).toHaveBeenCalledWith('/path/to/web.jpg');
        expect(api.readFileBytes).not.toHaveBeenCalled();
    });

    it('should load eager covers without waiting for an intersection', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:eager');

        const media = { title: 'Eager', cover_image: '/path/to/eager.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn(), undefined, true);
        component.render();

        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => component.state.imgSrc === 'blob:eager');

        expect(api.readFileBytes).toHaveBeenCalledWith('/path/to/eager.jpg');
        expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:eager');
    });

    it('should reuse cached cover images without reading bytes again', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:cached');

        const media = { title: 'Cached', cover_image: '/path/to/cached.jpg', status: 'Active' };
        const first = new MediaItem(document.createElement('div'), media as unknown as Media, vi.fn());
        triggerLatestIntersection();
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => first.state.imgSrc === 'blob:cached');

        const second = new MediaItem(container, media as unknown as Media, vi.fn());
        triggerLatestIntersection();
        // @ts-expect-error - accessing private state
        await vi.waitUntil(() => second.state.imgSrc === 'blob:cached');

        expect(api.readFileBytes).toHaveBeenCalledTimes(1);
    });


    it('should handle image load failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.mocked(api.readFileBytes).mockRejectedValue(new Error('File not found'));
        const media = { title: 'T', cover_image: '/bad/path.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        
        triggerLatestIntersection();
        
        // Wait a bit for the async image loading to "fail"
        await new Promise(r => setTimeout(r, 10));
        // @ts-expect-error - accessing private state
        expect(component.state.imgSrc).toBeNull();

        consoleSpy.mockRestore();
    });

    it('should not commit a cover that resolves after the item is destroyed', async () => {
        let resolveBytes: (bytes: number[]) => void = (_bytes: number[]) => undefined;
        vi.mocked(api.readFileBytes).mockReturnValue(new Promise(resolve => {
            resolveBytes = resolve;
        }));
        const createObjectUrl = vi.fn(() => 'blob:late');
        globalThis.URL.createObjectURL = createObjectUrl;

        const media = { title: 'Removed', cover_image: '/path/to/late.jpg', status: 'Active' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();
        triggerLatestIntersection();
        await vi.waitFor(() => expect(api.readFileBytes).toHaveBeenCalledWith('/path/to/late.jpg'));

        component.destroy();
        resolveBytes([1, 2, 3]);
        await vi.waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce());
        await new Promise(resolve => setTimeout(resolve, 0));

        // @ts-expect-error - accessing private state
        expect(component.state.imgSrc).toBeNull();
        expect(container.querySelector('img')).toBeNull();
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

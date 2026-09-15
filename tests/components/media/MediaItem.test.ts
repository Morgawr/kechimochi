import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    disconnect,
    mockServices,
    resetCoverLoaderTestState,
    triggerLatestIntersection,
} from './media_cover_test_utils';
import { MediaItem } from '../../../src/media/MediaItem';
import { MediaCoverLoader } from '../../../src/media/cover_loader';
import * as api from '../../../src/api';
import { Media } from '../../../src/api';

class MediaItemTestHarness extends MediaItem {
    public declare state: MediaItem['state'];
}

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
        vi.mocked(api.readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        // Mock URL.createObjectURL
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:abc');

        const media = { title: 'T', cover_image: '/path/to/img.jpg', status: 'Active' };
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());
        component.render();

        // Simulate intersection
        triggerLatestIntersection();

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
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());

        triggerLatestIntersection();

        await vi.waitUntil(() => component.state.imgSrc === 'https://covers.example/test.jpg');
        expect(mockServices.loadCoverImage).toHaveBeenCalledWith('/path/to/web.jpg');
        expect(api.readFileBytes).not.toHaveBeenCalled();
    });

    it('should load eager covers without waiting for an intersection', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:eager');

        const media = { title: 'Eager', cover_image: '/path/to/eager.jpg', status: 'Active' };
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn(), undefined, true);
        component.render();

        await vi.waitUntil(() => component.state.imgSrc === 'blob:eager');

        expect(api.readFileBytes).toHaveBeenCalledWith('/path/to/eager.jpg');
        expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:eager');
    });

    it('should reuse cached cover images without reading bytes again', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:cached');

        const media = { title: 'Cached', cover_image: '/path/to/cached.jpg', status: 'Active' };
        const first = new MediaItemTestHarness(document.createElement('div'), media as unknown as Media, vi.fn());
        triggerLatestIntersection();
        await vi.waitUntil(() => first.state.imgSrc === 'blob:cached');

        const second = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());
        triggerLatestIntersection();
        await vi.waitUntil(() => second.state.imgSrc === 'blob:cached');

        expect(api.readFileBytes).toHaveBeenCalledTimes(1);
    });

    it('reconciles a retained cover after its desktop object URL is invalidated', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        globalThis.URL.createObjectURL = vi.fn()
            .mockReturnValueOnce('blob:retained-cover-1')
            .mockReturnValueOnce('blob:retained-cover-2');

        const media = {
            title: 'Retained Cover',
            cover_image: '/path/to/retained.jpg',
            status: 'Active',
        };
        const component = new MediaItem(container, media as unknown as Media, vi.fn(), undefined, true);
        component.render();
        await vi.waitFor(() => {
            expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retained-cover-1');
        });

        MediaCoverLoader.clear();
        await component.reconcileCoverUrl();

        expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retained-cover-2');
        expect(api.readFileBytes).toHaveBeenCalledTimes(2);
        component.destroy();
    });


    it('should handle image load failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.mocked(api.readFileBytes).mockRejectedValue(new Error('File not found'));
        const media = { title: 'T', cover_image: '/bad/path.jpg', status: 'Active' };
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());

        triggerLatestIntersection();

        // Wait a bit for the async image loading to "fail"
        await new Promise(r => setTimeout(r, 10));
        expect(component.state.imgSrc).toBeNull();

        consoleSpy.mockRestore();
    });

    it('should not commit a cover that resolves after the item is destroyed', async () => {
        let resolveBytes: (bytes: ArrayBuffer) => void = (_bytes: ArrayBuffer) => undefined;
        vi.mocked(api.readFileBytes).mockReturnValue(new Promise(resolve => {
            resolveBytes = resolve;
        }));
        const createObjectUrl = vi.fn(() => 'blob:late');
        globalThis.URL.createObjectURL = createObjectUrl;

        const media = { title: 'Removed', cover_image: '/path/to/late.jpg', status: 'Active' };
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());
        component.render();
        triggerLatestIntersection();
        await vi.waitFor(() => expect(api.readFileBytes).toHaveBeenCalledWith('/path/to/late.jpg'));

        component.destroy();
        resolveBytes(new Uint8Array([1, 2, 3]).buffer);
        await vi.waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce());
        await new Promise(resolve => setTimeout(resolve, 0));

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

        expect(container.querySelector('.is-archived')).not.toBeNull();
        expect(container.querySelector('.grid-item-type-badge')).toBeNull();
    });

    it('should dim archived items on an inner element instead of the animated container so the fade-in animation cannot override it', () => {
        container.style.animation = 'fadeIn 0.25s ease-out 0s forwards';
        const media = { title: 'Archived Item', status: 'Archived', content_type: 'Anime', tracking_status: 'Complete' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.style.opacity).toBe('');
        expect(container.style.animation).not.toBe('');

        const archivedElement = container.querySelector('.is-archived') as HTMLElement | null;
        expect(archivedElement).not.toBeNull();
        expect(archivedElement?.style.animation).toBe('');
        expect(archivedElement?.querySelector('.grid-item-type-badge')).not.toBeNull();
        expect(archivedElement?.querySelector('.status-led')).not.toBeNull();
    });

    it('should not dim non-archived items', () => {
        const media = { title: 'Active Item', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.querySelector('.is-archived')).toBeNull();
    });

    it('should not set an inline height so the wrapper stylesheet rule controls item height', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.style.height).toBe('');
    });

    it('should set data-media-id from the media id', () => {
        const media = { id: 42, title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.dataset.mediaId).toBe('42');
    });

    it('should not set data-media-id when the media has no id', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.dataset.mediaId).toBeUndefined();
    });

    it('should set data-tracking-status from a tracked status and drop it for Untracked', () => {
        const media = { id: 1, title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.dataset.trackingStatus).toBe('Ongoing');

        component.setState({ media: { ...media, tracking_status: 'Untracked' } as unknown as Media });
        expect(container.dataset.trackingStatus).toBeUndefined();
    });

    it('should render the title in the overlay rather than the placeholder for a card without a cover', () => {
        const withoutCover = { title: 'No Cover', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const componentWithoutCover = new MediaItem(container, withoutCover as unknown as Media, vi.fn());
        componentWithoutCover.render();

        const overlay = container.querySelector('.grid-item-overlay');
        expect(overlay?.querySelector('.grid-item-title')?.textContent).toBe('No Cover');
        expect(container.querySelector('.image-placeholder')?.textContent?.trim()).toBe('No Image');
    });

    it('should render the variant beneath the title when the media has one', () => {
        const media = { title: 'With Variant', variant: 'TV Series', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        const overlay = container.querySelector('.grid-item-overlay');
        expect(overlay?.querySelector('.grid-item-variant')?.textContent).toBe('TV Series');
    });

    it('should omit the variant element when the media has none', () => {
        const media = { title: 'No Variant', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.querySelector('.grid-item-variant')).toBeNull();
    });

    it('should keep the title overlay after a cover image replaces the placeholder', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:committed');

        const media = { title: 'Committed', cover_image: '/path/to/committed.jpg', status: 'Active' };
        const component = new MediaItemTestHarness(container, media as unknown as Media, vi.fn());
        component.render();

        triggerLatestIntersection();
        await vi.waitUntil(() => component.state.imgSrc === 'blob:committed');

        const overlay = container.querySelector('.grid-item-overlay');
        expect(overlay?.previousElementSibling?.classList.contains('media-grid-cover-image')).toBe(true);
        expect(overlay?.querySelector('.grid-item-title')?.textContent).toBe('Committed');
    });

    it('should preserve contentVisibility and containIntrinsicSize set on the container before rendering', () => {
        container.style.contentVisibility = 'auto';
        container.style.containIntrinsicSize = '180px 320px';

        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as unknown as Media, vi.fn());
        component.render();

        expect(container.style.contentVisibility).toBe('auto');
        expect(container.style.containIntrinsicSize).toBe('180px 320px');
    });
});

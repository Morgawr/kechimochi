import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaItem } from '../../../src/components/media/MediaItem';
import * as api from '../../../src/api';

vi.mock('../../../src/api', () => ({
    readFileBytes: vi.fn(),
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
    });

    it('should render title and placeholder initially', () => {
        const media = { title: 'Test Media', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        const component = new MediaItem(container, media as any, vi.fn());
        component.render();

        expect(container.textContent).toContain('Test Media');
        expect(container.textContent).toContain('No Image');
    });

    it('should trigger click callback', () => {
        const onClick = vi.fn();
        const media = { title: 'T', status: 'Active', content_type: 'Anime', tracking_status: 'Untracked' };
        new MediaItem(container, media as any, onClick);
        
        container.click();
        expect(onClick).toHaveBeenCalled();
    });

    it('should load image when intersecting', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        // Mock URL.createObjectURL
        global.URL.createObjectURL = vi.fn(() => 'blob:abc');

        const media = { title: 'T', cover_image: '/path/to/img.jpg', status: 'Active' };
        const component = new MediaItem(container, media as any, vi.fn());
        
        // Simulate intersection
        const observerCallback = (vi.mocked(IntersectionObserver) as any).mock.calls[0][0];
        observerCallback([{ isIntersecting: true }]);
        
        await vi.waitUntil(() => (component as any).state.imgSrc === 'blob:abc');
        component.render();

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img?.src).toBe('blob:abc');
        expect(disconnect).toHaveBeenCalled();
    });

    it('should handle image load failure', async () => {
        const originalError = console.error;
        console.error = vi.fn();

        vi.mocked(api.readFileBytes).mockRejectedValue(new Error('File not found'));
        const media = { title: 'T', cover_image: '/bad/path.jpg', status: 'Active' };
        const component = new MediaItem(container, media as any, vi.fn());
        
        const observerCallback = (vi.mocked(IntersectionObserver) as any).mock.calls[0][0];
        observerCallback([{ isIntersecting: true }]);
        
        // Wait a bit for the async image loading to "fail"
        await new Promise(r => setTimeout(r, 10));
        expect((component as any).state.imgSrc).toBeNull();

        console.error = originalError;
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaGrid } from '../../../src/components/media/MediaGrid';
import { MediaItem } from '../../../src/components/media/MediaItem';
import { Media } from '../../../src/api';

vi.mock('../../../src/components/media/MediaItem', () => ({
    MediaItem: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    })),
}));

describe('MediaGrid', () => {
    let container: HTMLElement;
    let requestAnimationFrameSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        vi.useFakeTimers();
        requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders media items in the grid', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Item 2', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
        ];
        const component = new MediaGrid(container, { mediaList: mediaList as Media[] }, vi.fn());

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Item 1' }), expect.any(Function));
        expect(container.querySelector('#media-grid-container')).not.toBeNull();
    });

    it('shows the empty state when no media is available', () => {
        const component = new MediaGrid(container, { mediaList: [] }, vi.fn());

        component.render();

        expect(container.textContent).toContain('No media matches your filters.');
        expect(MediaItem).not.toHaveBeenCalled();
    });

    it('renders additional batches for long grids', () => {
        const mediaList = Array.from({ length: 22 }, (_, index) => ({
            id: index + 1,
            title: `Item ${index + 1}`,
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
        }));
        const component = new MediaGrid(container, { mediaList: mediaList as Media[] }, vi.fn());

        component.render();
        expect(MediaItem).toHaveBeenCalledTimes(15);

        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(22);
        expect(requestAnimationFrameSpy).toHaveBeenCalled();
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Media } from '../../../src/api';
import { MediaList } from '../../../src/components/media/MediaList';
import { MediaListItem } from '../../../src/components/media/MediaListItem';

vi.mock('../../../src/components/media/MediaListItem', () => ({
    MediaListItem: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    })),
}));

describe('MediaList', () => {
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

    it('shows an empty state when no list items match', () => {
        const component = new MediaList(
            container,
            { mediaList: [], metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();

        expect(container.textContent).toContain('No media matches your filters.');
        expect(MediaListItem).not.toHaveBeenCalled();
    });

    it('renders list items with per-media metrics and click handlers', () => {
        const onMediaClick = vi.fn();
        const mediaList = [
            { id: 1, title: 'Tracked', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { title: 'Unsaved', status: 'Active', content_type: 'Unknown', tracking_status: 'Untracked' },
        ];
        const metrics = {
            1: {
                firstActivityDate: '2026-03-01',
                lastActivityDate: '2026-03-10',
                totalMinutes: 150,
            },
        };

        const component = new MediaList(
            container,
            { mediaList: mediaList as Media[], metricsByMediaId: metrics, isMetricsLoading: true },
            onMediaClick,
        );

        component.render();

        expect(MediaListItem).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaListItem)).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({ title: 'Tracked' }),
            metrics[1],
            true,
            expect.any(Function),
        );
        expect(vi.mocked(MediaListItem)).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({ title: 'Unsaved' }),
            null,
            true,
            expect.any(Function),
        );

        const firstClickHandler = vi.mocked(MediaListItem).mock.calls[0][4];
        firstClickHandler();
        expect(onMediaClick).toHaveBeenCalledWith(1);
    });

    it('renders additional batches for long lists', () => {
        const mediaList = Array.from({ length: 25 }, (_, index) => ({
            id: index + 1,
            title: `Item ${index + 1}`,
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
        }));

        const component = new MediaList(
            container,
            { mediaList: mediaList as Media[], metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        expect(MediaListItem).toHaveBeenCalledTimes(18);

        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(25);
        expect(requestAnimationFrameSpy).toHaveBeenCalled();
    });

    it('stops queued batch rendering after destroy', () => {
        const mediaList = Array.from({ length: 25 }, (_, index) => ({
            id: index + 1,
            title: `Item ${index + 1}`,
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
        }));

        const component = new MediaList(
            container,
            { mediaList: mediaList as Media[], metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        component.destroy();
        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(18);
    });
});

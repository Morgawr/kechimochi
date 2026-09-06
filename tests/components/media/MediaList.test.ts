import { describe, it, expect, vi } from 'vitest';
import { Media } from '../../../src/api';
import { MediaList } from '../../../src/media/MediaList';
import { MediaListItem } from '../../../src/media/MediaListItem';
import type { LibraryRow } from '../../../src/media/sorting';
import { toLibraryItemRows } from '../../../src/media/sorting';
import { createCollectionMediaList, useCollectionRenderTestEnv } from './collection_test_utils';

vi.mock('../../../src/media/MediaListItem', () => ({
    MediaListItem: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        destroy: vi.fn(),
        reconcileCoverUrl: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn(),
    })),
}));

describe('MediaList', () => {
    const env = useCollectionRenderTestEnv();

    it('shows an empty state when no list items match', () => {
        const component = new MediaList(
            env.container,
            { rows: [], metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();

        expect(env.container.textContent).toContain('No media matches your filters.');
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
                totalCharacters: 3000,
            },
        };

        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList as Media[]), metricsByMediaId: metrics, isMetricsLoading: true },
            onMediaClick,
        );

        component.render();

        expect(MediaListItem).toHaveBeenCalledTimes(2);
        const listContainer = env.container.querySelector<HTMLElement>('#media-list-container');
        expect(listContainer?.style.minWidth).toBe('0');
        const firstWrapper = vi.mocked(MediaListItem).mock.calls[0][0] as HTMLElement;
        expect(firstWrapper.style.containIntrinsicSize).toBe('auto 168px');
        expect(vi.mocked(MediaListItem)).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({ title: 'Tracked' }),
            metrics[1],
            true,
            expect.any(Function),
            expect.anything(),
            true,
        );
        expect(vi.mocked(MediaListItem)).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({ title: 'Unsaved' }),
            null,
            true,
            expect.any(Function),
            expect.anything(),
            true,
        );

        const firstClickHandler = vi.mocked(MediaListItem).mock.calls[0][4];
        firstClickHandler();
        expect(onMediaClick).toHaveBeenCalledWith(1);
    });

    it('renders additional batches for long lists', () => {
        const mediaList = createCollectionMediaList(25);

        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        expect(MediaListItem).toHaveBeenCalledTimes(18);

        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(25);
        expect(env.requestAnimationFrameSpy).toHaveBeenCalled();
    });

    it('reconciles covers without rebuilding the retained list', async () => {
        const component = new MediaList(
            env.container,
            {
                rows: toLibraryItemRows(createCollectionMediaList(2)),
                metricsByMediaId: {},
                isMetricsLoading: false,
            },
            vi.fn(),
        );
        component.render();
        const itemInstances = vi.mocked(MediaListItem).mock.results
            .map(result => result.value as { reconcileCoverUrl: ReturnType<typeof vi.fn> });

        await component.reconcileCoverUrls();

        expect(MediaListItem).toHaveBeenCalledTimes(2);
        itemInstances.forEach(instance => {
            expect(instance.reconcileCoverUrl).toHaveBeenCalledOnce();
        });
    });

    it('stops queued batch rendering after destroy', () => {
        const mediaList = createCollectionMediaList(25);

        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        component.destroy();
        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(18);
    });

    it('stops queued batch rendering when superseded by a new render', () => {
        const mediaList = createCollectionMediaList(25);

        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        expect(MediaListItem).toHaveBeenCalledTimes(18);

        const supersedingMediaList = createCollectionMediaList(3);
        component.setState({ rows: toLibraryItemRows(supersedingMediaList) });
        expect(MediaListItem).toHaveBeenCalledTimes(18 + 3);

        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(18 + 3);
        const listContainer = env.container.querySelector('#media-list-container');
        expect(listContainer?.children).toHaveLength(3);
    });

    it('updates only the target card in place via setState, passing refreshed metrics', async () => {
        const mediaList = createCollectionMediaList(2);
        const metrics = { 1: { firstActivityDate: '2026-01-01', lastActivityDate: '2026-01-02', totalMinutes: 30, totalCharacters: 500 } };
        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: metrics, isMetricsLoading: false },
            vi.fn(),
        );
        component.render();
        vi.runAllTimers();
        const itemInstances = vi.mocked(MediaListItem).mock.results.map(result => result.value as { setState: ReturnType<typeof vi.fn> });

        const updatedMedia = { ...mediaList[0], title: 'Renamed' };
        await component.updateMediaItem(updatedMedia, metrics[1]);

        expect(itemInstances[0].setState).toHaveBeenCalledWith({ media: updatedMedia, metrics: metrics[1] });
        expect(itemInstances[1].setState).not.toHaveBeenCalled();
    });

    it('refreshes the target card cover before re-rendering it', async () => {
        const mediaList = createCollectionMediaList(1);
        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );
        component.render();
        vi.runAllTimers();
        const item = vi.mocked(MediaListItem).mock.results[0].value as {
            setState: ReturnType<typeof vi.fn>,
            reconcileCoverUrl: ReturnType<typeof vi.fn>,
        };

        await component.updateMediaItem({ ...mediaList[0], title: 'Renamed' }, null);

        expect(item.reconcileCoverUrl).toHaveBeenCalledOnce();
        expect(item.reconcileCoverUrl.mock.invocationCallOrder[0])
            .toBeLessThan(item.setState.mock.invocationCallOrder[0]);
    });

    it('removes a card from the DOM and destroys its component', () => {
        const mediaList = createCollectionMediaList(2);
        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );
        component.render();
        vi.runAllTimers();
        const itemInstances = vi.mocked(MediaListItem).mock.results.map(result => result.value as { destroy: ReturnType<typeof vi.fn> });
        expect(component.getMediaElement(1)).not.toBeNull();

        component.removeMediaItem(1);

        expect(itemInstances[0].destroy).toHaveBeenCalledOnce();
        expect(component.getMediaElement(1)).toBeNull();
    });

    it('reports rendering complete only after the incremental batches finish', () => {
        const mediaList = createCollectionMediaList(25);
        const component = new MediaList(
            env.container,
            { rows: toLibraryItemRows(mediaList), metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        expect(component.isRenderingComplete()).toBe(false);

        vi.runAllTimers();
        expect(component.isRenderingComplete()).toBe(true);
    });

    it('renders a full-width header row without instantiating a list item', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const rows: LibraryRow[] = [
            { kind: 'header', contentType: 'Manga' },
            ...toLibraryItemRows(mediaList as Media[]),
        ];
        const component = new MediaList(
            env.container,
            { rows, metricsByMediaId: {}, isMetricsLoading: false },
            vi.fn(),
        );

        component.render();
        vi.runAllTimers();

        expect(MediaListItem).toHaveBeenCalledTimes(1);
        const headerElement = env.container.querySelector('.media-library-section-header') as HTMLElement;
        expect(headerElement).not.toBeNull();
        expect(headerElement.textContent).toBe('Manga');
    });
});

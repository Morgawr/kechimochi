import { describe, it, expect, vi } from 'vitest';
import { MediaGrid } from '../../../src/media/MediaGrid';
import { MediaItem } from '../../../src/media/MediaItem';
import { Media } from '../../../src/api';
import type { LibraryRow } from '../../../src/media/sorting';
import { toLibraryItemRows } from '../../../src/media/sorting';
import { createCollectionMediaList, useCollectionRenderTestEnv } from './collection_test_utils';

vi.mock('../../../src/media/MediaItem', () => ({
    MediaItem: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    })),
}));

describe('MediaGrid', () => {
    const env = useCollectionRenderTestEnv();

    it('renders media items in the grid', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Item 2', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
        ];
        const component = new MediaGrid(env.container, { rows: toLibraryItemRows(mediaList as Media[]) }, vi.fn());

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Item 1' }), expect.any(Function));
        expect(env.container.querySelector('#media-grid-container')).not.toBeNull();
    });

    it('shows the empty state when no media is available', () => {
        const component = new MediaGrid(env.container, { rows: [] }, vi.fn());

        component.render();

        expect(env.container.textContent).toContain('No media matches your filters.');
        expect(MediaItem).not.toHaveBeenCalled();
    });

    it('renders additional batches for long grids', () => {
        const mediaList = createCollectionMediaList(22);
        const component = new MediaGrid(env.container, { rows: toLibraryItemRows(mediaList) }, vi.fn());

        component.render();
        expect(MediaItem).toHaveBeenCalledTimes(15);

        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(22);
        expect(env.requestAnimationFrameSpy).toHaveBeenCalled();
    });

    it('renders a full-width header row without instantiating a media item', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const rows: LibraryRow[] = [
            { kind: 'header', contentType: 'Manga', label: 'Manga' },
            ...toLibraryItemRows(mediaList as Media[]),
        ];
        const component = new MediaGrid(env.container, { rows }, vi.fn());

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(1);
        const headerElement = env.container.querySelector('.media-library-section-header') as HTMLElement;
        expect(headerElement).not.toBeNull();
        expect(headerElement.textContent).toBe('Manga');
        expect(headerElement.style.gridColumn).toBe('1 / -1');
    });
});
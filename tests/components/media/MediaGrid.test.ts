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
        destroy: vi.fn(),
    })),
}));

describe('MediaGrid', () => {
    const env = useCollectionRenderTestEnv();

    it('renders media items in the grid', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Item 2', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
        ];
        const component = new MediaGrid(env.container, { rows: toLibraryItemRows(mediaList as Media[]), gridZoom: 100 }, vi.fn());

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ title: 'Item 1' }),
            expect.any(Function),
            expect.anything(),
            true,
        );
        expect(env.container.querySelector('#media-grid-container')).not.toBeNull();
    });

    it('shows the empty state when no media is available', () => {
        const component = new MediaGrid(env.container, { rows: [], gridZoom: 100 }, vi.fn());

        component.render();

        expect(env.container.textContent).toContain('No media matches your filters.');
        expect(MediaItem).not.toHaveBeenCalled();
    });

    it('renders additional batches for long grids', () => {
        const mediaList = createCollectionMediaList(22);
        const component = new MediaGrid(env.container, { rows: toLibraryItemRows(mediaList), gridZoom: 100 }, vi.fn());

        component.render();
        expect(MediaItem).toHaveBeenCalledTimes(15);

        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(22);
        expect(env.requestAnimationFrameSpy).toHaveBeenCalled();
    });

    it('keeps the first batch bounded across many sections', () => {
        const contentTypes = ['Anime', 'Manga', 'Movie', 'Novel', 'Videogame'];
        const rows: LibraryRow[] = [];
        let id = 1;
        for (const contentType of contentTypes) {
            rows.push({ kind: 'header', contentType });
            for (let i = 0; i < 6; i += 1) {
                rows.push({
                    kind: 'item',
                    media: {
                        id,
                        title: `Item ${id}`,
                        status: 'Active',
                        content_type: contentType,
                        tracking_status: 'Ongoing',
                    } as Media,
                });
                id += 1;
            }
        }
        const component = new MediaGrid(env.container, { rows, gridZoom: 100 }, vi.fn());

        component.render();

        expect(MediaItem).toHaveBeenCalledTimes(12);

        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(30);
    });

    it('renders a full-width header row without instantiating a media item', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const rows: LibraryRow[] = [
            { kind: 'header', contentType: 'Manga' },
            ...toLibraryItemRows(mediaList as Media[]),
        ];
        const component = new MediaGrid(env.container, { rows, gridZoom: 100 }, vi.fn());

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(1);
        const headerElement = env.container.querySelector('.media-library-section-header') as HTMLElement;
        expect(headerElement).not.toBeNull();
        expect(headerElement.textContent).toBe('Manga');
        expect(headerElement.style.gridColumn).toBe('1 / -1');
    });

    it('scales the grid tracks and intrinsic item size with the selected zoom', () => {
        const component = new MediaGrid(
            env.container,
            { rows: toLibraryItemRows(createCollectionMediaList(1)), gridZoom: 70 },
            vi.fn(),
        );

        component.render();

        const grid = env.container.querySelector<HTMLElement>('#media-grid-container');
        const item = env.container.querySelector<HTMLElement>('.media-item-wrapper');
        expect(grid?.style.gridTemplateColumns).toContain('minmax(126px, 1fr)');
        expect(grid?.style.getPropertyValue('--library-card-height')).toBe('224px');
        expect(item?.style.containIntrinsicSize).toBe('126px 224px');
    });

    it('keeps grid rows sized to their content so header rows can collapse', () => {
        const component = new MediaGrid(
            env.container,
            { rows: toLibraryItemRows(createCollectionMediaList(1)), gridZoom: 70 },
            vi.fn(),
        );

        component.render();

        const grid = env.container.querySelector<HTMLElement>('#media-grid-container');
        expect(grid?.style.gridAutoRows).toBe('min-content');
    });

    it('normalizes out-of-range zoom values before rendering', () => {
        const component = new MediaGrid(
            env.container,
            { rows: toLibraryItemRows(createCollectionMediaList(1)), gridZoom: 1000 },
            vi.fn(),
        );

        component.render();

        const grid = env.container.querySelector<HTMLElement>('#media-grid-container');
        expect(grid?.style.gridTemplateColumns).toContain('minmax(234px, 1fr)');
        expect(grid?.style.getPropertyValue('--library-card-height')).toBe('416px');
    });
});

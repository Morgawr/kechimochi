import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Media } from '../../../src/api';
import { MediaLibraryBrowser } from '../../../src/media/MediaLibraryBrowser';
import type { LibraryLayoutMode } from '../../../src/media/library_types';

vi.mock('../../../src/api', () => ({
    addMedia: vi.fn(),
    addMilestone: vi.fn(),
    deleteMedia: vi.fn(),
    getLogsForMedia: vi.fn(),
    updateMedia: vi.fn(),
    getAllMedia: vi.fn(),
    addLog: vi.fn(),
    updateLog: vi.fn(),
}));
vi.mock('../../../src/media/modal', () => ({ showAddMediaModal: vi.fn() }));

function makeMedia(id: number, title: string, overrides: Partial<Media> = {}): Media {
    return {
        id,
        title,
        status: 'Active',
        content_type: 'Anime',
        tracking_status: 'Ongoing',
        default_activity_type: 'Watching',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        ...overrides,
    } as Media;
}

function createState(mediaList: Media[]) {
    return {
        mediaList,
        searchQuery: '',
        typeFilters: [],
        statusFilters: [],
        hideArchived: false,
        preferredLayout: 'grid' as LibraryLayoutMode,
        gridZoom: 100,
        isGridSupported: true,
        listMetricsByMediaId: {},
        isListMetricsLoading: false,
    };
}

describe('MediaLibraryBrowser context menu resolution and in-place mutation', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: true,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
    });

    afterEach(() => {
        container.remove();
        document.querySelectorAll('.popup-menu').forEach((el) => el.remove());
    });

    function buildBrowser(mediaList: Media[], onActionCommitted?: () => Promise<void>): MediaLibraryBrowser {
        const component = new MediaLibraryBrowser(
            container,
            createState(mediaList),
            vi.fn(),
            vi.fn(),
            undefined,
            undefined,
            undefined,
            onActionCommitted,
        );
        component.render();
        return component;
    }

    it('resolves the right-clicked media from a contextmenu dispatched on a card', () => {
        const mediaList = [makeMedia(1, 'Alpha'), makeMedia(2, 'Beta')];
        buildBrowser(mediaList);

        const card = container.querySelector('[data-media-id="2"]') as HTMLElement;
        card.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 5, clientY: 5,
        }));

        const menu = document.querySelector('.popup-menu');
        expect(menu?.getAttribute('aria-label')).toBe('Actions for Beta');
    });

    it('moves a mutated item within its tier without rebuilding the container, keeping other cards in relative order', async () => {
        const mediaList = [makeMedia(1, 'Alpha'), makeMedia(2, 'Beta'), makeMedia(3, 'Gamma')];
        const component = buildBrowser(mediaList);

        const containerBefore = container.querySelector('#media-grid-container');
        const updatedMedia = { ...mediaList[1], tracking_status: 'Complete' };
        const freshMediaList = mediaList.map((media) => (media.id === 2 ? updatedMedia : media));

        await component.applyLibraryMutation({ kind: 'updated', mediaId: 2, media: updatedMedia }, freshMediaList, {});

        const containerAfter = container.querySelector('#media-grid-container');
        expect(containerAfter).toBe(containerBefore);

        const orderedIds = Array.from(container.querySelectorAll('[data-media-id]'))
            .map((el) => el.getAttribute('data-media-id'));
        expect(orderedIds).toEqual(['1', '3', '2']);
    });

    it('removes a deleted item from the DOM in place', async () => {
        const mediaList = [makeMedia(1, 'Alpha'), makeMedia(2, 'Beta'), makeMedia(3, 'Gamma')];
        const component = buildBrowser(mediaList);
        const containerBefore = container.querySelector('#media-grid-container');

        const freshMediaList = mediaList.filter((media) => media.id !== 2);
        await component.applyLibraryMutation({ kind: 'deleted', mediaId: 2 }, freshMediaList, {});

        expect(container.querySelector('#media-grid-container')).toBe(containerBefore);
        const orderedIds = Array.from(container.querySelectorAll('[data-media-id]'))
            .map((el) => el.getAttribute('data-media-id'));
        expect(orderedIds).toEqual(['1', '3']);
    });

    it('offers New media when the contextmenu lands outside any card', () => {
        buildBrowser([makeMedia(1, 'Alpha')]);

        const gridContainer = container.querySelector('#media-grid-container') as HTMLElement;
        gridContainer.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 5, clientY: 5,
        }));

        const menu = document.querySelector('.popup-menu');
        expect(menu?.getAttribute('aria-label')).toBe('Library actions');
        const labels = Array.from(menu?.querySelectorAll('.popup-menu-item') ?? []).map((el) => el.textContent?.trim());
        expect(labels).toEqual(['New media']);
    });

    it('suppresses the platform menu for a contextmenu outside any card', () => {
        buildBrowser([makeMedia(1, 'Alpha')]);

        const gridContainer = container.querySelector('#media-grid-container') as HTMLElement;
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
        gridContainer.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('drops a type filter and its chip once the last media of that type is deleted', async () => {
        const mediaList = [makeMedia(1, 'Alpha'), makeMedia(2, 'Beta', { content_type: 'Manga' })];
        const onFilterChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            { ...createState(mediaList), typeFilters: ['Anime', 'Manga'] },
            vi.fn(),
            vi.fn(),
            onFilterChange,
        );
        component.render();

        const mangaChip = () => container.querySelector('.media-filter-chip[data-filter-group="type"][data-filter-value="Manga"]');
        expect(mangaChip()).not.toBeNull();

        await component.applyLibraryMutation(
            { kind: 'deleted', mediaId: 2 },
            mediaList.filter((media) => media.id !== 2),
            {},
        );

        expect(mangaChip()).toBeNull();
        expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ typeFilters: ['Anime'] }));
    });

    it('closes an open context menu when the layout re-renders wholesale', () => {
        const mediaList = [makeMedia(1, 'Alpha')];
        const component = buildBrowser(mediaList);

        const card = container.querySelector('[data-media-id="1"]') as HTMLElement;
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(document.querySelector('.popup-menu')).not.toBeNull();

        component.render();

        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('closes an open context menu on destroy', () => {
        const mediaList = [makeMedia(1, 'Alpha')];
        const component = buildBrowser(mediaList);

        const card = container.querySelector('[data-media-id="1"]') as HTMLElement;
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(document.querySelector('.popup-menu')).not.toBeNull();

        component.destroy();

        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('falls back to a full re-render when a mutation arrives while still batching', async () => {
        const mediaList = Array.from({ length: 20 }, (_, index) => makeMedia(index + 1, `Item ${index + 1}`));
        const component = buildBrowser(mediaList);

        const containerBefore = container.querySelector('#media-grid-container');
        expect(containerBefore?.children.length).toBeLessThan(20);

        const updatedMedia = { ...mediaList[0], title: 'Renamed' };
        const freshMediaList = mediaList.map((media) => (media.id === 1 ? updatedMedia : media));
        await component.applyLibraryMutation({ kind: 'updated', mediaId: 1, media: updatedMedia }, freshMediaList, {});

        const containerAfter = container.querySelector('#media-grid-container');
        expect(containerAfter).not.toBe(containerBefore);
    });
});

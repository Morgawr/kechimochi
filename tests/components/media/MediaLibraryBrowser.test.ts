import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Media } from '../../../src/api';
import * as api from '../../../src/api';
import { MediaLibraryBrowser } from '../../../src/components/media/MediaLibraryBrowser';
import type { LibraryLayoutMode } from '../../../src/components/media/library_types';
import { showAddMediaModal } from '../../../src/modals';
import { MediaGrid } from '../../../src/components/media/MediaGrid';
import { MediaList } from '../../../src/components/media/MediaList';

const listInstances: Array<{ render: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock('../../../src/components/media/MediaGrid', () => ({
    MediaGrid: vi.fn().mockImplementation(() => {
        return {
            render: vi.fn(),
            destroy: vi.fn(),
        };
    }),
}));

vi.mock('../../../src/components/media/MediaList', () => ({
    MediaList: vi.fn().mockImplementation(() => {
        const instance = {
            render: vi.fn(),
            destroy: vi.fn(),
        };
        listInstances.push(instance);
        return instance;
    }),
}));

vi.mock('../../../src/modals', () => ({
    showAddMediaModal: vi.fn(),
}));

vi.mock('../../../src/api', () => ({
    addMedia: vi.fn(),
}));

const createState = (overrides: Partial<{
    mediaList: Media[];
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
    preferredLayout: LibraryLayoutMode;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, { firstActivityDate: string | null; lastActivityDate: string | null; totalMinutes: number }>;
    isListMetricsLoading: boolean;
}> = {}) => ({
    mediaList: [],
    searchQuery: '',
    typeFilters: [],
    statusFilters: [],
    hideArchived: false,
    preferredLayout: 'grid' as LibraryLayoutMode,
    isGridSupported: true,
    listMetricsByMediaId: {},
    isListMetricsLoading: false,
    ...overrides,
});

function triggerTransitionEnd(target: HTMLElement, propertyName: string) {
    const event = new Event('transitionend');
    Object.defineProperty(event, 'propertyName', { value: propertyName });
    target.dispatchEvent(event);
}

describe('MediaLibraryBrowser', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        listInstances.length = 0;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }));
    });

    it('passes the same filtered dataset to grid and list layouts', () => {
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Beta', status: 'Archived', content_type: 'Manga', tracking_status: 'Paused' },
            { id: 3, title: 'Gamma', status: 'Active', content_type: 'Anime', tracking_status: 'Complete' },
        ];

        const gridComponent = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: mediaList as Media[],
                searchQuery: 'a',
                typeFilters: ['Anime'],
                statusFilters: ['Ongoing', 'Complete'],
                preferredLayout: 'grid',
            }),
            vi.fn(),
            vi.fn(),
        );
        gridComponent.render();

        const contentContainer = container.querySelector<HTMLElement>('#media-library-content');
        expect(contentContainer?.style.minWidth).toBe('0');
        const layoutRoot = container.querySelector<HTMLElement>('.media-library-layout-root');
        expect(layoutRoot?.style.minWidth).toBe('0');

        const expectedTitles = ['Alpha', 'Gamma'];
        expect(vi.mocked(MediaGrid).mock.calls[0][1]).toEqual({
            mediaList: expect.arrayContaining([
                expect.objectContaining({ title: 'Alpha' }),
                expect.objectContaining({ title: 'Gamma' }),
            ]),
        });
        expect((vi.mocked(MediaGrid).mock.calls[0][1] as { mediaList: Media[] }).mediaList.map((media) => media.title)).toEqual(expectedTitles);

        vi.clearAllMocks();
        listInstances.length = 0;

        const listComponent = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: mediaList as Media[],
                searchQuery: 'a',
                typeFilters: ['Anime'],
                statusFilters: ['Ongoing', 'Complete'],
                preferredLayout: 'list',
            }),
            vi.fn(),
            vi.fn(),
        );
        listComponent.render();

        expect((vi.mocked(MediaList).mock.calls[0][1] as { mediaList: Media[] }).mediaList.map((media) => media.title)).toEqual(expectedTitles);
    });

    it('reuses shared add and refresh actions from the browser toolbar', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue({ title: 'New Media', type: 'Anime', contentType: 'Anime' });
        vi.mocked(api.addMedia).mockResolvedValue(123);
        const onDataChange = vi.fn().mockResolvedValue(undefined);

        const component = new MediaLibraryBrowser(
            container,
            createState(),
            vi.fn(),
            onDataChange,
        );

        component.render();
        (container.querySelector('#btn-add-media-grid') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledWith(123));
        expect(api.addMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Media' }));

        (container.querySelector('#btn-refresh-grid') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledWith());
        expect((container.querySelector('#refresh-icon') as HTMLElement).style.animation).toBe('');
    });

    it('does not add media when the modal is cancelled', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue(null);
        const onDataChange = vi.fn().mockResolvedValue(undefined);

        const component = new MediaLibraryBrowser(
            container,
            createState(),
            vi.fn(),
            onDataChange,
        );

        component.render();
        (container.querySelector('#btn-add-media-grid') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(showAddMediaModal).toHaveBeenCalled());
        expect(api.addMedia).not.toHaveBeenCalled();
        expect(onDataChange).not.toHaveBeenCalled();
    });

    it('disables the grid toggle and renders list mode when the viewport is too small', () => {
        const onLayoutChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            createState({
                preferredLayout: 'grid',
                isGridSupported: false,
            }),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            onLayoutChange,
        );

        component.render();

        const gridButton = container.querySelector('#btn-layout-grid') as HTMLButtonElement;
        const listButton = container.querySelector('#btn-layout-list') as HTMLButtonElement;

        expect(gridButton.disabled).toBe(true);
        expect(listButton.getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Grid re-enables when the window is wider.');
        expect(MediaList).toHaveBeenCalled();
        expect(MediaGrid).not.toHaveBeenCalled();

        gridButton.click();
        expect(onLayoutChange).not.toHaveBeenCalled();
    });

    it('switches layouts and ignores clicks on the already active layout', () => {
        const onLayoutChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [{ id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media],
                preferredLayout: 'list',
            }),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            onLayoutChange,
        );

        component.render();
        expect(MediaList).toHaveBeenCalledTimes(1);

        (container.querySelector('#btn-layout-list') as HTMLButtonElement).click();
        expect(onLayoutChange).not.toHaveBeenCalled();
        expect(MediaList).toHaveBeenCalledTimes(1);

        (container.querySelector('#btn-layout-grid') as HTMLButtonElement).click();
        expect(onLayoutChange).toHaveBeenCalledWith('grid');
        expect(MediaGrid).toHaveBeenCalledTimes(1);
        expect(listInstances[0]?.destroy).toHaveBeenCalled();
    });

    it('toggles the filter tray open and closed and cleans up animated styles', () => {
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [{ id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media],
            }),
            vi.fn(),
            vi.fn(),
        );

        component.render();

        const panel = container.querySelector('#media-grid-filter-panel') as HTMLElement;
        Object.defineProperty(panel, 'scrollHeight', { value: 120, configurable: true });

        const toggle = container.querySelector('#btn-toggle-filters') as HTMLButtonElement;
        toggle.click();

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(panel.classList.contains('is-expanded')).toBe(true);

        triggerTransitionEnd(panel, 'opacity');
        triggerTransitionEnd(panel, 'height');
        expect(panel.style.height).toBe('auto');
        expect(panel.style.overflow).toBe('visible');
        expect(panel.style.pointerEvents).toBe('auto');

        toggle.click();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(panel.classList.contains('is-collapsed')).toBe(true);

        triggerTransitionEnd(panel, 'opacity');
        triggerTransitionEnd(panel, 'height');
        expect(panel.style.overflow).toBe('hidden');
    });

    it('updates chip filters across add, remove, and clear flows', () => {
        const onFilterChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [
                    { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
                    { id: 2, title: 'Beta', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
                ] as Media[],
            }),
            vi.fn(),
            vi.fn(),
            onFilterChange,
        );

        component.render();
        (container.querySelector('#btn-toggle-filters') as HTMLButtonElement).click();

        (container.querySelector('[data-filter-group="status"][data-filter-value="Ongoing"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: ['Ongoing'],
            typeFilters: [],
            hideArchived: false,
        });
        expect(container.querySelector('.media-grid-filter-count')?.textContent).toBe('1');

        (container.querySelector('[data-filter-group="status"][data-filter-value="Ongoing"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
        });

        (container.querySelector('[data-filter-group="type"][data-filter-value="Anime"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: ['Anime'],
            hideArchived: false,
        });

        (container.querySelector('[data-filter-group="type"][data-filter-value="All"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
        });
    });

    it('notifies parent state when shared search and hide-archived filters change', () => {
        const onFilterChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [
                    { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
                ] as Media[],
            }),
            vi.fn(),
            vi.fn(),
            onFilterChange,
        );

        component.render();

        const search = container.querySelector('#grid-search-filter') as HTMLInputElement;
        search.value = 'alp';
        search.dispatchEvent(new Event('input'));

        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: 'alp',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
        });

        const hideArchived = container.querySelector('#grid-hide-archived') as HTMLInputElement;
        hideArchived.checked = true;
        hideArchived.dispatchEvent(new Event('change'));

        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: 'alp',
            statusFilters: [],
            typeFilters: [],
            hideArchived: true,
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Media } from '../../../src/api';
import * as api from '../../../src/api';
import { MediaLibraryBrowser } from '../../../src/media/MediaLibraryBrowser';
import type { LibraryLayoutMode } from '../../../src/media/library_types';
import type { LibraryRow } from '../../../src/media/sorting';
import { showAddMediaModal } from '../../../src/media/modal';
import { MediaGrid } from '../../../src/media/MediaGrid';
import { MediaList } from '../../../src/media/MediaList';

const listInstances: Array<{ render: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock('../../../src/media/MediaGrid', () => ({
    MediaGrid: vi.fn().mockImplementation(() => {
        return {
            render: vi.fn(),
            destroy: vi.fn(),
        };
    }),
}));

vi.mock('../../../src/media/MediaList', () => ({
    MediaList: vi.fn().mockImplementation(() => {
        const instance = {
            render: vi.fn(),
            destroy: vi.fn(),
        };
        listInstances.push(instance);
        return instance;
    }),
}));

vi.mock('../../../src/media/modal', () => ({
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
    gridZoom: number;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, { firstActivityDate: string | null; lastActivityDate: string | null; totalMinutes: number; totalCharacters: number }>;
    isListMetricsLoading: boolean;
}> = {}) => ({
    mediaList: [],
    searchQuery: '',
    typeFilters: [],
    statusFilters: [],
    hideArchived: false,
    preferredLayout: 'grid' as LibraryLayoutMode,
    gridZoom: 100,
    isGridSupported: true,
    listMetricsByMediaId: {},
    isListMetricsLoading: false,
    ...overrides,
});

function latestGridRows(): LibraryRow[] {
    const calls = vi.mocked(MediaGrid).mock.calls;
    return (calls[calls.length - 1][1] as { rows: LibraryRow[] }).rows;
}

function latestListRows(): LibraryRow[] {
    const calls = vi.mocked(MediaList).mock.calls;
    return (calls[calls.length - 1][1] as { rows: LibraryRow[] }).rows;
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
        const onGridMediaClick = vi.fn();
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
            onGridMediaClick,
            vi.fn(),
        );
        gridComponent.render();

        const contentContainer = container.querySelector<HTMLElement>('#media-library-content');
        expect(contentContainer?.style.minWidth).toBe('0');
        const layoutRoot = container.querySelector<HTMLElement>('.media-library-layout-root');
        expect(layoutRoot?.style.minWidth).toBe('0');

        const expectedTitles = ['Alpha', 'Gamma'];
        const gridRows = latestGridRows();
        expect(gridRows.every((row) => row.kind === 'item')).toBe(true);
        expect(gridRows.map((row) => (row as { media: Media }).media.title)).toEqual(expectedTitles);
        expect((vi.mocked(MediaGrid).mock.calls[0][1] as { gridZoom: number }).gridZoom).toBe(100);

        const onVisibleGridMediaClick = vi.mocked(MediaGrid).mock.calls[0][2];
        onVisibleGridMediaClick(3);
        expect(onGridMediaClick).toHaveBeenCalledWith({ mediaId: 3, navigationIds: [1, 3] });

        vi.clearAllMocks();
        listInstances.length = 0;
        const onListMediaClick = vi.fn();

        const listComponent = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: mediaList as Media[],
                searchQuery: 'a',
                typeFilters: ['Anime'],
                statusFilters: ['Ongoing', 'Complete'],
                preferredLayout: 'list',
            }),
            onListMediaClick,
            vi.fn(),
        );
        listComponent.render();

        const listRows = latestListRows();
        expect(listRows.map((row) => (row as { media: Media }).media.title)).toEqual(expectedTitles);

        const onVisibleListMediaClick = vi.mocked(MediaList).mock.calls[0][2];
        onVisibleListMediaClick(1);
        expect(onListMediaClick).toHaveBeenCalledWith({ mediaId: 1, navigationIds: [1, 3] });
    });

    it('sorts by the passed-in content type and tracking status order instead of the declaration order', () => {
        const mediaList = [
            { id: 1, title: 'A', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
            { id: 2, title: 'B', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
        ];

        const component = new MediaLibraryBrowser(
            container,
            {
                ...createState({ mediaList: mediaList as Media[] }),
                sortStages: [{ field: { kind: 'builtin', key: 'trackingStatus' }, direction: 'ascending' }],
                trackingStatusOrder: ['Complete', 'Ongoing'],
                // The "keep ongoing first" tier stage runs before every sort stage, so it would
                // pin Ongoing to the top and make the custom order unobservable.
                keepOngoingFirst: false,
            },
            vi.fn(),
            vi.fn(),
        );
        component.render();

        const rows = latestGridRows();
        expect(rows.map((row) => (row as { media: Media }).media.title)).toEqual(['A', 'B']);
    });

    it('escapes quotes in extra field names used as sort option values', () => {
        const injectedFieldName = 'Author" onfocus="globalThis.injected = true';
        const mediaList = [
            {
                id: 1, title: 'A', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing',
                extra_data: JSON.stringify({ [injectedFieldName]: '5' }),
            },
        ];

        const component = new MediaLibraryBrowser(
            container,
            {
                ...createState({ mediaList: mediaList as Media[] }),
                sortStages: [{ field: { kind: 'builtin', key: 'title' }, direction: 'ascending' }],
            },
            vi.fn(),
            vi.fn(),
        );
        component.render();

        const option = Array.from(container.querySelectorAll('option'))
            .find((candidate) => candidate.textContent === injectedFieldName);

        expect(option).toBeDefined();
        expect(option!.getAttribute('onfocus')).toBeNull();
        expect(option!.value).toBe(`extra:${injectedFieldName}`);
    });

    it('keeps ongoing first even when the custom tracking status order ranks it last', () => {
        const mediaList = [
            { id: 1, title: 'A', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
            { id: 2, title: 'B', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
        ];

        const component = new MediaLibraryBrowser(
            container,
            {
                ...createState({ mediaList: mediaList as Media[] }),
                sortStages: [{ field: { kind: 'builtin', key: 'trackingStatus' }, direction: 'ascending' }],
                trackingStatusOrder: ['Complete', 'Ongoing'],
                keepOngoingFirst: true,
            },
            vi.fn(),
            vi.fn(),
        );
        component.render();

        const rows = latestGridRows();
        expect(rows.map((row) => (row as { media: Media }).media.title)).toEqual(['B', 'A']);
    });

    it('reuses shared add and refresh actions from the browser toolbar', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue({ title: 'New Media', variant: 'TV Series', type: 'Anime', contentType: 'Anime' });
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
        expect(api.addMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Media', variant: 'TV Series' }));

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

    it('includes variants in library search', () => {
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [
                    { id: 1, title: 'Horimiya', variant: 'Manga', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' } as Media,
                    { id: 2, title: 'Horimiya Anime', variant: '', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media,
                ],
                searchQuery: 'manga',
            }),
            vi.fn(),
            vi.fn(),
        );

        component.render();

        expect(latestGridRows().map((row) => (row as { media: Media }).media.id)).toEqual([1]);
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
        expect((container.querySelector('#btn-grid-zoom-out') as HTMLButtonElement).disabled).toBe(true);
        expect((container.querySelector('#btn-grid-zoom-in') as HTMLButtonElement).disabled).toBe(true);
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

    it('adjusts, resets, and bounds the grid zoom', () => {
        const onGridZoomChange = vi.fn();
        const component = new MediaLibraryBrowser(
            container,
            createState({
                mediaList: [{ id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media],
            }),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            onGridZoomChange,
        );

        component.render();
        (container.querySelector('#btn-grid-zoom-out') as HTMLButtonElement).click();

        expect(onGridZoomChange).toHaveBeenLastCalledWith(90);
        expect(container.querySelector('#btn-grid-zoom-reset')?.textContent).toBe('90%');
        expect(vi.mocked(MediaGrid).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ gridZoom: 90 }));

        (container.querySelector('#btn-grid-zoom-reset') as HTMLButtonElement).click();
        expect(onGridZoomChange).toHaveBeenLastCalledWith(100);
        expect(container.querySelector('#btn-grid-zoom-reset')?.textContent).toBe('100%');

        for (let zoom = 110; zoom <= 130; zoom += 10) {
            (container.querySelector('#btn-grid-zoom-in') as HTMLButtonElement).click();
            expect(onGridZoomChange).toHaveBeenLastCalledWith(zoom);
        }

        const zoomIn = container.querySelector('#btn-grid-zoom-in') as HTMLButtonElement;
        expect(zoomIn.disabled).toBe(true);
        zoomIn.click();
        expect(onGridZoomChange).toHaveBeenCalledTimes(5);
    });

    it('toggles the filter tray open and closed without delaying interaction', () => {
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

        expect(panel.style.height).toBe('auto');
        expect(panel.style.overflow).toBe('visible');
        expect(panel.style.pointerEvents).toBe('auto');

        toggle.click();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(panel.classList.contains('is-collapsed')).toBe(true);

        expect(panel.style.height).toBe('0px');
        expect(panel.style.overflow).toBe('hidden');
        expect(panel.style.pointerEvents).toBe('none');
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

        (container.querySelector('[data-filter-group="status"][data-filter-value="All"]') as HTMLButtonElement).click();
        expect(onFilterChange).not.toHaveBeenCalled();

        (container.querySelector('[data-filter-group="status"][data-filter-value="Ongoing"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: ['Ongoing'],
            typeFilters: [],
            hideArchived: false,
            sortStages: [],
            groupByType: false,
            keepOngoingFirst: true,
            keepArchivedLast: true,
        });
        expect(container.querySelector('.media-grid-filter-count')?.textContent).toBe('1');

        (container.querySelector('[data-filter-group="status"][data-filter-value="Ongoing"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
            sortStages: [],
            groupByType: false,
            keepOngoingFirst: true,
            keepArchivedLast: true,
        });

        (container.querySelector('[data-filter-group="type"][data-filter-value="Anime"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: ['Anime'],
            hideArchived: false,
            sortStages: [],
            groupByType: false,
            keepOngoingFirst: true,
            keepArchivedLast: true,
        });

        (container.querySelector('[data-filter-group="type"][data-filter-value="All"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
            sortStages: [],
            groupByType: false,
            keepOngoingFirst: true,
            keepArchivedLast: true,
        });
    });

    it('notifies parent state when shared search and hide-archived filters change', async () => {
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
        expect(container.querySelector('#media-library-content')?.getAttribute('aria-busy')).toBe('true');

        await vi.waitFor(() => {
            expect(onFilterChange).toHaveBeenLastCalledWith({
                searchQuery: 'alp',
                statusFilters: [],
                typeFilters: [],
                hideArchived: false,
                sortStages: [],
                groupByType: false,
                keepOngoingFirst: true,
                keepArchivedLast: true,
            });
        });
        expect(container.querySelector('#media-library-content')?.getAttribute('aria-busy')).toBe('false');

        const hideArchived = container.querySelector('#grid-hide-archived') as HTMLInputElement;
        hideArchived.checked = true;
        hideArchived.dispatchEvent(new Event('change'));

        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: 'alp',
            statusFilters: [],
            typeFilters: [],
            hideArchived: true,
            sortStages: [],
            groupByType: false,
            keepOngoingFirst: true,
            keepArchivedLast: true,
        });
    });

    describe('sort pane', () => {
        const buildComponent = (overrides: Partial<{ mediaList: Media[]; onFilterChange: (filters: unknown) => void }> = {}) => {
            const onFilterChange = overrides.onFilterChange ?? vi.fn();
            const component = new MediaLibraryBrowser(
                container,
                createState({
                    mediaList: overrides.mediaList ?? [
                        { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
                        { id: 2, title: 'Beta', status: 'Active', content_type: 'Manga', tracking_status: 'Complete' },
                    ] as Media[],
                }),
                vi.fn(),
                vi.fn(),
                onFilterChange,
            );
            component.render();
            return { component, onFilterChange };
        };

        it('toggles the sort panel open and closed independently of the filters panel', () => {
            buildComponent();

            const filtersToggle = container.querySelector('#btn-toggle-filters') as HTMLButtonElement;
            const sortToggle = container.querySelector('#btn-toggle-sort') as HTMLButtonElement;
            const filtersPanel = container.querySelector('#media-grid-filter-panel') as HTMLElement;
            const sortPanel = container.querySelector('#media-sort-panel') as HTMLElement;

            sortToggle.click();

            expect(sortToggle.getAttribute('aria-expanded')).toBe('true');
            expect(sortPanel.classList.contains('is-expanded')).toBe(true);
            expect(filtersToggle.getAttribute('aria-expanded')).toBe('false');
            expect(filtersPanel.classList.contains('is-collapsed')).toBe(true);

            filtersToggle.click();
            expect(filtersToggle.getAttribute('aria-expanded')).toBe('true');
            expect(sortToggle.getAttribute('aria-expanded')).toBe('true');
        });

        it('shows no sort count badge with zero levels and adds a level on demand', () => {
            buildComponent();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')).toBeNull();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')?.textContent).toBe('1');
            expect(container.querySelectorAll('.media-sort-level-row')).toHaveLength(1);
        });

        it('adds multiple levels and removes one, updating the badge count', () => {
            buildComponent();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();
            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')?.textContent).toBe('2');
            expect(container.querySelectorAll('.media-sort-level-row')).toHaveLength(2);

            (container.querySelector('.media-sort-level-remove[data-level-index="0"]') as HTMLButtonElement).click();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')?.textContent).toBe('1');
            expect(container.querySelectorAll('.media-sort-level-row')).toHaveLength(1);
        });

        it('shows the tiebreaker footnote with zero sort levels', () => {
            buildComponent();

            const note = container.querySelector('.media-sort-tiebreaker-note');
            expect(note?.textContent).toBe('Ties broken by last activity (newest first)');
        });

        it('still shows the tiebreaker footnote with two sort levels', () => {
            buildComponent();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();
            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            const note = container.querySelector('.media-sort-tiebreaker-note');
            expect(note?.textContent).toBe('Ties broken by last activity (newest first)');
        });

        it('renders the tiebreaker footnote as non-interactive text with no remove control', () => {
            buildComponent();

            const note = container.querySelector('.media-sort-tiebreaker-note') as HTMLElement;
            expect(note.tagName).not.toBe('BUTTON');
            expect(note.querySelector('button')).toBeNull();
            expect(note.closest('.media-sort-level-row')).toBeNull();
        });

        it('does not count the tiebreaker footnote toward the sort level count badge', () => {
            buildComponent();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')).toBeNull();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            expect(container.querySelector('#btn-toggle-sort .media-grid-filter-count')?.textContent).toBe('1');
        });

        it('excludes a field used at an earlier level from a lower level select', () => {
            buildComponent();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();
            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            const firstSelect = container.querySelector('.media-sort-level-select[data-level-index="0"]') as HTMLSelectElement;
            const secondSelect = container.querySelector('.media-sort-level-select[data-level-index="1"]') as HTMLSelectElement;

            expect(firstSelect.value).toBe('builtin:title');

            const secondSelectValues = Array.from(secondSelect.querySelectorAll('option')).map((option) => option.value);
            expect(secondSelectValues).not.toContain('builtin:title');
        });

        it('disables the direction toggle when the level field is default', () => {
            buildComponent();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();

            const select = container.querySelector('.media-sort-level-select[data-level-index="0"]') as HTMLSelectElement;
            select.value = 'builtin:default';
            select.dispatchEvent(new Event('change'));

            const ascendingButton = container.querySelector('.media-sort-direction-option[data-level-index="0"][data-direction="ascending"]') as HTMLButtonElement;
            const descendingButton = container.querySelector('.media-sort-direction-option[data-level-index="0"][data-direction="descending"]') as HTMLButtonElement;

            expect(ascendingButton.disabled).toBe(true);
            expect(descendingButton.disabled).toBe(true);
        });

        it('flips the direction of a sort level when its toggle button is clicked', () => {
            buildComponent();

            (container.querySelector('#btn-add-sort-level') as HTMLButtonElement).click();
            (container.querySelector('.media-sort-direction-option[data-level-index="0"][data-direction="descending"]') as HTMLButtonElement).click();

            const descendingButton = container.querySelector('.media-sort-direction-option[data-level-index="0"][data-direction="descending"]') as HTMLButtonElement;
            const ascendingButton = container.querySelector('.media-sort-direction-option[data-level-index="0"][data-direction="ascending"]') as HTMLButtonElement;
            expect(descendingButton.classList.contains('is-active')).toBe(true);
            expect(ascendingButton.classList.contains('is-active')).toBe(false);
        });

        it('toggles the grouping and ordering switches and notifies the parent', () => {
            const { onFilterChange } = buildComponent();

            const groupByType = container.querySelector('#sort-group-by-type') as HTMLInputElement;
            groupByType.checked = true;
            groupByType.dispatchEvent(new Event('change'));
            expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ groupByType: true }));

            const keepOngoingFirst = container.querySelector('#sort-keep-ongoing-first') as HTMLInputElement;
            keepOngoingFirst.checked = false;
            keepOngoingFirst.dispatchEvent(new Event('change'));
            expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ keepOngoingFirst: false }));

            const keepArchivedLast = container.querySelector('#sort-keep-archived-last') as HTMLInputElement;
            keepArchivedLast.checked = false;
            keepArchivedLast.dispatchEvent(new Event('change'));
            expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ keepArchivedLast: false }));
        });

        it('disables the keep archived last switch while hide archived is on', () => {
            buildComponent();

            expect((container.querySelector('#sort-keep-archived-last') as HTMLInputElement).disabled).toBe(false);

            const hideArchived = container.querySelector('#grid-hide-archived') as HTMLInputElement;
            hideArchived.checked = true;
            hideArchived.dispatchEvent(new Event('change'));

            expect((container.querySelector('#sort-keep-archived-last') as HTMLInputElement).disabled).toBe(true);
        });

        it('groups rows into per-type headers in settings order, omitting headers for empty types', () => {
            buildComponent({
                mediaList: [
                    { id: 1, title: 'Manga Item', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
                    { id: 2, title: 'Anime Item', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
                ] as Media[],
            });

            const groupByType = container.querySelector('#sort-group-by-type') as HTMLInputElement;
            groupByType.checked = true;
            groupByType.dispatchEvent(new Event('change'));

            const rows = latestGridRows();
            const headerRows = rows.filter((row) => row.kind === 'header') as Array<{ kind: 'header'; contentType: string }>;

            expect(headerRows.map((row) => row.contentType)).toEqual(['Anime', 'Manga']);
            expect(rows.map((row) => (row.kind === 'header' ? `header:${row.contentType}` : (row as { media: Media }).media.title))).toEqual([
                'header:Anime',
                'Anime Item',
                'header:Manga',
                'Manga Item',
            ]);
        });

        it('groups media with an unrecognized content type under the same Unknown label offered as a filter chip', () => {
            buildComponent({
                mediaList: [
                    { id: 1, title: 'Manga Item', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
                    { id: 2, title: 'Legacy Item', status: 'Active', content_type: '', tracking_status: 'Ongoing' },
                ] as Media[],
            });

            expect(container.querySelector('[data-filter-group="type"][data-filter-value="Unknown"]')).not.toBeNull();

            const groupByType = container.querySelector('#sort-group-by-type') as HTMLInputElement;
            groupByType.checked = true;
            groupByType.dispatchEvent(new Event('change'));

            const rows = latestGridRows();
            const headerRows = rows.filter((row) => row.kind === 'header') as Array<{ kind: 'header'; contentType: string }>;

            expect(headerRows.map((row) => row.contentType)).toContain('Unknown');
            expect(rows.map((row) => (row.kind === 'header' ? `header:${row.contentType}` : (row as { media: Media }).media.title))).toContain('Legacy Item');
        });

        it('produces zero header rows and preserves order when grouping is off', () => {
            const mediaList = [
                { id: 1, title: 'Manga Item', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
                { id: 2, title: 'Anime Item', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            ] as Media[];
            buildComponent({ mediaList });

            const rows = latestGridRows();

            expect(rows.every((row) => row.kind === 'item')).toBe(true);
            expect(rows.map((row) => (row as { media: Media }).media.title)).toEqual(['Manga Item', 'Anime Item']);
        });
    });
});

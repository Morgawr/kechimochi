import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaView } from '../../src/media/MediaView';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { MediaLibraryBrowser } from '../../src/media/MediaLibraryBrowser';
import { MediaDetail } from '../../src/media/MediaDetail';
import { SETTING_KEYS } from '../../src/constants';

vi.mock('../../src/api', () => ({
    getLibrarySnapshot: vi.fn(),
    getAllMedia: vi.fn(),
    getLogs: vi.fn(),
    getLogsForMedia: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/media/MediaLibraryBrowser', () => ({
    MediaLibraryBrowser: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        destroy: vi.fn(),
    })),
}));

vi.mock('../../src/media/MediaDetail', () => ({
    MediaDetail: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        destroy: vi.fn(),
        updateLogs: vi.fn(() => true),
    })),
}));

interface MatchMediaStub {
    setMatches(nextMatches: boolean): void;
    addEventListenerMock: ReturnType<typeof vi.fn>;
    removeEventListenerMock: ReturnType<typeof vi.fn>;
    addListenerMock: ReturnType<typeof vi.fn>;
    removeListenerMock: ReturnType<typeof vi.fn>;
}

function stubMatchMedia(initialMatches: boolean, mode: 'modern' | 'legacy' = 'modern'): MatchMediaStub {
    let matches = initialMatches;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const addEventListenerMock = vi.fn((_: string, cb: (event: MediaQueryListEvent) => void) => listeners.add(cb));
    const removeEventListenerMock = vi.fn((_: string, cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb));
    const addListenerMock = vi.fn((cb: (event: MediaQueryListEvent) => void) => listeners.add(cb));
    const removeListenerMock = vi.fn((cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb));

    vi.stubGlobal('matchMedia', vi.fn(() => {
        const query: Record<string, unknown> = {
            get matches() {
                return matches;
            },
            media: '(min-width: 769px)',
            onchange: null,
            dispatchEvent: vi.fn(),
        };

        if (mode === 'modern') {
            query.addEventListener = addEventListenerMock;
            query.removeEventListener = removeEventListenerMock;
        } else {
            query.addListener = addListenerMock;
            query.removeListener = removeListenerMock;
        }

        return query;
    }));

    return {
        setMatches(nextMatches: boolean) {
            matches = nextMatches;
            const event = { matches } as MediaQueryListEvent;
            listeners.forEach((listener) => listener(event));
        },
        addEventListenerMock,
        removeEventListenerMock,
        addListenerMock,
        removeListenerMock,
    };
}

async function renderAndWaitForBrowser(component: MediaView) {
    component.render();
    await component.loadData();
    await vi.waitFor(() => {
        expect(MediaLibraryBrowser).toHaveBeenCalled();
    });
}

async function renderAndWaitForInitialization(component: MediaView) {
    component.render();
    await component.loadData();
    await vi.waitFor(() => {
        // @ts-expect-error - accessing private state for assertions
        if (!component.state.isInitialized) throw new Error('Not initialized');
    });
}

describe('MediaView', () => {
    let container: HTMLElement;
    let matchMediaStub: MatchMediaStub;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.clearAllMocks();
        matchMediaStub = stubMatchMedia(true);
        vi.mocked(api.getSetting).mockResolvedValue(null);
        vi.mocked(api.getLogs).mockResolvedValue([]);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        vi.mocked(api.getLibrarySnapshot).mockImplementation(async (request) => {
            const [media, logs, hideArchived, layout, gridZoom] = await Promise.all([
                api.getAllMedia(),
                api.getLogs(),
                api.getSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED),
                api.getSetting(SETTING_KEYS.LIBRARY_LAYOUT_MODE),
                api.getSetting(SETTING_KEYS.LIBRARY_GRID_ZOOM),
            ]);
            const metrics = Array.from(logs.reduce((byMedia, log) => {
                const value = byMedia.get(log.media_id) ?? {
                    media_id: log.media_id,
                    first_activity_date: log.date,
                    last_activity_date: log.date,
                    total_minutes: 0,
                };
                value.first_activity_date = value.first_activity_date < log.date ? value.first_activity_date : log.date;
                value.last_activity_date = value.last_activity_date > log.date ? value.last_activity_date : log.date;
                value.total_minutes += log.duration_minutes;
                byMedia.set(log.media_id, value);
                return byMedia;
            }, new Map<number, { media_id: number; first_activity_date: string; last_activity_date: string; total_minutes: number }>()).values());
            return {
                request_id: request.request_id,
                media,
                metrics,
                settings: {
                    hide_archived: hideArchived === 'true',
                    preferred_layout: layout === 'list' ? 'list' : 'grid',
                    grid_zoom: Number.isFinite(Number(gridZoom)) ? Number(gridZoom) : 100,
                },
            };
        });
    });

    afterEach(() => {
        container.remove();
    });

    it('loads persisted library settings into the shared browser', async () => {
        const mockMedia = [{ id: 1, title: 'Test', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getSetting).mockImplementation(async (key: string) => {
            if (key === SETTING_KEYS.GRID_HIDE_ARCHIVED) return 'true';
            if (key === SETTING_KEYS.LIBRARY_LAYOUT_MODE) return 'list';
            if (key === SETTING_KEYS.LIBRARY_GRID_ZOOM) return '80';
            return null;
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        expect(vi.mocked(MediaLibraryBrowser).mock.calls[0][1]).toEqual(expect.objectContaining({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: true,
            preferredLayout: 'list',
            gridZoom: 80,
            isGridSupported: true,
        }));
    });

    it('renders one staged loading shell before committing the initial snapshot', async () => {
        let resolveSnapshot!: (value: Awaited<ReturnType<typeof api.getLibrarySnapshot>>) => void;
        vi.mocked(api.getLibrarySnapshot).mockImplementationOnce((request) => new Promise(resolve => {
            resolveSnapshot = (value) => resolve({ ...value, request_id: request.request_id });
        }));
        const component = new MediaView(container);
        const renderSpy = vi.spyOn(component, 'render');

        component.render();
        const load = component.loadData();
        await vi.waitFor(() => expect(api.getLibrarySnapshot).toHaveBeenCalledTimes(1));

        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(container.querySelector('#media-root')).not.toBeNull();

        resolveSnapshot({
            request_id: 0,
            media: [],
            metrics: [],
            settings: { hide_archived: false, preferred_layout: 'grid', grid_zoom: 100 },
        });
        await load;

        expect(renderSpy).toHaveBeenCalledTimes(2);
        expect(MediaLibraryBrowser).toHaveBeenCalledTimes(1);
    });

    it('keeps the mounted library browser when a refreshed snapshot is unchanged', async () => {
        const mockMedia = [{
            id: 1,
            title: 'Cached Grid Item',
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
        }] as unknown as Media[];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia);
        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const initialRoot = container.querySelector('#media-root');
        expect(initialRoot?.getAttribute('data-library-request-id')).toBe('1');

        await component.loadData();

        expect(api.getLibrarySnapshot).toHaveBeenCalledTimes(2);
        expect(MediaLibraryBrowser).toHaveBeenCalledTimes(1);
        expect(container.querySelector('#media-root')).toBe(initialRoot);
        expect(initialRoot?.getAttribute('data-library-request-id')).toBe('2');
    });

    it('includes active filters in reuse checks and rebuilds only when snapshot data changes', async () => {
        const mockMedia = [{
            id: 1,
            title: 'Filtered Grid Item',
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
        }] as unknown as Media[];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia);
        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onFilterChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][4];
        onFilterChange({
            searchQuery: 'Filtered',
            typeFilters: ['Anime'],
            statusFilters: ['Ongoing'],
            hideArchived: true,
        });

        await component.loadData();
        expect(MediaLibraryBrowser).toHaveBeenCalledTimes(1);

        vi.mocked(api.getAllMedia).mockResolvedValue([{
            ...mockMedia[0],
            title: 'Filtered Grid Item Updated',
        }]);
        await component.loadData();

        expect(MediaLibraryBrowser).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
            searchQuery: 'Filtered',
            typeFilters: ['Anime'],
            statusFilters: ['Ongoing'],
            hideArchived: true,
        }));
    });

    it('uses the default grid zoom when the persisted value is malformed', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        vi.mocked(api.getSetting).mockImplementation(async (key: string) => {
            if (key === SETTING_KEYS.LIBRARY_GRID_ZOOM) return 'not-a-number';
            return null;
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls[0][1];
        expect(browserProps).toEqual(expect.objectContaining({ gridZoom: 100 }));
    });

    it('supports missing matchMedia by treating grid as available', async () => {
        vi.stubGlobal('matchMedia', undefined);
        vi.mocked(api.getAllMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
        expect(browserProps).toEqual(expect.objectContaining({ isGridSupported: true }));

        component.destroy();
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.isGridSupported).toBe(true);
    });

    it('binds and unbinds media query listeners for modern matchMedia', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const removeSpy = vi.spyOn(globalThis, 'removeEventListener');

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        expect(matchMediaStub.addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));

        component.destroy();

        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
        expect(matchMediaStub.removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('falls back to legacy addListener/removeListener matchMedia APIs', async () => {
        matchMediaStub = stubMatchMedia(true, 'legacy');
        vi.mocked(api.getAllMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        expect(matchMediaStub.addListenerMock).toHaveBeenCalledWith(expect.any(Function));

        component.destroy();

        expect(matchMediaStub.removeListenerMock).toHaveBeenCalledWith(expect.any(Function));
    });

    it('switches to detail view when a media item is clicked from the browser', async () => {
        const mockMedia = [{ id: 1, title: 'T1' }, { id: 2, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onSelect = vi.mocked(MediaLibraryBrowser).mock.calls[0][2];
        onSelect({ mediaId: 2, navigationIds: [1, 2] });

        await vi.waitFor(() => {
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.viewMode).toBe('detail');
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.currentIndex).toBe(1);
        });
        expect(MediaDetail).toHaveBeenCalled();
    });

    it('uses the visible library order as the complete detail navigation context', async () => {
        const mockMedia = [
            { id: 10, title: 'Excluded First' },
            { id: 20, title: 'Visible Last' },
            { id: 30, title: 'Visible First' },
            { id: 40, title: 'Excluded Last' },
        ];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onSelect = vi.mocked(MediaLibraryBrowser).mock.calls[0][2];
        onSelect({ mediaId: 30, navigationIds: [30, 20] });

        await vi.waitFor(() => {
            const detailProps = vi.mocked(MediaDetail).mock.calls.at(-1);
            expect(detailProps?.[1]).toEqual(expect.objectContaining({ id: 30 }));
            expect((detailProps?.[3] as Media[]).map((media) => media.id)).toEqual([30, 20]);
            expect(detailProps?.[4]).toBe(0);
        });
        expect(api.getAllMedia).toHaveBeenCalledTimes(1);

        const detailCallbacks = vi.mocked(MediaDetail).mock.calls.at(-1)?.[5];
        detailCallbacks.onNext();
        await vi.waitFor(() => expect(api.getLogsForMedia).toHaveBeenLastCalledWith(20));

        const nextDetailCallbacks = vi.mocked(MediaDetail).mock.calls.at(-1)?.[5];
        nextDetailCallbacks.onNext();
        await vi.waitFor(() => expect(api.getLogsForMedia).toHaveBeenLastCalledWith(30));

        expect(api.getLogsForMedia).not.toHaveBeenCalledWith(10);
        expect(api.getLogsForMedia).not.toHaveBeenCalledWith(40);

        const wrappedDetailCallbacks = vi.mocked(MediaDetail).mock.calls.at(-1)?.[5];
        wrappedDetailCallbacks.onBackToLibrary();
        await vi.waitFor(() => {
            const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
            expect((browserProps?.mediaList as Media[]).map((media) => media.id)).toEqual([10, 20, 30, 40]);
        });
    });

    it('preserves the detail navigation snapshot and selected identity across data refreshes', async () => {
        const initialMedia = [
            { id: 10, title: 'Visible Current' },
            { id: 20, title: 'Excluded' },
            { id: 30, title: 'Visible Previous' },
        ];
        vi.mocked(api.getAllMedia).mockResolvedValue(initialMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onSelect = vi.mocked(MediaLibraryBrowser).mock.calls[0][2];
        onSelect({ mediaId: 10, navigationIds: [30, 10] });
        await vi.waitFor(() => expect(MediaDetail).toHaveBeenCalled());

        vi.mocked(api.getAllMedia).mockResolvedValue([
            { id: 20, title: 'Excluded Refreshed' },
            { id: 10, title: 'Visible Current Refreshed' },
            { id: 30, title: 'Visible Previous Refreshed' },
        ] as unknown as Media[]);
        await component.loadData();

        const detailProps = vi.mocked(MediaDetail).mock.calls.at(-1);
        expect(detailProps?.[1]).toEqual(expect.objectContaining({ id: 10, title: 'Visible Current Refreshed' }));
        expect((detailProps?.[3] as Media[]).map((media) => media.id)).toEqual([30, 10]);
        expect(detailProps?.[4]).toBe(1);
    });

    it('returns to the library if a refresh removes the selected detail entry', async () => {
        const initialMedia = [{ id: 10, title: 'Removed' }, { id: 20, title: 'Remaining' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(initialMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onSelect = vi.mocked(MediaLibraryBrowser).mock.calls[0][2];
        onSelect({ mediaId: 10, navigationIds: [10, 20] });
        await vi.waitFor(() => {
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.viewMode).toBe('detail');
        });

        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 20, title: 'Remaining' }] as unknown as Media[]);
        await component.loadData();

        // @ts-expect-error - accessing private state for assertions
        expect(component.state.viewMode).toBe('grid');
    });

    it('supports browser jump callbacks and detail callbacks', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onDataChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][3];
        await onDataChange(20);
        expect(api.getAllMedia).toHaveBeenCalledTimes(2);

        await vi.waitFor(() => {
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.viewMode).toBe('detail');
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.currentIndex).toBe(1);
        });

        const detailCallbacks = vi.mocked(MediaDetail).mock.calls.at(-1)?.[5];
        detailCallbacks.onNext();
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.currentIndex).toBe(0));

        detailCallbacks.onPrev();
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.currentIndex).toBe(1));

        detailCallbacks.onNavigate(0);
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.currentIndex).toBe(0);

        detailCallbacks.onBack();
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.viewMode).toBe('grid'));

        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        detailCallbacks.onDelete();
        await vi.waitFor(() => expect(api.getAllMedia).toHaveBeenCalledTimes(3));
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.viewMode).toBe('grid'));
    });

    it('reloads detail logs when navigating between media', async () => {
        const mockMedia = [{ id: 10, title: 'Old' }, { id: 20, title: 'New' }];
        const oldLogs = [{
            id: 1,
            media_id: 10,
            title: 'Old',
            activity_type: 'Reading',
            duration_minutes: 30,
            characters: 1000,
            date: '2026-01-01',
            language: 'Japanese',
        }];
        const newLogs = [{
            id: 2,
            media_id: 20,
            title: 'New',
            activity_type: 'Reading',
            duration_minutes: 45,
            characters: 2000,
            date: '2026-01-02',
            language: 'Japanese',
        }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockImplementation(async (mediaId: number) => (
            mediaId === 10 ? oldLogs : newLogs
        ) as api.ActivitySummary[]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onSelect = vi.mocked(MediaLibraryBrowser).mock.calls[0][2];
        onSelect({ mediaId: 10, navigationIds: [10, 20] });

        await vi.waitFor(() => {
            const detailProps = vi.mocked(MediaDetail).mock.calls.at(-1);
            expect(detailProps?.[1]).toEqual(expect.objectContaining({ id: 10 }));
            expect(detailProps?.[2]).toEqual(oldLogs);
        });

        const detailCallbacks = vi.mocked(MediaDetail).mock.calls.at(-1)?.[5];
        detailCallbacks.onNext();

        await vi.waitFor(() => {
            const detailProps = vi.mocked(MediaDetail).mock.calls.at(-1);
            expect(api.getLogsForMedia).toHaveBeenCalledWith(20);
            expect(detailProps?.[1]).toEqual(expect.objectContaining({ id: 20 }));
            expect(detailProps?.[2]).toEqual(newLogs);
        });
    });

    it('ignores keyboard shortcuts when focus is in an editable field and handles keyboard navigation otherwise', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForInitialization(component);

        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state for assertions
        component.state.libraryMediaList = mockMedia as unknown as Media[];
        // @ts-expect-error - accessing private state for assertions
        component.state.detailMediaList = mockMedia as unknown as Media[];
        // @ts-expect-error - accessing private state for assertions
        component.state.currentIndex = 0;
        component.render();

        const input = document.createElement('input');
        // @ts-expect-error - testing private handler branch coverage
        component.keyboardHandler({ key: 'ArrowRight', target: input } as KeyboardEvent);
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.currentIndex).toBe(0);

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.currentIndex).toBe(1));

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.currentIndex).toBe(0));

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.viewMode).toBe('grid'));
    });

    it('handles mouse back-button navigation from detail view', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Mouse' }] as unknown as Media[]);

        const component = new MediaView(container);
        await renderAndWaitForInitialization(component);

        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state for assertions
        component.state.detailMediaList = [{ id: 1, title: 'Mouse' }] as unknown as Media[];
        component.render();

        const preventDefault = vi.fn();
        // @ts-expect-error - testing private handler branch coverage
        component.mouseHandler({ button: 3, preventDefault } as MouseEvent);

        // @ts-expect-error - accessing private state for assertions
        await vi.waitFor(() => expect(component.state.viewMode).toBe('grid'));
        expect(preventDefault).toHaveBeenCalled();
    });

    it('persists hide archived changes without reworking other filters', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onFilterChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][4];
        onFilterChange({
            statusFilters: ['Ongoing'],
            typeFilters: ['Anime'],
            hideArchived: true,
        });

        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.GRID_HIDE_ARCHIVED, 'true');
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.libraryFilters).toEqual({
            searchQuery: '',
            statusFilters: ['Ongoing'],
            typeFilters: ['Anime'],
            hideArchived: true,
        });
    });

    it('stores the preferred layout when the user changes it', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onLayoutChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][5];
        onLayoutChange('list');

        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.LIBRARY_LAYOUT_MODE, 'list');
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.preferredLayout).toBe('list');
    });

    it('stores the grid zoom when the user changes the cover size', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onGridZoomChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][6];
        onGridZoomChange(70);

        expect(api.setSetting).toHaveBeenCalledWith(SETTING_KEYS.LIBRARY_GRID_ZOOM, '70');
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.gridZoom).toBe(70);
    });

    it('uses list metrics from the initial atomic library snapshot', async () => {
        vi.mocked(api.getLibrarySnapshot).mockResolvedValue({
            request_id: 1,
            media: [{ id: 7, title: 'Switched Item' }] as unknown as Media[],
            metrics: [{
                media_id: 7,
                first_activity_date: '2026-03-01',
                last_activity_date: '2026-03-18',
                total_minutes: 115,
            }],
            settings: { hide_archived: false, preferred_layout: 'list', grid_zoom: 100 },
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
        expect(browserProps).toEqual(expect.objectContaining({
            preferredLayout: 'list',
            isListMetricsLoading: false,
            listMetricsByMediaId: expect.objectContaining({
                7: expect.objectContaining({
                    firstActivityDate: '2026-03-01',
                    lastActivityDate: '2026-03-18',
                    totalMinutes: 115,
                }),
            }),
        }));
        expect(api.getLibrarySnapshot).toHaveBeenCalledTimes(1);
    });

    it('renders list media reliably when a snapshot has no activity metrics', async () => {
        vi.mocked(api.getLibrarySnapshot).mockResolvedValue({
            request_id: 1,
            media: [{ id: 1, title: 'No Logs' }] as unknown as Media[],
            metrics: [],
            settings: { hide_archived: false, preferred_layout: 'list', grid_zoom: 100 },
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        expect(vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
            isListMetricsLoading: false,
            listMetricsByMediaId: {},
        }));
    });

    it('forces list mode on small windows without rewriting the saved grid preference', async () => {
        matchMediaStub = stubMatchMedia(false);
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Compact' }] as unknown as Media[]);
        vi.mocked(api.getLogs).mockResolvedValue([{
            id: 1,
            media_id: 1,
            title: 'Compact',
            activity_type: 'Watching',
            duration_minutes: 30,
            characters: 0,
            date: '2026-03-01',
            language: 'Japanese',
        }]);
        vi.mocked(api.getSetting).mockImplementation(async (key: string) => {
            if (key === SETTING_KEYS.LIBRARY_LAYOUT_MODE) return 'grid';
            return null;
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);
        expect(api.getLogs).toHaveBeenCalled();

        const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
        expect(browserProps).toEqual(expect.objectContaining({
            preferredLayout: 'grid',
            isGridSupported: false,
            isListMetricsLoading: false,
        }));
        expect(api.setSetting).not.toHaveBeenCalledWith(SETTING_KEYS.LIBRARY_LAYOUT_MODE, expect.anything());
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.preferredLayout).toBe('grid');
    });

    it('auto-restores a saved grid preference after the window becomes large again', async () => {
        matchMediaStub = stubMatchMedia(false);
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Resizable' }] as unknown as Media[]);
        vi.mocked(api.getSetting).mockImplementation(async (key: string) => {
            if (key === SETTING_KEYS.LIBRARY_LAYOUT_MODE) return 'grid';
            return null;
        });

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        matchMediaStub.setMatches(true);

        await vi.waitFor(() => {
            const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
            expect(browserProps).toEqual(expect.objectContaining({
                preferredLayout: 'grid',
                isGridSupported: true,
            }));
        });
        expect(api.setSetting).not.toHaveBeenCalledWith(SETTING_KEYS.LIBRARY_LAYOUT_MODE, 'grid');
    });

    it('resets the view and jumps directly to a specific media', async () => {
        const mockMedia = [{ id: 10, title: 'A' }, { id: 20, title: 'B' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForInitialization(component);

        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        await component.resetView();
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.viewMode).toBe('grid');

        await component.jumpToMedia(20);
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.viewMode).toBe('detail');
        // @ts-expect-error - accessing private state for assertions
        expect(component.state.currentIndex).toBe(1);
        const detailProps = vi.mocked(MediaDetail).mock.calls.at(-1);
        expect((detailProps?.[3] as Media[]).map((media) => media.id)).toEqual([10, 20]);
    });

    it('rejects an older library snapshot after a newer jump request completes', async () => {
        let resolveFirst!: (value: Awaited<ReturnType<typeof api.getLibrarySnapshot>>) => void;
        const firstSnapshot = new Promise<Awaited<ReturnType<typeof api.getLibrarySnapshot>>>(resolve => {
            resolveFirst = resolve;
        });
        vi.mocked(api.getLibrarySnapshot)
            .mockImplementationOnce(() => firstSnapshot)
            .mockImplementationOnce(async request => ({
                request_id: request.request_id,
                media: [{ id: 20, title: 'Newest' }] as unknown as Media[],
                metrics: [],
                settings: { hide_archived: false, preferred_layout: 'grid', grid_zoom: 100 },
            }));
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);
        const component = new MediaView(container);

        const oldLoad = component.loadData();
        await vi.waitFor(() => expect(api.getLibrarySnapshot).toHaveBeenCalledTimes(1));
        await component.jumpToMedia(20);
        const oldRequest = vi.mocked(api.getLibrarySnapshot).mock.calls[0][0];
        resolveFirst({
            request_id: oldRequest.request_id,
            media: [{ id: 10, title: 'Stale' }] as unknown as Media[],
            metrics: [],
            settings: { hide_archived: true, preferred_layout: 'list', grid_zoom: 70 },
        });
        await oldLoad;

        // @ts-expect-error - accessing private state for stale-response verification
        expect(component.state.libraryMediaList.map((media: Media) => media.title)).toEqual(['Newest']);
        // @ts-expect-error - accessing private state for stale-response verification
        expect(component.state.viewMode).toBe('detail');
    });

    it('logs load-data failures and clears the loading state', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.getAllMedia).mockRejectedValue(new Error('load failed'));

        const component = new MediaView(container);
        // @ts-expect-error - avoiding the render-triggered retry loop for this failure-path test
        component.state.isInitialized = true;
        await component.loadData();

        await vi.waitFor(() => {
            expect(errorSpy).toHaveBeenCalledWith('Failed to load media view content', expect.any(Error));
        });

        // @ts-expect-error - accessing private state for assertions
        expect(component.state.isLoading).toBe(false);
        errorSpy.mockRestore();
    });

    it('falls back to browser view if detail rendering has no media', () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state for assertions
        component.state.libraryMediaList = [];
        // @ts-expect-error - accessing private state for assertions
        component.state.isInitialized = true;

        component.render();

        // @ts-expect-error - accessing private state for assertions
        expect(component.state.viewMode).toBe('grid');
    });
});

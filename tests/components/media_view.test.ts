import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaView } from '../../src/media/MediaView';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { MediaLibraryBrowser } from '../../src/media/MediaLibraryBrowser';
import { MediaDetail } from '../../src/media/MediaDetail';
import { SETTING_KEYS } from '../../src/constants';

vi.mock('../../src/api', () => ({
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
    await vi.waitFor(() => {
        component.render();
        expect(MediaLibraryBrowser).toHaveBeenCalled();
    });
}

async function renderAndWaitForInitialization(component: MediaView) {
    await vi.waitFor(() => {
        component.render();
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
            isGridSupported: true,
        }));
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
        onSelect(2);

        await vi.waitFor(() => {
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.viewMode).toBe('detail');
            // @ts-expect-error - accessing private state for assertions
            expect(component.state.currentIndex).toBe(1);
        });
        expect(MediaDetail).toHaveBeenCalled();
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

    it('ignores keyboard shortcuts when focus is in an editable field and handles keyboard navigation otherwise', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await renderAndWaitForInitialization(component);

        // @ts-expect-error - accessing private state for assertions
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state for assertions
        component.state.currentMediaList = mockMedia as unknown as Media[];
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

    it('loads list metrics after switching from grid to list and aggregates first/last dates', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 7, title: 'Switched Item' }] as unknown as Media[]);
        vi.mocked(api.getLogs).mockResolvedValue([
            {
                id: 10,
                media_id: 7,
                title: 'Switched Item',
                media_type: 'Playing',
                duration_minutes: 95,
                characters: 0,
                date: '2026-03-18',
                language: 'Japanese',
            },
            {
                id: 11,
                media_id: 7,
                title: 'Switched Item',
                media_type: 'Playing',
                duration_minutes: 5,
                characters: 0,
                date: '2026-03-01',
                language: 'Japanese',
            },
            {
                id: 12,
                media_id: 7,
                title: 'Switched Item',
                media_type: 'Playing',
                duration_minutes: 15,
                characters: 0,
                date: '2026-03-05',
                language: 'Japanese',
            },
        ]);

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        const onLayoutChange = vi.mocked(MediaLibraryBrowser).mock.calls[0][5];
        onLayoutChange('list');

        await vi.waitFor(() => expect(api.getLogs).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => {
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
        });
    });

    it('falls back to empty metrics when list metric loading fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Failure Case' }] as unknown as Media[]);
        vi.mocked(api.getSetting).mockImplementation(async (key: string) => {
            if (key === SETTING_KEYS.LIBRARY_LAYOUT_MODE) return 'list';
            return null;
        });
        vi.mocked(api.getLogs).mockRejectedValue(new Error('metrics failed'));

        const component = new MediaView(container);
        await renderAndWaitForBrowser(component);

        await vi.waitFor(() => {
            const browserProps = vi.mocked(MediaLibraryBrowser).mock.calls.at(-1)?.[1];
            expect(browserProps).toEqual(expect.objectContaining({
                isListMetricsLoading: false,
                listMetricsByMediaId: {},
            }));
        });
        expect(errorSpy).toHaveBeenCalledWith('Failed to load list activity metrics', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('forces list mode on small windows without rewriting the saved grid preference', async () => {
        matchMediaStub = stubMatchMedia(false);
        vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Compact' }] as unknown as Media[]);
        vi.mocked(api.getLogs).mockResolvedValue([{
            id: 1,
            media_id: 1,
            title: 'Compact',
            media_type: 'Watching',
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
        await vi.waitFor(() => {
            component.render();
            expect(MediaLibraryBrowser).toHaveBeenCalled();
            expect(api.getLogs).toHaveBeenCalled();
        });

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
        component.state.currentMediaList = [];
        // @ts-expect-error - accessing private state for assertions
        component.state.isInitialized = true;

        component.render();

        // @ts-expect-error - accessing private state for assertions
        expect(component.state.viewMode).toBe('grid');
    });
});

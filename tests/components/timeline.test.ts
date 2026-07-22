import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../src/api';
import type { TimelineEvent, TimelinePage, TimelinePageRequest } from '../../src/types';
import { TimelineView } from '../../src/timeline/TimelineView';
import { Logger } from '../../src/logger';

const coverMocks = vi.hoisted(() => ({
    load: vi.fn(),
    getCached: vi.fn(),
}));

vi.mock('../../src/api', () => ({
    getTimelinePage: vi.fn(),
}));

vi.mock('../../src/media/cover_loader', () => ({
    MediaCoverLoader: coverMocks,
}));

interface TimelineInternal extends TimelineView {
    state: {
        events: TimelineEvent[];
        availableYears: number[];
        ambiguousTitles: string[];
        summary: TimelinePage['summary'];
        totalCount: number;
        allEventCount: number;
        hasMore: boolean;
        searchQuery: string;
        selectedYear: string;
        selectedKind: 'all' | TimelineEvent['kind'];
        isLoading: boolean;
        isLoadingMore: boolean;
        isInitialized: boolean;
    };
    loadPage(reset: boolean): Promise<void>;
    renderTimelineWave(root: HTMLElement, events: TimelineEvent[]): void;
    getWaveMetric(event: TimelineEvent): number;
}

const createEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
    kind: 'finished',
    date: '2024-03-15',
    mediaId: 1,
    mediaTitle: 'Novel A',
    mediaVariant: '',
    coverImage: '',
    activityType: 'Reading',
    contentType: 'Novel',
    trackingStatus: 'Complete',
    milestoneName: null,
    milestoneId: null,
    firstDate: '2024-03-01',
    lastDate: '2024-03-15',
    totalMinutes: 300,
    totalCharacters: 12_000,
    milestoneMinutes: 0,
    milestoneCharacters: 0,
    sameDayTerminal: false,
    ...overrides,
});

const sampleEvents: TimelineEvent[] = [
    createEvent(),
    createEvent({
        kind: 'milestone',
        date: '2024-03-10',
        milestoneName: 'Chapter 10',
        milestoneMinutes: 45,
    }),
    createEvent({
        kind: 'paused',
        date: '2024-02-20',
        mediaId: 2,
        mediaTitle: 'Game B',
        activityType: 'Playing',
        contentType: 'Videogame',
        trackingStatus: 'Paused',
        totalMinutes: 120,
        totalCharacters: 0,
    }),
    createEvent({
        kind: 'dropped',
        date: '2024-02-18',
        mediaId: 3,
        mediaTitle: 'Show C',
        activityType: 'Watching',
        contentType: 'Anime',
        trackingStatus: 'Dropped',
        totalMinutes: 90,
        totalCharacters: 0,
    }),
    createEvent({
        kind: 'started',
        date: '2024-01-12',
        mediaId: 4,
        mediaTitle: 'Manga E',
        contentType: 'Manga',
        trackingStatus: 'Ongoing',
        totalMinutes: 30,
        totalCharacters: 900,
    }),
];

function summarize(events: TimelineEvent[]): TimelinePage['summary'] {
    const media = new Map<number, TimelineEvent>();
    const completed = new Set<number>();
    for (const event of events) {
        if (!media.has(event.mediaId)) media.set(event.mediaId, event);
        if (event.kind === 'finished') completed.add(event.mediaId);
    }
    return {
        total_minutes: Array.from(media.values()).reduce((total, event) => total + event.totalMinutes, 0),
        completed_titles: completed.size,
        total_characters: Array.from(media.values()).reduce((total, event) => total + event.totalCharacters, 0),
    };
}

function createPage(
    request: TimelinePageRequest,
    events: TimelineEvent[],
    overrides: Partial<TimelinePage> = {},
): TimelinePage {
    const years = Array.from(new Set(events.map(event => Number(event.date.slice(0, 4)))))
        .sort((left, right) => right - left);
    return {
        request_id: request.request_id,
        offset: request.offset,
        limit: request.limit,
        total_count: events.length,
        all_event_count: events.length,
        has_more: false,
        available_years: years,
        ambiguous_titles: [],
        summary: summarize(events),
        events,
        ...overrides,
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function renderAndLoad(view: TimelineView): Promise<void> {
    view.render();
    await view.loadData();
}

describe('TimelineView', () => {
    let container: HTMLElement;
    const originalMatchMedia = globalThis.matchMedia;
    const originalIntersectionObserver = globalThis.IntersectionObserver;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.clearAllMocks();
        coverMocks.load.mockResolvedValue(null);
        coverMocks.getCached.mockReturnValue(null);
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, sampleEvents));
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: false,
            media: '(max-width: 1024px)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
        vi.stubGlobal('IntersectionObserver', undefined);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.useRealTimers();
        Object.defineProperty(globalThis, 'matchMedia', { writable: true, value: originalMatchMedia });
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: originalIntersectionObserver,
        });
    });

    it('loads one bounded page and renders grouped lifecycle copy and server summary', async () => {
        const view = new TimelineView(container);
        await renderAndLoad(view);

        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));
        expect(api.getTimelinePage).toHaveBeenCalledWith(expect.objectContaining({
            request_id: 1,
            offset: 0,
            limit: 40,
            year: null,
            kind: null,
        }));
        expect(Array.from(container.querySelectorAll('.timeline-month-label')).map(node => node.textContent?.trim()))
            .toEqual(['March 2024', 'February 2024', 'January 2024']);
        const text = container.textContent?.replaceAll(/\s+/g, ' ') ?? '';
        expect(text).toContain('Finished reading');
        expect(text).toContain('Reached "Chapter 10"');
        expect(text).toContain('Put Game B on pause');
        expect(text).toContain('Dropped Show C');
        expect(text).toContain('5h0min');
        expect(text).toContain('Characters tracked');
    });

    it('renders one staged loading shell before committing the initial page', async () => {
        const page = createDeferred<TimelinePage>();
        vi.mocked(api.getTimelinePage).mockImplementationOnce(() => page.promise);
        const view = new TimelineView(container);
        const renderSpy = vi.spyOn(view, 'render');

        view.render();
        const load = view.loadData();
        await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenCalledTimes(1));

        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Loading timeline');

        const request = vi.mocked(api.getTimelinePage).mock.calls[0][0];
        page.resolve(createPage(request, sampleEvents));
        await load;

        expect(renderSpy).toHaveBeenCalledTimes(2);
        expect(container.querySelectorAll('.timeline-entry')).toHaveLength(sampleEvents.length);
    });

    it('uses server-provided title ambiguity across page boundaries', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
            createEvent({ mediaId: 10, mediaTitle: 'Horimiya', mediaVariant: 'Manga' }),
            createEvent({ mediaId: 12, mediaTitle: 'Unique title', mediaVariant: 'Light Novel' }),
        ], { ambiguous_titles: ['Horimiya'], all_event_count: 3 }));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(2));

        const text = container.textContent?.replaceAll(/\s+/g, ' ') ?? '';
        expect(text).toContain('Horimiya — Manga');
        expect(text).toContain('Unique title');
        expect(text).not.toContain('Unique title — Light Novel');
    });

    it('debounces search and sends year and kind filters to the backend', async () => {
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelector('#timeline-search')).not.toBeNull());

        const search = container.querySelector<HTMLInputElement>('#timeline-search')!;
        search.value = 'game';
        search.dispatchEvent(new Event('input'));
        expect(container.querySelector('#timeline-root')?.getAttribute('aria-busy')).toBe('true');
        await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
            expect.objectContaining({ search_query: 'game' }),
        ));
        await vi.waitFor(() => expect(container.querySelector('#timeline-root')?.getAttribute('aria-busy')).toBe('false'));

        const year = container.querySelector<HTMLSelectElement>('#timeline-year-filter')!;
        year.value = '2024';
        year.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
            expect.objectContaining({ year: 2024 }),
        ));

        const kind = container.querySelector<HTMLSelectElement>('#timeline-kind-filter')!;
        kind.value = 'paused';
        kind.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
            expect.objectContaining({ kind: 'paused' }),
        ));
    });

    it('rejects stale filter responses by echoed request identity', async () => {
        const first = createDeferred<TimelinePage>();
        const second = createDeferred<TimelinePage>();
        vi.mocked(api.getTimelinePage)
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);
        const view = new TimelineView(container) as TimelineInternal;
        view.state.isInitialized = true;

        view.state.searchQuery = 'old';
        const firstLoad = view.loadPage(true);
        view.state.searchQuery = 'new';
        const secondLoad = view.loadPage(true);
        const secondRequest = vi.mocked(api.getTimelinePage).mock.calls[1][0];
        second.resolve(createPage(secondRequest, [createEvent({ mediaTitle: 'New result' })]));
        await secondLoad;
        const firstRequest = vi.mocked(api.getTimelinePage).mock.calls[0][0];
        first.resolve(createPage(firstRequest, [createEvent({ mediaTitle: 'Old result' })]));
        await firstLoad;

        expect(view.state.events.map(event => event.mediaTitle)).toEqual(['New result']);
    });

    it('loads subsequent pages with the current offset and preserves earlier events', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => {
            if (request.offset === 0) {
                return createPage(request, [createEvent({ mediaTitle: 'First' })], {
                    total_count: 2,
                    all_event_count: 2,
                    has_more: true,
                });
            }
            return createPage(request, [createEvent({ mediaId: 2, mediaTitle: 'Second' })], {
                total_count: 2,
                all_event_count: 2,
            });
        });
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelector('#timeline-load-more')).not.toBeNull());

        container.querySelector<HTMLButtonElement>('#timeline-load-more')!.click();
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(2));
        expect(api.getTimelinePage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1, limit: 40 }));
        expect(container.textContent).toContain('First');
        expect(container.textContent).toContain('Second');
    });

    it('commits lazy covers in place without rerendering the timeline', async () => {
        coverMocks.load.mockResolvedValue('blob:cover-a');
        const view = new TimelineView(container) as TimelineInternal;
        view.state = {
            ...view.state,
            events: [createEvent({ coverImage: '/covers/a.jpg' })],
            availableYears: [2024],
            summary: summarize([createEvent()]),
            totalCount: 1,
            allEventCount: 1,
            isInitialized: true,
        };
        const renderSpy = vi.spyOn(view, 'render');

        view.render();
        await vi.waitFor(() => expect(container.querySelector('img.timeline-cover-image')).not.toBeNull());

        expect(coverMocks.load).toHaveBeenCalledTimes(1);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cover-a');
        expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    it('renders cached covers immediately without scheduling another source read', () => {
        coverMocks.getCached.mockReturnValue('blob:cached-cover');
        const view = new TimelineView(container) as TimelineInternal;
        const event = createEvent({ coverImage: '/covers/cached.jpg' });
        view.state = {
            ...view.state,
            events: [event],
            availableYears: [2024],
            summary: summarize([event]),
            totalCount: 1,
            allEventCount: 1,
            isInitialized: true,
        };

        view.render();

        expect(container.querySelector('img.timeline-cover-image')?.getAttribute('src')).toBe('blob:cached-cover');
        expect(coverMocks.load).not.toHaveBeenCalled();
    });

    it('renders empty and failed-request states without retaining prior data', async () => {
        vi.mocked(api.getTimelinePage).mockImplementationOnce(async request => createPage(request, []));
        const emptyView = new TimelineView(container);
        await renderAndLoad(emptyView);
        await vi.waitFor(() => expect(container.textContent).toContain('No timeline yet'));

        container.replaceChildren();
        vi.mocked(api.getTimelinePage).mockRejectedValueOnce(new Error('offline'));
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const failedView = new TimelineView(container);
        await renderAndLoad(failedView);
        await vi.waitFor(() => expect(container.textContent).toContain('No timeline yet'));
        expect(errorSpy).toHaveBeenCalledWith('Failed to load timeline events', expect.any(Error));
    });

    it('dispatches media navigation from the title chip only', async () => {
        const navigate = vi.fn();
        globalThis.addEventListener('app-navigate', navigate);
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelector('.timeline-media-link')).not.toBeNull());

        container.querySelector<HTMLButtonElement>('.timeline-media-link')!.click();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect((navigate.mock.calls[0][0] as CustomEvent).detail).toEqual({
            view: 'media',
            focusMediaId: 1,
        });
        globalThis.removeEventListener('app-navigate', navigate);
    });

    it('skips the decorative wave in compact layout', () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: true,
            media: '(max-width: 1024px)',
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
        const view = new TimelineView(container) as TimelineInternal;
        const root = document.createElement('div');
        root.innerHTML = '<section class="timeline-shell"><svg class="timeline-wave"><path /></svg></section>';
        container.appendChild(root);

        view.renderTimelineWave(root, [createEvent(), createEvent({ mediaId: 2 })]);

        expect(root.querySelector('.timeline-wave')?.innerHTML).toBe('');
    });
});

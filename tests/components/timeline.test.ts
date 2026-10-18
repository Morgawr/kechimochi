import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../src/api';
import type {
    TimelineBucket,
    TimelineBucketHighlight,
    TimelineBucketPage,
    TimelineBucketRequest,
    TimelineEvent,
    TimelinePage,
    TimelinePageRequest,
} from '../../src/types';
import { TimelineView } from '../../src/timeline/TimelineView';
import { Logger } from '../../src/logger';

const coverMocks = vi.hoisted(() => ({
    load: vi.fn(),
    getCached: vi.fn(),
}));

vi.mock('../../src/api', () => ({
    getTimelinePage: vi.fn(),
    getTimelineBuckets: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/media/cover_loader', () => ({
    MediaCoverLoader: coverMocks,
}));

class TestableTimelineView extends TimelineView {
    public declare state: TimelineView['state'];

    public override loadPage(reset: boolean): Promise<void> {
        return super.loadPage(reset);
    }

    public override loadBuckets(forceRefresh: boolean): Promise<void> {
        return super.loadBuckets(forceRefresh);
    }

    public override renderTimelineWave(root: HTMLElement, waveMetrics: number[]): void {
        super.renderTimelineWave(root, waveMetrics);
    }
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
    const filtered = new Set<number>();
    for (const event of events) {
        if (!media.has(event.mediaId)) media.set(event.mediaId, event);
        if (event.kind === 'finished') completed.add(event.mediaId);
        filtered.add(event.mediaId);
    }
    return {
        total_minutes: Array.from(media.values()).reduce((total, event) => total + event.totalMinutes, 0),
        completed_titles: completed.size,
        total_characters: Array.from(media.values()).reduce((total, event) => total + event.totalCharacters, 0),
        filtered_media_count: filtered.size,
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

function createBucket(overrides: Partial<TimelineBucket> = {}): TimelineBucket {
    return {
        key: '2024-03',
        startDate: '2024-03-01',
        startedCount: 1,
        finishedCount: 0,
        pausedCount: 0,
        droppedCount: 0,
        milestoneCount: 0,
        loggedMinutes: 60,
        loggedCharacters: 0,
        highlights: [],
        distinctMediaCount: 0,
        ...overrides,
    };
}

function createBucketPage(
    request: TimelineBucketRequest,
    buckets: TimelineBucket[],
    overrides: Partial<TimelineBucketPage> = {},
): TimelineBucketPage {
    return {
        requestId: request.requestId,
        granularity: request.granularity,
        availableYears: [2024, 2023],
        ambiguousTitles: [],
        summary: { total_minutes: 0, completed_titles: 0, total_characters: 0, filtered_media_count: 0 },
        buckets,
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
        vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [createBucket()]));
        vi.mocked(api.getSetting).mockResolvedValue(null);
        vi.mocked(api.setSetting).mockResolvedValue(undefined);
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
        expect(text).toContain('Completed Novel A');
        expect(text).toContain('Milestone Novel A Chapter 10');
        expect(text).toContain('Paused Game B');
        expect(text).toContain('Dropped Show C');
        expect(text).toContain('5h');
    });

    it('renders the search input inside the search field with a "Search titles" placeholder', async () => {
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelector('#timeline-search')).not.toBeNull());

        const searchInput = container.querySelector<HTMLInputElement>('.timeline-filter-field-search #timeline-search');
        expect(searchInput?.placeholder).toBe('Search titles');
    });

    it('renders each summary item as its label followed by its value', async () => {
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-summary-item').length).toBeGreaterThan(0));

        const items = Array.from(container.querySelectorAll('.timeline-summary-item'));
        expect(items.map(item => Array.from(item.children).map(child => child.className))).toEqual(
            items.map(() => ['timeline-summary-label', 'timeline-summary-value']),
        );
        expect(items.map(item => item.querySelector('.timeline-summary-label')?.textContent)).toEqual([
            'Total time',
            'Completed titles',
            'Characters',
        ]);
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
        expect(text).toContain('Horimiya Manga');
        expect(text).toContain('Unique title Light Novel');
    });

    it('renders the detailed card title as a heading button carrying the full title', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
            createEvent({ mediaTitle: 'A very long novel title' }),
        ]));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));

        const titleButton = container.querySelector<HTMLButtonElement>('article h3 button');
        expect(titleButton?.querySelector<HTMLElement>('.timeline-card-title-text')?.title).toBe('A very long novel title');
        expect(titleButton?.textContent?.trim()).toBe('A very long novel title');
    });

    it('renders no lifecycle sentence on detailed cards', async () => {
        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(5));

        const text = container.textContent?.replaceAll(/\s+/g, ' ') ?? '';
        expect(text).not.toContain('Finished reading');
        expect(text).not.toContain('Reached "');
        expect(text).not.toContain('on pause');
    });

    it('renders the variant and the milestone name as their own lines with full text in a tooltip', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
            createEvent({ kind: 'milestone', mediaVariant: 'Web', milestoneName: 'Chapter 10' }),
        ]));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));

        const lines = Array.from(container.querySelectorAll<HTMLParagraphElement>('article p[title]'));
        expect(lines.map(line => line.title)).toEqual(['Web', 'Chapter 10']);
        expect(lines.map(line => line.textContent?.trim())).toEqual(['Web', 'Chapter 10']);
        expect(lines.every(line => line.querySelector('svg') !== null)).toBe(true);
    });

    it('keeps alternating detailed cards across a month with an even number of events', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
            createEvent({ date: '2024-03-20', mediaId: 1 }),
            createEvent({ date: '2024-03-10', mediaId: 2 }),
            createEvent({ date: '2024-02-15', mediaId: 3 }),
        ]));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(3));

        const sides = Array.from(container.querySelectorAll('.timeline-entry'))
            .map(entry => (entry.classList.contains('is-left') ? 'left' : 'right'));
        expect(sides).toEqual(['left', 'right', 'left']);
    });

    it('renders the detailed card stats as labelled rows keyed by stat', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [createEvent()]));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));

        const rows = Array.from(container.querySelectorAll<HTMLElement>('article dl [data-timeline-stat]'));
        expect(rows.map(row => [
            row.dataset.timelineStat,
            row.querySelector('dt')?.textContent,
            row.querySelector('dd')?.textContent,
        ])).toEqual([
            ['date', 'Date', 'Mar 15, 2024'],
            ['time', 'Time', '5h'],
            ['characters', 'Characters', '12,000'],
            ['type', 'Type', 'Novel'],
        ]);
    });

    it('renders a no-image placeholder that the cover loader ignores when the media has no cover', async () => {
        vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
            createEvent({ coverImage: '' }),
        ]));

        const view = new TimelineView(container);
        await renderAndLoad(view);
        await vi.waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(1));

        const article = container.querySelector('article');
        expect(article?.textContent).toContain('No Image');
        expect(article?.querySelector('[data-cover-ref]')).toBeNull();
        expect(coverMocks.load).not.toHaveBeenCalled();
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
        const view = new TestableTimelineView(container);
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
        const view = new TestableTimelineView(container);
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
        const view = new TestableTimelineView(container);
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

    function stubNarrowViewport(): void {
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: true,
            media: '(max-width: 1024px)',
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
    }

    function createWaveRoot(): HTMLElement {
        const root = document.createElement('div');
        root.innerHTML = '<section class="timeline-shell"><svg class="timeline-wave"></svg></section>';
        container.appendChild(root);
        return root;
    }

    const WAVE_ROOT_WIDTH = 800;
    const WAVE_ROOT_HEIGHT = 600;
    const WAVE_NODE_SIZE = 12;

    function stubRect(element: HTMLElement, left: number, top: number, width: number, height: number): void {
        element.getBoundingClientRect = () => ({
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
            x: left,
            y: top,
            toJSON: () => ({}),
        }) as DOMRect;
    }

    /** happy-dom reports zeroed rects, so the wave needs stubbed geometry to say anything. */
    function renderMeasuredWave(view: TestableTimelineView, nodeCount: number, waveMetrics: number[]): string {
        const root = createWaveRoot();
        Object.defineProperty(root, 'clientWidth', { value: WAVE_ROOT_WIDTH, configurable: true });
        Object.defineProperty(root, 'clientHeight', { value: WAVE_ROOT_HEIGHT, configurable: true });
        stubRect(root, 0, 0, WAVE_ROOT_WIDTH, WAVE_ROOT_HEIGHT);

        const shell = root.querySelector('.timeline-shell')!;
        for (let index = 0; index < nodeCount; index += 1) {
            shell.insertAdjacentHTML('beforeend', '<span class="timeline-compact-node"></span>');
        }
        for (const node of root.querySelectorAll<HTMLElement>('.timeline-compact-node')) {
            stubRect(node, (WAVE_ROOT_WIDTH - WAVE_NODE_SIZE) / 2, WAVE_ROOT_HEIGHT / 2, WAVE_NODE_SIZE, WAVE_NODE_SIZE);
        }

        view.renderTimelineWave(root, waveMetrics);
        return root.querySelector('.timeline-wave')!.innerHTML;
    }

    it('hides the decorative wave at the detailed zoom level on a narrow viewport', () => {
        stubNarrowViewport();
        const view = new TestableTimelineView(container);
        const root = createWaveRoot();

        view.renderTimelineWave(root, [20, 20]);

        expect(root.querySelector('.timeline-wave')?.innerHTML).toBe('');
    });

    it('hides the decorative wave at the compact zoom level', () => {
        const view = new TestableTimelineView(container);
        view.state.zoomLevel = 'compact';
        const root = createWaveRoot();

        view.renderTimelineWave(root, [20, 20]);

        expect(root.querySelector('.timeline-wave')?.innerHTML).toBe('');
    });

    it('renders a flat wave baseline when no rows are on screen', () => {
        const view = new TestableTimelineView(container);
        const root = createWaveRoot();

        view.renderTimelineWave(root, []);

        expect(root.querySelector('.timeline-wave')?.innerHTML).toContain('timeline-wave-body');
    });

    const RIGHT_BODY_PATH_MARKER = 'timeline-wave-body-right" d="';

    /** Widest horizontal reach from the centre line among the path points in a band of rows. */
    function measureWaveReach(wave: string, fromY: number, toY: number): number {
        const pathStart = wave.indexOf(RIGHT_BODY_PATH_MARKER);
        const path = pathStart === -1
            ? ''
            : wave.slice(pathStart + RIGHT_BODY_PATH_MARKER.length, wave.indexOf('"', pathStart + RIGHT_BODY_PATH_MARKER.length));
        // Every command in this path (M, L, C) carries an even number of coordinates, so the
        // numeric tokens pair up as (x, y) in order.
        const coordinates = path
            .split(' ')
            .filter(token => token !== '')
            .map(Number)
            .filter(value => !Number.isNaN(value));
        let reach = 0;
        for (let index = 0; index + 1 < coordinates.length; index += 2) {
            const [x, y] = [coordinates[index], coordinates[index + 1]];
            if (y >= fromY && y <= toY) {
                reach = Math.max(reach, x - WAVE_ROOT_WIDTH / 2);
            }
        }
        return reach;
    }

    it('calms the wave towards the bottom edge below a single loud row', () => {
        const view = new TestableTimelineView(container);

        const wave = renderMeasuredWave(view, 1, [500]);

        const reachAtRow = measureWaveReach(wave, WAVE_ROOT_HEIGHT * 0.4, WAVE_ROOT_HEIGHT * 0.6);
        const reachAtBottom = measureWaveReach(wave, WAVE_ROOT_HEIGHT * 0.95, WAVE_ROOT_HEIGHT);
        expect(reachAtRow).toBeGreaterThan(0);
        expect(reachAtBottom).toBeLessThan(reachAtRow / 2);
    });

    it('shapes the wave around a single row instead of falling back to the baseline', () => {
        const view = new TestableTimelineView(container);

        const baselineWave = renderMeasuredWave(view, 0, []);
        const singleRowWave = renderMeasuredWave(view, 1, [500]);

        expect(singleRowWave).not.toBe(baselineWave);
    });

    describe('semantic zoom', () => {
        async function zoomOutOnce(container: HTMLElement): Promise<void> {
            container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-out')!.click();
            await vi.waitFor(() => expect(container.querySelector('#timeline-root')?.getAttribute('aria-busy')).not.toBe('true'));
        }

        function getSelectedOptionValue(select: HTMLSelectElement | null): string | undefined {
            if (!select) return undefined;
            return Array.from(select.querySelectorAll('option')).find(option => option.hasAttribute('selected'))?.value;
        }

        it('renders compact rows with no covers after zooming out from detailed', async () => {
            coverMocks.getCached.mockReturnValue('blob:cached-cover');
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ coverImage: '/covers/a.jpg' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(1));

            await zoomOutOnce(container);

            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));
            expect(container.querySelectorAll('.timeline-entry')).toHaveLength(0);
            expect(container.querySelectorAll('.timeline-cover-shell')).toHaveLength(0);
            expect(coverMocks.load).not.toHaveBeenCalled();
        });

        it('renders bucket rows from getTimelineBuckets after zooming out twice', async () => {
            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [
                createBucket({ key: '2024-03', startDate: '2024-03-01' }),
                createBucket({ key: '2024-02', startDate: '2024-02-01' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));

            await zoomOutOnce(container);
            await zoomOutOnce(container);

            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(2));
            expect(container.querySelector('.timeline-bucket-label')?.textContent).toBe('March');
        });

        it('shows time and characters for a compact row and a dash for whichever is zero', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ kind: 'finished', totalMinutes: 125, totalCharacters: 1234 }),
                createEvent({
                    kind: 'paused', mediaId: 2, totalMinutes: 120, totalCharacters: 0,
                }),
                createEvent({
                    kind: 'dropped', mediaId: 3, totalMinutes: 0, totalCharacters: 500,
                }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(3));

            await zoomOutOnce(container); // detailed -> compact
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(3));

            const metricsByRow = Array.from(container.querySelectorAll('.timeline-compact-row'))
                .map(row => Array.from(row.querySelectorAll('.timeline-compact-metric'))
                    .map(node => node.textContent));
            expect(metricsByRow).toEqual([['2h 05m', '1,234 chars'], ['2h 00m', '–'], ['–', '500 chars']]);
        });

        it('shows a dash for a bucket total whose value is zero', async () => {
            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [
                createBucket({ key: '2024-03', startDate: '2024-03-01', loggedMinutes: 60, loggedCharacters: 0 }),
                createBucket({ key: '2024-02', startDate: '2024-02-01', loggedMinutes: 0, loggedCharacters: 4200 }),
                createBucket({ key: '2024-01', startDate: '2024-01-01', loggedMinutes: 0, loggedCharacters: 0 }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container); // detailed -> compact
            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(3));

            const totalsByRow = Array.from(container.querySelectorAll('.timeline-bucket-row'))
                .map(row => Array.from(row.querySelectorAll('.timeline-bucket-metric'))
                    .map(node => node.textContent));
            expect(totalsByRow).toEqual([['1h 00m', '–'], ['–', '4,200 chars'], ['–', '–']]);
        });

        it('renders no milestone name list on a bucket row', async () => {
            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [
                createBucket({ key: '2024-03', startDate: '2024-03-01', milestoneCount: 3 }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container); // detailed -> compact
            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(1));

            const row = container.querySelector('.timeline-bucket-row');
            expect(row?.querySelector('.timeline-bucket-milestones')).toBeNull();
            const kindLabels = Array.from(row?.querySelectorAll('.timeline-bucket-kind') ?? [])
                .map(node => node.getAttribute('title'));
            expect(kindLabels).toContain('3 milestones');
        });

        async function renderMonthBuckets(buckets: TimelineBucket[]): Promise<void> {
            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, buckets));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(buckets.length));
        }

        function createHighlight(overrides: Partial<TimelineBucketHighlight> = {}): TimelineBucketHighlight {
            return {
                mediaId: 7,
                mediaTitle: 'Novel A',
                mediaVariant: '',
                coverImage: 'cover.png',
                ...overrides,
            };
        }

        it('shows every kind on a bucket row in a fixed order and marks the zero counts', async () => {
            await renderMonthBuckets([
                createBucket({ startedCount: 2, finishedCount: 0, pausedCount: 1, droppedCount: 0, milestoneCount: 0 }),
            ]);

            const tiles = Array.from(container.querySelectorAll('.timeline-bucket-kind'));
            expect(tiles.map(tile => tile.getAttribute('title'))).toEqual([
                '2 started',
                '0 completed',
                '1 paused',
                '0 dropped',
                '0 milestones',
            ]);
            expect(tiles.map(tile => tile.classList.contains('is-zero'))).toEqual([false, true, false, true, true]);
        });

        it('opens the media from a bucket cover', async () => {
            const navigate = vi.fn();
            globalThis.addEventListener('app-navigate', navigate);
            await renderMonthBuckets([
                createBucket({ highlights: [createHighlight({ mediaId: 7 })], distinctMediaCount: 1 }),
            ]);

            container.querySelector<HTMLButtonElement>('button.timeline-bucket-cover')!.click();

            expect((navigate.mock.calls[0][0] as CustomEvent).detail).toEqual({ view: 'media', focusMediaId: 7 });
            globalThis.removeEventListener('app-navigate', navigate);
        });

        it('renders a No Image tile for a bucket title without a cover', async () => {
            await renderMonthBuckets([
                createBucket({ highlights: [createHighlight({ coverImage: '' })], distinctMediaCount: 1 }),
            ]);

            const tile = container.querySelector('.timeline-bucket-cover');
            expect(tile?.classList.contains('is-empty')).toBe(true);
            expect(tile?.textContent?.trim()).toBe('No Image');
            expect(tile?.hasAttribute('data-cover-ref')).toBe(false);
        });

        it('scrolls back to the top when the zoom level changes', async () => {
            const scroller = document.createElement('div');
            scroller.className = 'main-content';
            container.parentElement?.replaceChild(scroller, container);
            scroller.appendChild(container);
            const scrollTo = vi.fn();
            scroller.scrollTo = scrollTo;

            const view = new TimelineView(container);
            await renderAndLoad(view);
            expect(scrollTo).not.toHaveBeenCalled();

            await zoomOutOnce(container);
            expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
        });

        it('shows the milestone name alongside the date and milestone metrics in a compact row', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({
                    kind: 'milestone',
                    milestoneName: 'Chapter 10',
                    milestoneMinutes: 45,
                    milestoneCharacters: 500,
                }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container); // detailed -> compact
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));

            const row = container.querySelector('.timeline-compact-row');
            expect(row?.querySelector('p[title]')?.textContent?.trim()).toBe('Chapter 10');
            expect(row?.querySelector('.timeline-compact-date')?.textContent?.trim()).toBe('Mar 15');
            expect(Array.from(row?.querySelectorAll('.timeline-compact-metric') ?? []).map(node => node.textContent))
                .toEqual(['45m', '500 chars']);
            expect(row?.querySelector('.timeline-media-link')?.textContent?.trim()).toBe('Novel A');
        });

        it('orders a compact card as date, kind, title, time and characters', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));

            await zoomOutOnce(container); // detailed -> compact
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(5));

            const card = container.querySelector('.timeline-compact-row .timeline-compact-card')!;
            expect(Array.from(card.children).map(child => child.className.split(' ').find(name => name.startsWith('timeline-compact-') && name !== 'timeline-compact-cell' && name !== 'timeline-compact-metric')))
                .toEqual([
                    'timeline-compact-date',
                    'timeline-compact-kind',
                    'timeline-compact-title',
                    'timeline-compact-time',
                    'timeline-compact-characters',
                ]);
        });

        it('shows the variant in a compact row even when the title is unique', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ kind: 'finished', mediaVariant: 'Web' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));

            const sublines = container.querySelector('.timeline-compact-row .timeline-compact-sublines');
            expect(sublines?.querySelector('.is-variant')?.textContent?.trim()).toBe('Web');
            expect(sublines?.querySelector('.is-milestone')).toBeNull();
        });

        it('puts the variant before the milestone name in a compact row', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ kind: 'milestone', mediaVariant: 'Web', milestoneName: 'Chapter 10' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));

            const sublines = container.querySelector('.timeline-compact-row .timeline-compact-sublines');
            expect(Array.from(sublines?.children ?? []).map(child => child.textContent?.trim()))
                .toEqual(['Web', 'Chapter 10']);
        });

        it('renders no sublines group in a compact row without variant or milestone', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ kind: 'finished', mediaVariant: '' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));

            expect(container.querySelector('.timeline-compact-row .timeline-compact-sublines')).toBeNull();
        });

        it('puts the full media title on the compact title button', async () => {
            vi.mocked(api.getTimelinePage).mockImplementation(async request => createPage(request, [
                createEvent({ kind: 'finished', mediaTitle: 'Novel A' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row')).toHaveLength(1));

            expect(container.querySelector('.timeline-compact-row .timeline-compact-title-text')?.getAttribute('title'))
                .toBe('Novel A');
        });

        it('groups month buckets under a year marker but emits none at year granularity', async () => {
            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [
                createBucket({ key: '2024-03', startDate: '2024-03-01' }),
                createBucket({ key: '2024-02', startDate: '2024-02-01' }),
                createBucket({ key: '2023-12', startDate: '2023-12-01' }),
            ]));
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));

            await zoomOutOnce(container); // detailed -> compact
            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(3));
            expect(
                Array.from(container.querySelectorAll('.timeline-month-marker .timeline-month-label-text'))
                    .map(node => node.textContent),
            ).toEqual(['2024', '2023']);

            vi.mocked(api.getTimelineBuckets).mockImplementation(async request => createBucketPage(request, [
                createBucket({ key: '2024', startDate: '2024-01-01' }),
                createBucket({ key: '2023', startDate: '2023-01-01' }),
            ]));
            await zoomOutOnce(container); // month -> year
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row')).toHaveLength(2));
            expect(container.querySelectorAll('.timeline-month-marker')).toHaveLength(0);
        });

        it('groups the visible selects per zoom level and omits the group when no select is visible', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));

            function selectIdsInGroup(): string[] | null {
                const group = container.querySelector('.timeline-filter-row > .timeline-filter-selects');
                return group ? Array.from(group.querySelectorAll('select')).map(select => select.id) : null;
            }

            expect(selectIdsInGroup()).toEqual(['timeline-year-filter', 'timeline-kind-filter']);

            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-compact-row').length).toBeGreaterThan(0));
            expect(selectIdsInGroup()).toEqual(['timeline-year-filter', 'timeline-kind-filter']);

            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));
            expect(selectIdsInGroup()).toEqual(['timeline-year-filter']);

            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));
            expect(selectIdsInGroup()).toBeNull();
        });

        it('shows a kind-specific summary label and count once the Kind filter is set, reverting at bucket levels', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#timeline-kind-filter')).not.toBeNull());

            function summaryValueFor(label: string): string | undefined {
                const item = Array.from(container.querySelectorAll('.timeline-summary-item')).find(
                    candidate => candidate.querySelector('.timeline-summary-label')?.textContent === label,
                );
                return item?.querySelector('.timeline-summary-value')?.textContent ?? undefined;
            }

            expect(summaryValueFor('Completed titles')).toBeDefined();

            const kindFilter = container.querySelector<HTMLSelectElement>('#timeline-kind-filter')!;
            kindFilter.value = 'paused';
            kindFilter.dispatchEvent(new Event('change'));
            await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
                expect.objectContaining({ kind: 'paused' }),
            ));

            await vi.waitFor(() => expect(summaryValueFor('Paused titles')).toBe('4'));
            expect(summaryValueFor('Completed titles')).toBeUndefined();

            await zoomOutOnce(container); // detailed -> compact
            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));

            expect(summaryValueFor('Completed titles')).toBeDefined();
            expect(summaryValueFor('Paused titles')).toBeUndefined();
        });

        it('labels the kind-specific summary item "Milestone titles" for the milestone Kind filter', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#timeline-kind-filter')).not.toBeNull());

            const kindFilter = container.querySelector<HTMLSelectElement>('#timeline-kind-filter')!;
            kindFilter.value = 'milestone';
            kindFilter.dispatchEvent(new Event('change'));

            await vi.waitFor(() => expect(
                Array.from(container.querySelectorAll('.timeline-summary-label')).map(label => label.textContent),
            ).toContain('Milestone titles'));
        });

        it('hides Kind at month and year and hides Year only at year, preserving prior selections', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#timeline-kind-filter')).not.toBeNull());

            const kindFilter = container.querySelector<HTMLSelectElement>('#timeline-kind-filter')!;
            kindFilter.value = 'paused';
            kindFilter.dispatchEvent(new Event('change'));
            await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
                expect.objectContaining({ kind: 'paused' }),
            ));

            const yearFilter = container.querySelector<HTMLSelectElement>('#timeline-year-filter')!;
            yearFilter.value = '2024';
            yearFilter.dispatchEvent(new Event('change'));
            await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
                expect.objectContaining({ year: 2024 }),
            ));

            await zoomOutOnce(container); // detailed -> compact
            expect(getSelectedOptionValue(container.querySelector('#timeline-kind-filter'))).toBe('paused');
            expect(getSelectedOptionValue(container.querySelector('#timeline-year-filter'))).toBe('2024');

            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));
            expect(container.querySelector('#timeline-kind-filter')).toBeNull();
            expect(getSelectedOptionValue(container.querySelector('#timeline-year-filter'))).toBe('2024');

            await zoomOutOnce(container); // month -> year
            await vi.waitFor(() => expect(api.getTimelineBuckets).toHaveBeenLastCalledWith(
                expect.objectContaining({ granularity: 'year' }),
            ));
            expect(container.querySelector('#timeline-kind-filter')).toBeNull();
            expect(container.querySelector('#timeline-year-filter')).toBeNull();

            container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-in')!.click(); // year -> month
            await vi.waitFor(() => expect(container.querySelector('#timeline-year-filter')).not.toBeNull());
            expect(getSelectedOptionValue(container.querySelector('#timeline-year-filter'))).toBe('2024');
            expect(container.querySelector('#timeline-kind-filter')).toBeNull();

            container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-in')!.click(); // month -> compact
            await vi.waitFor(() => expect(container.querySelector('#timeline-kind-filter')).not.toBeNull());
            expect(getSelectedOptionValue(container.querySelector('#timeline-kind-filter'))).toBe('paused');
        });

        it('sends bucket requests with no kind field and the correct year per granularity', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#timeline-year-filter')).not.toBeNull());

            const yearFilter = container.querySelector<HTMLSelectElement>('#timeline-year-filter')!;
            yearFilter.value = '2024';
            yearFilter.dispatchEvent(new Event('change'));
            await vi.waitFor(() => expect(api.getTimelinePage).toHaveBeenLastCalledWith(
                expect.objectContaining({ year: 2024 }),
            ));

            await zoomOutOnce(container); // detailed -> compact
            await zoomOutOnce(container); // compact -> month
            await vi.waitFor(() => expect(api.getTimelineBuckets).toHaveBeenCalledWith(
                expect.objectContaining({ granularity: 'month', year: 2024 }),
            ));
            const monthRequest = vi.mocked(api.getTimelineBuckets).mock.calls.at(-1)![0];
            expect(monthRequest).not.toHaveProperty('kind');

            await zoomOutOnce(container); // month -> year
            await vi.waitFor(() => expect(api.getTimelineBuckets).toHaveBeenLastCalledWith(
                expect.objectContaining({ granularity: 'year', year: null }),
            ));
            const yearRequest = vi.mocked(api.getTimelineBuckets).mock.calls.at(-1)![0];
            expect(yearRequest).not.toHaveProperty('kind');
        });

        it('disables the zoom-out button at year and the zoom-in button at detailed', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#btn-timeline-zoom-in')).not.toBeNull());

            expect(container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-in')?.disabled).toBe(true);
            expect(container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-out')?.disabled).toBe(false);

            await zoomOutOnce(container);
            await zoomOutOnce(container);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));
            await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-out')?.disabled).toBe(true));
            expect(container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-in')?.disabled).toBe(false);
        });

        it('returns to detailed from any zoom level via the reset button', async () => {
            const view = new TimelineView(container);
            await renderAndLoad(view);
            await vi.waitFor(() => expect(container.querySelector('#btn-timeline-zoom-reset')).not.toBeNull());

            await zoomOutOnce(container);
            await zoomOutOnce(container);
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-bucket-row').length).toBeGreaterThan(0));

            container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-reset')!.click();
            await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry')).toHaveLength(5));
            expect(container.querySelector<HTMLButtonElement>('#btn-timeline-zoom-reset')?.textContent).toBe('Detailed');
            expect(api.setSetting).toHaveBeenLastCalledWith('timeline_zoom_level', 'detailed');
        });
    });
});

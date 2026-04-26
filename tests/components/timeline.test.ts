import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineView } from '../../src/components/timeline';
import * as api from '../../src/api';
import type { TimelineEvent } from '../../src/api';
import * as services from '../../src/services';
import type { AppServices } from '../../src/services';
import { Logger } from '../../src/core/logger';

vi.mock('../../src/api', () => ({
    getTimelineEvents: vi.fn(),
}));

vi.mock('../../src/services', () => ({
    getServices: vi.fn(),
}));

describe('TimelineView', () => {
    type TimelineInternal = TimelineView & {
        triggerMount: () => void;
        state: {
            events: TimelineEvent[];
            coverUrls: Record<number, string>;
            searchQuery: string;
            selectedYear: string;
            selectedKind: string;
            isLoading: boolean;
            isInitialized: boolean;
        };
        coverLoadToken: number;
        coverObserver: { disconnect: () => void } | null;
        waveFrame: number | null;
        ensureCoverLoaded: (mediaId: number, coverRef: string, token: number) => Promise<void>;
        prefetchRecentCovers: (events: TimelineEvent[], token: number) => Promise<void>;
        renderCover: (event: TimelineEvent) => string;
        renderEventCopy: (event: TimelineEvent) => string;
        renderMetaItems: (event: TimelineEvent) => string[];
        getKindLabel: (kind: string) => string;
        formatTimelineDuration: (totalMinutes: number) => string;
        formatDate: (date: string) => string;
        getWaveMetric: (event: TimelineEvent) => number;
        runBackgroundTask: (task: Promise<void>, message: string, level?: 'error' | 'warn') => void;
        setupCoverLoading: (root: HTMLElement) => void;
        renderTimelineWave: (root: HTMLElement, visibleEvents: TimelineEvent[]) => void;
        buildSideWaveAreaPath: (
            samples: Array<{ y: number; amplitude: number }>,
            centerX: number,
            direction: -1 | 1,
            minAmplitude: number,
            outerStretch?: number,
            innerRatio?: number,
        ) => string;
    };

    let container: HTMLElement;
    let loadCoverImageMock: ReturnType<typeof vi.fn>;
    const originalMatchMedia = globalThis.matchMedia;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const normalizedText = () => container.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '';
    const createEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
        kind: 'finished',
        date: '2024-03-15',
        mediaId: 1,
        mediaTitle: 'Novel A',
        coverImage: '',
        activityType: 'Reading',
        contentType: 'Novel',
        trackingStatus: 'Complete',
        milestoneName: null,
        firstDate: '2024-03-01',
        lastDate: '2024-03-15',
        totalMinutes: 300,
        totalCharacters: 12000,
        milestoneMinutes: 0,
        milestoneCharacters: 0,
        sameDayTerminal: false,
        ...overrides,
    });
    const createRect = (left: number, top: number, width: number, height: number): DOMRect =>
        ({
            x: left,
            y: top,
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
            toJSON: () => ({}),
        }) as DOMRect;
    const createMatchMedia = (matches: boolean) =>
        vi.fn().mockImplementation((query: string) => ({
            matches: query === '(max-width: 1024px)' ? matches : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    const createInternalView = (): TimelineInternal => {
        const view = new TimelineView(container) as unknown as TimelineInternal;
        view.triggerMount = vi.fn();
        view.state = {
            ...view.state,
            isInitialized: true,
        };
        return view;
    };

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
            firstDate: '2024-02-10',
            lastDate: '2024-02-20',
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
            firstDate: '2024-02-01',
            lastDate: '2024-02-18',
            totalMinutes: 90,
            totalCharacters: 0,
        }),
        createEvent({
            kind: 'started',
            date: '2024-01-12',
            mediaId: 4,
            mediaTitle: 'Manga E',
            activityType: 'Reading',
            contentType: 'Manga',
            trackingStatus: 'Ongoing',
            firstDate: '2024-01-12',
            lastDate: '2024-01-12',
            totalMinutes: 30,
            totalCharacters: 900,
        }),
    ];

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.clearAllMocks();
        vi.useRealTimers();
        loadCoverImageMock = vi.fn().mockResolvedValue(null);
        vi.mocked(services.getServices).mockReturnValue({
            loadCoverImage: loadCoverImageMock,
        } as unknown as AppServices);
        (TimelineView as unknown as { coverCache: Map<string, string | null> }).coverCache.clear();
        (TimelineView as unknown as { coverRequestCache: Map<string, Promise<string | null>> }).coverRequestCache.clear();
        Object.defineProperty(globalThis, 'matchMedia', {
            writable: true,
            value: createMatchMedia(false),
        });
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: originalIntersectionObserver,
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        Object.defineProperty(globalThis, 'matchMedia', {
            writable: true,
            value: originalMatchMedia,
        });
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: originalIntersectionObserver,
        });
    });

    it('loads events, groups them by month, and renders lifecycle copy', async () => {
        vi.mocked(api.getTimelineEvents).mockResolvedValue(sampleEvents);

        const view = new TimelineView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('#timeline-root')).not.toBeNull());
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(5));

        const monthLabels = Array.from(container.querySelectorAll('.timeline-month-label')).map(node => node.textContent?.trim());
        expect(monthLabels).toEqual([
            'March 2024',
            'February 2024',
            'January 2024',
        ]);
        expect(normalizedText()).not.toContain('Start of');
        expect(normalizedText()).not.toContain('End of');

        expect(normalizedText()).toContain('Finished reading');
        expect(normalizedText()).toContain('Reached "Chapter 10"');
        expect(normalizedText()).toContain('Put Game B on pause');
        expect(normalizedText()).toContain('Dropped Show C');
        expect(normalizedText()).toContain('Started reading');
        expect(normalizedText()).toContain('Completed titles');
        expect(normalizedText()).toContain('Characters tracked');
        expect(normalizedText()).toContain('5h0min');
        expect(normalizedText()).not.toContain('300 Minutes');
        expect(container.querySelector('.timeline-summary-strip')).not.toBeNull();
        expect(container.querySelector('.timeline-hero-card')).toBeNull();
    });

    it('renders loading, empty, and failed-fetch states', async () => {
        const view = createInternalView();
        view.state = {
            ...view.state,
            isLoading: true,
            isInitialized: false,
        };

        view.render();
        expect(normalizedText()).toContain('Loading timeline...');

        view.state = {
            ...view.state,
            isLoading: false,
            isInitialized: false,
        };
        vi.mocked(api.getTimelineEvents).mockResolvedValueOnce([]);
        await view.loadData();
        expect(normalizedText()).toContain('No timeline yet');

        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.mocked(api.getTimelineEvents).mockRejectedValueOnce(new Error('boom'));
        await view.loadData();

        expect(normalizedText()).toContain('No timeline yet');
        expect(errorSpy).toHaveBeenCalledWith('Failed to load timeline events', expect.any(Error));
    });

    it('filters by search, year, and kind', async () => {
        vi.mocked(api.getTimelineEvents).mockResolvedValue(sampleEvents);

        const view = new TimelineView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(5));

        const yearFilter = container.querySelector('#timeline-year-filter') as HTMLSelectElement;
        yearFilter.value = '2024';
        yearFilter.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(5));

        const kindFilter = container.querySelector('#timeline-kind-filter') as HTMLSelectElement;
        kindFilter.value = 'paused';
        kindFilter.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(1));
        expect(normalizedText()).toContain('Put Game B on pause');

        const searchInput = container.querySelector('#timeline-search') as HTMLInputElement;
        searchInput.value = 'chapter';
        searchInput.dispatchEvent(new Event('input'));
        await vi.waitFor(() => expect(container.textContent).toContain('No matching events'));
    });

    it('collapses same-day terminal entries into one card and uses past-tense copy', async () => {
        vi.mocked(api.getTimelineEvents).mockResolvedValue([
            {
                kind: 'finished',
                date: '2024-04-01',
                mediaId: 9,
                mediaTitle: 'One Day Book',
                coverImage: '',
                activityType: 'Reading',
                contentType: 'Novel',
                trackingStatus: 'Complete',
                milestoneName: null,
                firstDate: '2024-04-01',
                lastDate: '2024-04-01',
                totalMinutes: 60,
                totalCharacters: 10000,
                milestoneMinutes: 0,
                milestoneCharacters: 0,
                sameDayTerminal: true,
            },
        ]);

        const view = new TimelineView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(1));
        expect(normalizedText()).toContain('Read One Day Book');
        expect(normalizedText()).not.toContain('Finished One Day Book');
        expect(normalizedText()).not.toContain('Started reading One Day Book');
    });

    it('dispatches navigation only when the media chip is clicked', async () => {
        vi.mocked(api.getTimelineEvents).mockResolvedValue(sampleEvents);
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');

        const view = new TimelineView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelector('.timeline-entry')).not.toBeNull());
        (container.querySelector('.timeline-entry') as HTMLElement).click();
        expect(dispatchSpy).not.toHaveBeenCalled();

        (container.querySelector('.timeline-media-link') as HTMLButtonElement).click();

        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'app-navigate',
                detail: expect.objectContaining({
                    view: 'media',
                    focusMediaId: 1,
                }),
            }),
        );
    });

    it('prefetches only recent unique covers and skips fetches when already loading', async () => {
        const view = createInternalView();
        const ensureCoverLoadedSpy = vi
            .spyOn(view, 'ensureCoverLoaded')
            .mockResolvedValue(undefined);

        const coverEvents = Array.from({ length: 10 }, (_, index) =>
            {
                const coverImage = index === 8 ? '' : `cover-${Math.min(index, 7)}`;
                return createEvent({
                    mediaId: index + 1,
                    mediaTitle: `Title ${index + 1}`,
                    coverImage,
                });
            },
        );

        await view.prefetchRecentCovers(coverEvents, 42);

        expect(ensureCoverLoadedSpy).toHaveBeenCalledTimes(8);
        expect(ensureCoverLoadedSpy).toHaveBeenNthCalledWith(1, 1, 'cover-0', 42);
        expect(ensureCoverLoadedSpy).toHaveBeenNthCalledWith(8, 8, 'cover-7', 42);

        const priorApiCalls = vi.mocked(api.getTimelineEvents).mock.calls.length;
        view.state = {
            ...view.state,
            isLoading: true,
        };
        await view.loadData();
        expect(api.getTimelineEvents).toHaveBeenCalledTimes(priorApiCalls);
    });

    it('covers helper branches for copy, metadata, metrics, and background task logging', async () => {
        const view = createInternalView();
        view.state = {
            ...view.state,
            coverUrls: {
                7: 'blob://cover-7',
            },
        };

        expect(view.renderCover(createEvent({ coverImage: '' }))).toBe('');
        expect(view.renderCover(createEvent({ mediaId: 6, coverImage: 'cover-6' }))).toContain(
            'timeline-cover-placeholder',
        );
        expect(view.renderCover(createEvent({ mediaId: 7, coverImage: 'cover-7' }))).toContain(
            'timeline-cover-image',
        );

        expect(view.renderEventCopy(createEvent({ kind: 'started', activityType: 'Listening' }))).toContain(
            'Started listening',
        );
        expect(view.renderEventCopy(createEvent({ kind: 'finished', activityType: 'Listening', sameDayTerminal: true }))).toContain(
            'Listened to',
        );
        expect(view.renderEventCopy(createEvent({ kind: 'started', activityType: 'Unknown' }))).toContain(
            'Started',
        );
        expect(view.renderEventCopy(createEvent({ kind: 'finished', activityType: 'Unknown', sameDayTerminal: false }))).toContain(
            'Finished',
        );

        const terminalMeta = view.renderMetaItems(createEvent({ kind: 'dropped', totalMinutes: 30, totalCharacters: 12345 }));
        expect(terminalMeta.join('')).toContain('30 Minutes');
        expect(terminalMeta.join('')).toContain('12,345');

        const milestoneMeta = view.renderMetaItems(
            createEvent({
                kind: 'milestone',
                totalMinutes: 0,
                totalCharacters: 0,
                milestoneMinutes: 75,
                milestoneCharacters: 6789,
            }),
        );
        expect(milestoneMeta.join('')).toContain('1h15min');
        expect(milestoneMeta.join('')).toContain('6,789');

        expect(view.getKindLabel('mystery')).toBe('Event');
        expect(view.formatTimelineDuration(60)).toBe('60 Minutes');
        expect(view.formatDate('2024-04-02')).toBe('Apr 2, 2024');
        expect(view.getWaveMetric(createEvent({ kind: 'milestone', milestoneMinutes: 55 }))).toBe(55);
        expect(view.getWaveMetric(createEvent({ kind: 'milestone', milestoneMinutes: 0, milestoneCharacters: 480 }))).toBe(2);
        expect(view.getWaveMetric(createEvent({ kind: 'started', totalMinutes: 1000 }))).toBe(220);
        expect(view.getWaveMetric(createEvent({ kind: 'started', totalMinutes: 0, totalCharacters: 240000 }))).toBe(220);
        expect(view.getWaveMetric(createEvent({ kind: 'finished', totalMinutes: 0, totalCharacters: 2400 }))).toBe(10);
        expect(view.getWaveMetric(createEvent({ kind: 'started', totalMinutes: 0, totalCharacters: 0 }))).toBe(20);
        expect(view.buildSideWaveAreaPath([], 600, 1, 80)).toBe('');

        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        view.runBackgroundTask(Promise.reject(new Error('warn failure')), 'warn msg', 'warn');
        view.runBackgroundTask(Promise.reject(new Error('hard failure')), 'error msg');
        await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith('warn msg', expect.any(Error)));
        expect(errorSpy).toHaveBeenCalledWith('error msg', expect.any(Error));
    });

    it('loads cover URLs from cache and shared requests, and records failed loads', async () => {
        const view = createInternalView();
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        view.coverLoadToken = 3;

        loadCoverImageMock.mockResolvedValueOnce('blob://cover-a');
        await view.ensureCoverLoaded(1, 'cover-a', 3);
        expect(view.state.coverUrls[1]).toBe('blob://cover-a');
        expect(loadCoverImageMock).toHaveBeenCalledWith('cover-a');

        let resolveShared: ((value: string | null) => void) | null = null;
        loadCoverImageMock.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveShared = resolve;
                }),
        );
        const sharedA = view.ensureCoverLoaded(2, 'cover-shared', 3);
        const sharedB = view.ensureCoverLoaded(3, 'cover-shared', 3);
        resolveShared?.('blob://shared');
        await Promise.all([sharedA, sharedB]);
        expect(loadCoverImageMock).toHaveBeenCalledTimes(2);
        expect(view.state.coverUrls[2]).toBe('blob://shared');
        expect(view.state.coverUrls[3]).toBe('blob://shared');

        await view.ensureCoverLoaded(4, 'cover-shared', 3);
        expect(loadCoverImageMock).toHaveBeenCalledTimes(2);
        expect(view.state.coverUrls[4]).toBe('blob://shared');

        (TimelineView as unknown as { coverCache: Map<string, string | null> }).coverCache.set('cover-null', null);
        await view.ensureCoverLoaded(5, 'cover-null', 3);
        expect(view.state.coverUrls[5]).toBeUndefined();

        loadCoverImageMock.mockRejectedValueOnce(new Error('missing'));
        await view.ensureCoverLoaded(6, 'cover-fail', 3);
        expect(warnSpy).toHaveBeenCalledWith('Failed to load timeline cover for media 6', expect.any(Error));

        await view.ensureCoverLoaded(7, 'cover-stale', 2);
        await view.ensureCoverLoaded(1, 'cover-a', 3);
        expect(loadCoverImageMock).toHaveBeenCalledTimes(3);
    });

    it('wires eager and intersection-based cover loading, and renders the desktop wave', () => {
        const view = createInternalView();
        const ensureCoverLoadedSpy = vi
            .spyOn(view, 'ensureCoverLoaded')
            .mockResolvedValue(undefined);

        const observed: HTMLElement[] = [];
        let observerCallback: IntersectionObserverCallback | null = null;
        const observerInstance = {
            observe: vi.fn((node: HTMLElement) => {
                observed.push(node);
            }),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        };

        class MockIntersectionObserver {
            public readonly root = null;
            public readonly rootMargin = '';
            public readonly thresholds: number[] = [];

            constructor(callback: IntersectionObserverCallback) {
                observerCallback = callback;
            }

            observe = observerInstance.observe;
            unobserve = observerInstance.unobserve;
            disconnect = observerInstance.disconnect;

            takeRecords(): IntersectionObserverEntry[] {
                return [];
            }
        }

        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: MockIntersectionObserver,
        });

        view.coverLoadToken = 9;
        view.state = {
            ...view.state,
            coverUrls: {
                2: 'blob://existing',
            },
        };

        const root = document.createElement('div');
        root.innerHTML = `
            <section class="timeline-shell">
                <svg class="timeline-wave" aria-hidden="true"></svg>
                ${Array.from({ length: 8 }, (_, index) => {
                    const mediaId = index + 1;
                    return `<div class="timeline-entry-node" data-index="${mediaId}"></div>
                        <div data-cover-media-id="${mediaId}" data-cover-ref="cover-${mediaId}"></div>`;
                }).join('')}
            </section>
        `;
        container.appendChild(root);

        view.setupCoverLoading(root);

        expect(ensureCoverLoadedSpy).toHaveBeenCalledTimes(5);
        expect(observerInstance.observe).toHaveBeenCalledTimes(7);
        expect(observerCallback).not.toBeNull();

        observerCallback?.(
            [
                { isIntersecting: false, target: observed[5] } as IntersectionObserverEntry,
                { isIntersecting: true, target: observed[5] } as IntersectionObserverEntry,
            ],
            observerInstance as unknown as IntersectionObserver,
        );

        expect(observerInstance.unobserve).toHaveBeenCalledWith(observed[5]);
        expect(ensureCoverLoadedSpy).toHaveBeenCalledWith(7, 'cover-7', 9);

        const shell = root.querySelector('.timeline-shell') as HTMLElement;
        const wave = root.querySelector('.timeline-wave') as SVGSVGElement;
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('.timeline-entry-node'));
        Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 1200 });
        Object.defineProperty(shell, 'scrollHeight', { configurable: true, value: 900 });
        shell.getBoundingClientRect = () => createRect(0, 0, 1200, 900);
        nodes[0].getBoundingClientRect = () => createRect(588, 120, 24, 24);
        nodes[1].getBoundingClientRect = () => createRect(588, 280, 24, 24);

        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
            callback(0);
            return 77;
        });

        view.renderTimelineWave(root, [
            createEvent({ totalMinutes: 600 }),
            createEvent({ mediaId: 2, totalMinutes: 45, totalCharacters: 0 }),
        ]);

        expect(rafSpy).toHaveBeenCalled();
        expect(wave.getAttribute('viewBox')).toBe('0 0 1200 900');
        expect(wave.innerHTML).toContain('timeline-wave-body-left');
        expect(wave.innerHTML).toContain('timeline-wave-haze-right');

        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        view.coverObserver = observerInstance;
        view.waveFrame = 55;
        view.destroy();
        expect(observerInstance.disconnect).toHaveBeenCalled();
        expect(cancelSpy).toHaveBeenCalledWith(55);
    });

    it('does not render the timeline wave in the compact layout', async () => {
        vi.mocked(api.getTimelineEvents).mockResolvedValue(sampleEvents);
        Object.defineProperty(globalThis, 'matchMedia', {
            writable: true,
            value: createMatchMedia(true),
        });

        const view = new TimelineView(container);
        view.render();

        await vi.waitFor(() => expect(container.querySelectorAll('.timeline-entry').length).toBe(5));
        const wave = container.querySelector('.timeline-wave') as SVGSVGElement;
        expect(wave.innerHTML).toBe('');
    });
});

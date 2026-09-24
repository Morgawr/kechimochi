import {
    getSetting,
    getTimelineBuckets,
    getTimelinePage,
    setSetting,
    type TimelineEvent,
} from '../api';
import { SETTING_KEYS, VIEW_NAMES, EVENTS } from '../constants';
import { Component } from '../component';
import { captureFocusState, restoreFocusState } from '../focus_preservation';
import { html, escapeHTML } from '../html';
import { Logger } from '../logger';
import type {
    TimelineBucket,
    TimelineBucketGranularity,
    TimelineEventKind,
    TimelineSummary,
} from '../types';
import { formatOptionalCount, formatOptionalNumber } from '../counts';
import { formatOptionalStatsDuration, formatStatsDuration } from '../time';
import { MediaCoverLoader } from '../media/cover_loader';
import { CoverVisibilityController } from '../media/cover_visibility';
import { measureSynchronous } from '../performance';
import { attachZoomGestures } from '../zoom_gestures';
import {
    DEFAULT_TIMELINE_ZOOM_LEVEL,
    TIMELINE_ZOOM_LEVELS,
    getTimelineBucketGranularity,
    getTimelineZoomLabel,
    isTimelineBucketLevel,
    normalizeTimelineZoomLevel,
    stepTimelineZoomLevel,
    type TimelineZoomLevel,
} from './timeline_zoom';
import {
    EMPTY_TIMELINE_SUMMARY,
    TIMELINE_BUCKET_COVER_ROWS,
    fitTimelineBucketCovers,
    formatTimelineBucketCoverOverflowLabel,
    formatTimelineBucketLabel,
    buildTimelineBucketTotalsParts,
    getTimelineBucketDominantKind,
    getTimelineBucketPips,
} from './timeline_buckets';
import {
    WAVE_RESIZE_DEBOUNCE_MS,
    buildTimelineWavePaths,
    getBucketWaveMetric,
    getWaveMetric,
} from './timeline_wave';

interface TimelineState {
    events: TimelineEvent[];
    availableYears: number[];
    ambiguousTitles: string[];
    summary: TimelineSummary;
    totalCount: number;
    allEventCount: number;
    hasMore: boolean;
    searchQuery: string;
    selectedYear: string;
    selectedKind: 'all' | TimelineEventKind;
    isLoading: boolean;
    isLoadingMore: boolean;
    isInitialized: boolean;
    zoomLevel: TimelineZoomLevel;
    buckets: TimelineBucket[];
    bucketsSignature: string;
    isLoadingBuckets: boolean;
}

interface TimelineGroup {
    key: string;
    label: string;
    events: TimelineEvent[];
}

interface TimelineSummaryItem {
    label: string;
    value: string;
}

interface TimelineMediaDisplayEntity {
    mediaTitle: string;
    mediaVariant: string;
}

interface TimelineCoverSource extends TimelineMediaDisplayEntity {
    mediaId: number;
    coverImage: string;
}

interface TimelineBucketCoverStrip {
    strip: HTMLElement;
    covers: HTMLElement[];
    overflowTile: HTMLElement;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

const TIMELINE_METRIC_SEPARATOR = '·';
const SMALL_TIMELINE_MEDIA_QUERY = '(max-width: 1024px)';
const TIMELINE_PAGE_SIZE = 40;
const TIMELINE_SEARCH_DEBOUNCE_MS = 180;
const COVER_PRELOAD_ROOT_MARGIN = '420px 0px';
const BUCKET_COVER_PRELOAD_ROOT_MARGIN = '240px 0px';
const COVER_EAGER_LOAD_COUNT = 4;
const PAGINATION_ROOT_MARGIN = '800px 0px';
const PAGINATION_THRESHOLD = 0.01;

/**
 * One media can render several shells for the same cover across a page, so a resolved blob fans
 * out to every shell sharing this key. A NUL separator cannot occur in either half, so the join
 * is unambiguous.
 */
function buildCoverNodeKey(mediaId: string | undefined, coverRef: string | undefined): string {
    return `${mediaId ?? ''}\u0000${coverRef ?? ''}`;
}

const KIND_SUMMARY_LABELS: Record<TimelineEventKind, string> = {
    started: 'Started titles',
    finished: 'Completed titles',
    paused: 'Paused titles',
    dropped: 'Dropped titles',
    milestone: 'Titles with milestones',
};

export class TimelineView extends Component<TimelineState> {
    private coverVisibility: CoverVisibilityController | null = null;
    private coverNodesByKey = new Map<string, HTMLElement[]>();
    private paginationObserver: IntersectionObserver | null = null;
    private requestId = 0;
    private bucketRequestId = 0;
    private renderToken = 0;
    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    private waveFrame: number | null = null;
    private waveResizeTimer: ReturnType<typeof setTimeout> | null = null;
    private hasLoadedZoomPreference = false;
    private observedResizeRoot: HTMLElement | null = null;
    private detachZoomGestures: (() => void) | null = null;
    private zoomGesturesRoot: HTMLElement | null = null;

    private readonly handleViewportResize = (): void => {
        if (this.waveResizeTimer !== null) {
            globalThis.clearTimeout(this.waveResizeTimer);
        }
        this.waveResizeTimer = globalThis.setTimeout(() => {
            this.waveResizeTimer = null;
            const root = this.container.querySelector<HTMLElement>('#timeline-root');
            if (!root?.isConnected || !this.state.isInitialized || root.clientWidth === 0) {
                return;
            }
            if (this.waveFrame !== null) {
                globalThis.cancelAnimationFrame(this.waveFrame);
                this.waveFrame = null;
            }
            this.applyBucketCoverFit(root);
            const granularity = getTimelineBucketGranularity(this.state.zoomLevel);
            this.renderTimelineWave(root, this.buildWaveMetrics(granularity, this.state.events));
        }, WAVE_RESIZE_DEBOUNCE_MS);
    };

    private readonly resizeObserver = new ResizeObserver(this.handleViewportResize);

    constructor(container: HTMLElement) {
        super(container, {
            events: [],
            availableYears: [],
            ambiguousTitles: [],
            summary: EMPTY_TIMELINE_SUMMARY,
            totalCount: 0,
            allEventCount: 0,
            hasMore: false,
            searchQuery: '',
            selectedYear: 'all',
            selectedKind: 'all',
            isLoading: false,
            isLoadingMore: false,
            isInitialized: false,
            zoomLevel: DEFAULT_TIMELINE_ZOOM_LEVEL,
            buckets: [],
            bucketsSignature: '',
            isLoadingBuckets: false,
        });
        globalThis.addEventListener('resize', this.handleViewportResize);
    }

    async loadData(): Promise<void> {
        if (this.state.isLoading || this.state.isLoadingBuckets) {
            return;
        }
        if (!this.hasLoadedZoomPreference) {
            this.hasLoadedZoomPreference = true;
            const storedZoomLevel = await getSetting(SETTING_KEYS.TIMELINE_ZOOM_LEVEL).catch(() => null);
            this.state.zoomLevel = normalizeTimelineZoomLevel(storedZoomLevel);
        }
        await this.loadForCurrentZoomLevel(true);
    }

    private async loadForCurrentZoomLevel(reset: boolean): Promise<void> {
        if (isTimelineBucketLevel(this.state.zoomLevel)) {
            await this.loadBuckets(reset);
            return;
        }
        await this.loadPage(reset);
    }

    private markPageLoading(reset: boolean, isInitialLoad: boolean): void {
        if (isInitialLoad) {
            this.state.isLoading = true;
            const root = this.container.querySelector<HTMLElement>('#timeline-root');
            if (root) {
                root.setAttribute('aria-busy', 'true');
            } else {
                this.render();
            }
            return;
        }
        if (reset) {
            this.state.isLoading = true;
            this.container.querySelector('#timeline-root')?.setAttribute('aria-busy', 'true');
            this.updateLoadingIndicator('Updating timeline…');
            return;
        }
        this.state.isLoadingMore = true;
        this.container.querySelector('#timeline-root')?.setAttribute('aria-busy', 'true');
        this.updateLoadingIndicator('Loading more events…');
    }

    private handlePageLoadError(error: unknown, requestId: number, isInitialLoad: boolean): void {
        if (requestId !== this.requestId) return;
        Logger.error('Failed to load timeline events', error);
        if (isInitialLoad) {
            this.setState({
                events: [],
                availableYears: [],
                ambiguousTitles: [],
                summary: EMPTY_TIMELINE_SUMMARY,
                totalCount: 0,
                allEventCount: 0,
                hasMore: false,
                isLoading: false,
                isLoadingMore: false,
                isInitialized: true,
            });
            return;
        }
        this.state.isLoading = false;
        this.state.isLoadingMore = false;
        this.container.querySelector('#timeline-root')?.setAttribute('aria-busy', 'false');
        this.updateLoadingIndicator('Could not load timeline events');
    }

    protected async loadPage(reset: boolean): Promise<void> {
        if (!reset && (this.state.isLoading || this.state.isLoadingMore || !this.state.hasMore)) {
            return;
        }

        const requestId = ++this.requestId;
        const isInitialLoad = !this.state.isInitialized;
        const offset = reset ? 0 : this.state.events.length;
        this.markPageLoading(reset, isInitialLoad);

        try {
            const response = await getTimelinePage({
                request_id: requestId,
                year: this.state.selectedYear === 'all' ? null : Number.parseInt(this.state.selectedYear, 10),
                kind: this.state.selectedKind === 'all' ? null : this.state.selectedKind,
                search_query: this.state.searchQuery,
                offset,
                limit: TIMELINE_PAGE_SIZE,
            });
            if (requestId !== this.requestId || response.request_id !== requestId) {
                return;
            }

            const events = reset ? response.events : [...this.state.events, ...response.events];
            this.setState({
                events,
                availableYears: response.available_years,
                ambiguousTitles: response.ambiguous_titles,
                summary: response.summary,
                totalCount: response.total_count,
                allEventCount: response.all_event_count,
                hasMore: response.has_more,
                isLoading: false,
                isLoadingMore: false,
                isInitialized: true,
            });
        } catch (error) {
            this.handlePageLoadError(error, requestId, isInitialLoad);
        }
    }

    private markBucketsLoading(isInitialLoad: boolean): void {
        this.state.isLoadingBuckets = true;
        if (isInitialLoad) {
            this.state.isLoading = true;
            const root = this.container.querySelector<HTMLElement>('#timeline-root');
            if (root) {
                root.setAttribute('aria-busy', 'true');
            } else {
                this.render();
            }
            return;
        }
        this.container.querySelector('#timeline-root')?.setAttribute('aria-busy', 'true');
    }

    private handleBucketsLoadError(error: unknown, requestId: number, isInitialLoad: boolean): void {
        if (requestId !== this.bucketRequestId) return;
        Logger.error('Failed to load timeline buckets', error);
        if (isInitialLoad) {
            this.setState({
                buckets: [],
                bucketsSignature: '',
                availableYears: [],
                ambiguousTitles: [],
                summary: EMPTY_TIMELINE_SUMMARY,
                isLoading: false,
                isLoadingBuckets: false,
                isInitialized: true,
            });
            return;
        }
        this.state.isLoading = false;
        this.state.isLoadingBuckets = false;
        this.container.querySelector('#timeline-root')?.setAttribute('aria-busy', 'false');
    }

    private buildBucketsSignature(granularity: TimelineBucketGranularity, year: number | null, searchQuery: string): string {
        return `${granularity}|${year ?? ''}|${searchQuery}`;
    }

    protected async loadBuckets(forceRefresh: boolean): Promise<void> {
        const granularity = getTimelineBucketGranularity(this.state.zoomLevel);
        if (!granularity) {
            return;
        }

        const year = granularity === 'year' || this.state.selectedYear === 'all'
            ? null
            : Number.parseInt(this.state.selectedYear, 10);
        const signature = this.buildBucketsSignature(granularity, year, this.state.searchQuery);

        // An empty signature means nothing has been fetched yet; a matching non-empty one
        // means this exact query already has its answer, even if the answer was no rows.
        if (!forceRefresh && this.state.bucketsSignature !== '' && signature === this.state.bucketsSignature) {
            return;
        }

        const requestId = ++this.bucketRequestId;
        const isInitialLoad = !this.state.isInitialized;
        this.markBucketsLoading(isInitialLoad);

        try {
            const response = await getTimelineBuckets({
                requestId,
                granularity,
                year,
                searchQuery: this.state.searchQuery,
            });
            if (requestId !== this.bucketRequestId || response.requestId !== requestId) {
                return;
            }

            this.setState({
                buckets: response.buckets,
                bucketsSignature: signature,
                availableYears: response.availableYears,
                ambiguousTitles: response.ambiguousTitles,
                summary: response.summary,
                isLoading: false,
                isLoadingBuckets: false,
                isInitialized: true,
            });
        } catch (error) {
            this.handleBucketsLoadError(error, requestId, isInitialLoad);
        }
    }

    private updateLoadingIndicator(label: string): void {
        const indicator = this.container.querySelector<HTMLElement>('#timeline-page-status');
        if (indicator) indicator.textContent = label;
        const button = this.container.querySelector<HTMLButtonElement>('#timeline-load-more');
        if (button) button.disabled = this.state.isLoading || this.state.isLoadingMore;
    }

    private getOrCreateRoot(): HTMLElement {
        const existing = this.container.querySelector<HTMLElement>('#timeline-root');
        if (existing) return existing;

        this.clear();
        const root = html`<div id="timeline-root" class="timeline-root"></div>`;
        this.container.appendChild(root);
        return root;
    }

    render(): void {
        this.coverVisibility?.disconnect();
        this.coverVisibility = null;
        this.paginationObserver?.disconnect();
        this.paginationObserver = null;
        if (this.waveFrame !== null) {
            globalThis.cancelAnimationFrame(this.waveFrame);
            this.waveFrame = null;
        }

        const root = this.getOrCreateRoot();
        if (this.observedResizeRoot !== root) {
            this.observedResizeRoot = root;
            this.resizeObserver.observe(root);
        }
        const focusState = captureFocusState(root);
        root.className = `timeline-root is-zoom-${this.state.zoomLevel}`;
        root.setAttribute(
            'aria-busy',
            String(this.state.isLoading || this.state.isLoadingMore || this.state.isLoadingBuckets),
        );

        if (!this.state.isInitialized) {
            root.setAttribute('aria-busy', 'true');
            root.innerHTML = `
                <div class="timeline-loading">
                    <div class="timeline-loading-spinner" aria-hidden="true"></div>
                    <div class="timeline-loading-label">Loading timeline...</div>
                </div>
            `;
            return;
        }

        const granularity = getTimelineBucketGranularity(this.state.zoomLevel);
        const visibleEvents = granularity ? [] : this.state.events;
        const groups = granularity
            ? []
            : measureSynchronous(
                'aggregation',
                'timeline_groups',
                () => this.groupEventsByMonth(visibleEvents),
                { event_count: visibleEvents.length },
            );
        root.innerHTML = measureSynchronous(
            'render',
            'timeline_markup',
            () => this.renderContent(visibleEvents, groups, granularity),
            { event_count: visibleEvents.length },
        );
        restoreFocusState(root, focusState);
        this.setupListeners(root);
        this.applyBucketCoverFit(root);
        if (this.state.zoomLevel !== 'compact') {
            this.setupCoverLoading(root);
        }
        if (!granularity) {
            this.setupPagination(root);
        }
        this.renderTimelineWave(root, this.buildWaveMetrics(granularity, visibleEvents));
    }

    private applyBucketCoverFit(root: HTMLElement): void {
        const granularity = getTimelineBucketGranularity(this.state.zoomLevel);
        if (!granularity) {
            return;
        }

        const strips: TimelineBucketCoverStrip[] = [];
        for (const strip of root.querySelectorAll<HTMLElement>('.timeline-bucket-covers')) {
            const overflowTile = strip.querySelector<HTMLElement>('.timeline-bucket-cover-overflow');
            if (!overflowTile) {
                continue;
            }
            strips.push({
                strip,
                covers: Array.from(strip.querySelectorAll<HTMLElement>('.timeline-bucket-cover')),
                overflowTile,
            });
        }
        if (strips.length === 0) {
            return;
        }

        for (const { covers } of strips) {
            for (const cover of covers) {
                cover.hidden = false;
            }
        }

        const maxRows = TIMELINE_BUCKET_COVER_ROWS[granularity];
        const coverGap = Number.parseFloat(globalThis.getComputedStyle(strips[0].strip).columnGap) || 0;

        const fits = strips.map(({ strip, covers, overflowTile }) => {
            const distinctMediaCount = Number(strip.dataset.distinctMedia ?? covers.length);
            if (covers.length === 0) {
                return { covers, overflowTile, visibleCount: 0, overflowCount: distinctMediaCount };
            }
            const availableWidth = strip.clientWidth;
            const coverWidth = covers[0].getBoundingClientRect().width;
            if (availableWidth === 0 || coverWidth === 0) {
                return null;
            }
            const fit = fitTimelineBucketCovers({
                availableWidth,
                coverWidth,
                coverGap,
                maxRows,
                renderedCount: covers.length,
                distinctMediaCount,
            });
            return { covers, overflowTile, ...fit };
        });

        for (const entry of fits) {
            if (!entry) {
                continue;
            }
            const { covers, overflowTile, visibleCount, overflowCount } = entry;
            covers.forEach((cover, index) => {
                cover.hidden = index >= visibleCount;
            });
            const overflowLabel = formatTimelineBucketCoverOverflowLabel(overflowCount, visibleCount > 0);
            overflowTile.textContent = overflowLabel ?? '';
            overflowTile.hidden = overflowLabel === null;
        }
    }

    private buildWaveMetrics(granularity: TimelineBucketGranularity | null, events: TimelineEvent[]): number[] {
        return granularity
            ? this.state.buckets.map(bucket => getBucketWaveMetric(bucket))
            : events.map(event => getWaveMetric(event));
    }

    private getYearOptions(): string[] {
        return this.state.availableYears.map(String);
    }

    private groupEventsByMonth(events: TimelineEvent[]): TimelineGroup[] {
        const groups: TimelineGroup[] = [];
        let currentGroup: TimelineGroup | undefined;

        for (const event of events) {
            const key = event.date.slice(0, 7);
            const currentGroupKey: string | undefined = currentGroup?.key;
            if (currentGroupKey !== key) {
                currentGroup = {
                    key,
                    label: MONTH_FORMATTER.format(this.toUtcDate(event.date)),
                    events: [],
                };
                groups.push(currentGroup);
            }

            if (!currentGroup) {
                continue;
            }

            currentGroup.events.push(event);
        }

        return groups;
    }

    private renderContent(
        visibleEvents: TimelineEvent[],
        groups: TimelineGroup[],
        granularity: TimelineBucketGranularity | null,
    ): string {
        const summaryItems = this.getSummaryItems();
        const yearOptions = this.getYearOptions();
        const level = this.state.zoomLevel;
        const isCompact = level === 'compact';

        let timelineContent: string;
        let hasRows: boolean;

        if (granularity) {
            hasRows = this.state.buckets.length > 0;
            timelineContent = hasRows
                ? this.renderBuckets(this.state.buckets, granularity)
                : `
                    <div class="timeline-empty card">
                        <h3>No matching periods</h3>
                        <p>Try a different search or year.</p>
                    </div>
                `;
        } else {
            const hasAnyEvents = this.state.allEventCount > 0;
            hasRows = hasAnyEvents && visibleEvents.length > 0;
            timelineContent = groups
                .map((group, groupIndex) => (isCompact ? this.renderCompactGroup(group) : this.renderGroup(group, groupIndex)))
                .join('');

            if (!hasAnyEvents) {
                timelineContent = `
                    <div class="timeline-empty card">
                        <h3>No timeline yet</h3>
                        <p>Start logging activity or add dated milestones to populate this view.</p>
                    </div>
                `;
            } else if (visibleEvents.length === 0) {
                timelineContent = `
                    <div class="timeline-empty card">
                        <h3>No matching events</h3>
                        <p>Try a different search, year, or event kind.</p>
                    </div>
                `;
            } else if (this.state.hasMore || this.state.totalCount > visibleEvents.length) {
                timelineContent += `
                    <div class="timeline-page-sentinel" id="timeline-page-sentinel">
                        <button type="button" class="btn btn-ghost" id="timeline-load-more">
                            Load more
                        </button>
                        <span id="timeline-page-status" class="timeline-page-status" aria-live="polite">
                            Showing ${visibleEvents.length.toLocaleString()} of ${this.state.totalCount.toLocaleString()} events
                        </span>
                    </div>
                `;
            }
        }

        return `
            <svg class="timeline-wave" aria-hidden="true" preserveAspectRatio="none"></svg>
            <div class="timeline-stack">
                <section class="timeline-summary-strip" aria-label="Timeline summary">
                    ${summaryItems
                        .map(
                            item => `
                                <div class="timeline-summary-item">
                                    <span class="timeline-summary-value">${escapeHTML(item.value)}</span>
                                    <span class="timeline-summary-label">${escapeHTML(item.label)}</span>
                                </div>
                            `,
                        )
                        .join('')}
                </section>

                <section class="card timeline-filter-card">
                    <div class="timeline-filter-row">
                        ${this.renderSearchFilterField()}
                        ${level !== 'year' ? this.renderYearFilterField(yearOptions) : ''}
                        ${!isTimelineBucketLevel(level) ? this.renderKindFilterField() : ''}
                        ${this.renderZoomControl()}
                    </div>
                </section>

                <section class="timeline-shell${hasRows ? '' : ' is-empty'}">
                    ${timelineContent}
                </section>
            </div>
        `;
    }

    private renderSearchFilterField(): string {
        return `
            <label class="timeline-filter-field">
                <span class="timeline-filter-label">Search</span>
                <input
                    id="timeline-search"
                    type="search"
                    placeholder="Search titles or milestones"
                    value="${escapeHTML(this.state.searchQuery)}"
                />
            </label>
        `;
    }

    private renderYearFilterField(yearOptions: string[]): string {
        return `
            <div class="timeline-filter-field timeline-filter-field-sm">
                <span class="timeline-filter-label" id="timeline-year-filter-label">Year</span>
                <select id="timeline-year-filter" aria-labelledby="timeline-year-filter-label">
                    <option value="all" ${this.state.selectedYear === 'all' ? 'selected' : ''}>All years</option>
                    ${yearOptions
                        .map(
                            year => `<option value="${escapeHTML(year)}" ${
                                this.state.selectedYear === year ? 'selected' : ''
                            }>${escapeHTML(year)}</option>`,
                        )
                        .join('')}
                </select>
            </div>
        `;
    }

    private renderKindFilterField(): string {
        return `
            <div class="timeline-filter-field timeline-filter-field-sm">
                <span class="timeline-filter-label" id="timeline-kind-filter-label">Kind</span>
                <select id="timeline-kind-filter" aria-labelledby="timeline-kind-filter-label">
                    ${this.renderKindOptions()}
                </select>
            </div>
        `;
    }

    private renderZoomControl(): string {
        const level = this.state.zoomLevel;
        const atMostDetailed = level === TIMELINE_ZOOM_LEVELS[0];
        const atMostZoomedOut = level === TIMELINE_ZOOM_LEVELS.at(-1);

        return `
            <div class="timeline-filter-field timeline-filter-field-zoom">
                <span class="timeline-filter-label" id="timeline-zoom-label">Zoom</span>
                <div class="timeline-zoom" role="group" aria-labelledby="timeline-zoom-label">
                    <button
                        type="button"
                        class="timeline-zoom-button"
                        id="btn-timeline-zoom-out"
                        aria-label="Zoom out to a wider time range"
                        title="Zoom out"
                        ${atMostZoomedOut ? 'disabled' : ''}
                    >−</button>
                    <button
                        type="button"
                        class="timeline-zoom-value"
                        id="btn-timeline-zoom-reset"
                        aria-label="Reset timeline detail level"
                        title="Reset detail level"
                    >${escapeHTML(getTimelineZoomLabel(level))}</button>
                    <button
                        type="button"
                        class="timeline-zoom-button"
                        id="btn-timeline-zoom-in"
                        aria-label="Zoom in to more detail"
                        title="Zoom in"
                        ${atMostDetailed ? 'disabled' : ''}
                    >+</button>
                </div>
            </div>
        `;
    }

    private renderKindOptions(): string {
        const kindOptions: Array<{ value: TimelineState['selectedKind']; label: string }> = [
            { value: 'all', label: 'All kinds' },
            { value: 'started', label: 'Started' },
            { value: 'finished', label: 'Completed' },
            { value: 'paused', label: 'Paused' },
            { value: 'dropped', label: 'Dropped' },
            { value: 'milestone', label: 'Milestones' },
        ];

        return kindOptions
            .map(
                option => `<option value="${option.value}" ${
                    this.state.selectedKind === option.value ? 'selected' : ''
                }>${escapeHTML(option.label)}</option>`,
            )
            .join('');
    }

    private renderGroup(group: TimelineGroup, groupIndex: number): string {
        return `
            <section
                class="timeline-group"
                data-group-key="${escapeHTML(group.key)}"
                aria-label="${escapeHTML(group.label)}"
            >
                ${this.renderMonthMarker(group.label)}
                ${group.events
                    .map((event, eventIndex) => this.renderEvent(event, (groupIndex + eventIndex) % 2 === 0))
                    .join('')}
            </section>
        `;
    }

    private renderCompactGroup(group: TimelineGroup): string {
        return `
            <section
                class="timeline-group timeline-compact-group"
                data-group-key="${escapeHTML(group.key)}"
                aria-label="${escapeHTML(group.label)}"
            >
                ${this.renderMonthMarker(group.label)}
                ${group.events.map(event => this.renderCompactEvent(event)).join('')}
            </section>
        `;
    }

    private renderMonthMarker(label: string): string {
        return `
            <div class="timeline-month-marker">
                <div class="timeline-month-label">
                    <span class="timeline-month-label-text">${escapeHTML(label)}</span>
                </div>
            </div>
        `;
    }

    private renderEvent(event: TimelineEvent, alignLeft: boolean): string {
        const copy = this.renderEventCopy(event);
        const metaItems = this.renderMetaItems(event);
        const accentClass = `kind-${event.kind}`;
        const cover = this.renderCover(event);

        return `
            <article
                class="timeline-entry ${accentClass} ${alignLeft ? 'is-left' : 'is-right'}"
                data-timeline-date="${escapeHTML(event.date)}"
            >
                <div class="timeline-entry-node" aria-hidden="true">
                    <span class="timeline-node-core"></span>
                </div>
                <div class="timeline-card">
                    <div class="timeline-card-layout ${cover ? 'has-cover' : ''}">
                        <div class="timeline-card-content">
                            <div class="timeline-card-header">
                                <div class="timeline-card-header-main">
                                    <span class="timeline-kind-pill">${escapeHTML(this.getKindLabel(event.kind))}</span>
                                    ${
                                        event.contentType
                                            ? `<span class="timeline-tag timeline-tag-inline">${escapeHTML(
                                                  event.contentType,
                                              )}</span>`
                                            : ''
                                    }
                                </div>
                                <span class="timeline-date-pill">${escapeHTML(this.formatDate(event.date))}</span>
                            </div>
                            <div class="timeline-card-copy">${copy}</div>
                            ${
                                metaItems.length > 0
                                    ? `<div class="timeline-card-meta">${metaItems.join('')}</div>`
                                    : ''
                            }
                        </div>
                        ${cover}
                    </div>
                </div>
            </article>
        `;
    }

    private renderCompactEvent(event: TimelineEvent): string {
        const accentClass = `kind-${event.kind}`;
        const mediaLabel = this.getMediaDisplayTitle(event);
        const metricParts = this.getCompactMetricParts(event);
        const isMilestone = event.kind === 'milestone';

        return `
            <article class="timeline-compact-row ${accentClass}" data-timeline-date="${escapeHTML(event.date)}">
                <span class="timeline-compact-detail">
                    <button type="button" class="timeline-media-link" data-media-id="${event.mediaId}">
                        ${escapeHTML(mediaLabel)}
                    </button>
                </span>
                <span class="timeline-compact-node" aria-hidden="true"></span>
                <span class="timeline-compact-meta${isMilestone ? ' is-milestone' : ''}">
                    <span class="timeline-compact-kind">${escapeHTML(this.getKindLabel(event.kind))}</span>
                    ${
                        isMilestone
                            ? `<span class="timeline-compact-milestone">${escapeHTML(
                                  event.milestoneName ?? 'Milestone',
                              )}</span>`
                            : `<span class="timeline-compact-date">${escapeHTML(
                                  COMPACT_DATE_FORMATTER.format(this.toUtcDate(event.date)),
                              )}</span>
                               ${this.renderSeparatedParts(metricParts, 'timeline-compact-metric', true)}`
                    }
                </span>
            </article>
        `;
    }

    private renderSeparatedParts(parts: string[], partClassName: string, leadingSeparator = false): string {
        if (parts.length === 0) {
            return '';
        }
        const separator = `<span class="timeline-separator" aria-hidden="true">${TIMELINE_METRIC_SEPARATOR}</span>`;
        const spans = parts
            .map(part => `<span class="${partClassName}">${escapeHTML(part)}</span>`)
            .join(separator);
        return leadingSeparator ? `${separator}${spans}` : spans;
    }

    private getCompactMetricParts(event: TimelineEvent): string[] {
        if (!this.isTerminalEvent(event.kind)) {
            return [];
        }
        return [
            formatOptionalStatsDuration(event.totalMinutes),
            formatOptionalCount(event.totalCharacters, 'char'),
        ].filter(part => part.length > 0);
    }

    private renderBuckets(buckets: TimelineBucket[], granularity: TimelineBucketGranularity): string {
        if (granularity === 'year') {
            return buckets.map(bucket => this.renderBucketRow(bucket, granularity)).join('');
        }

        const rows: string[] = [];
        let currentYear: string | null = null;
        for (const bucket of buckets) {
            const year = bucket.key.slice(0, 4);
            if (year !== currentYear) {
                currentYear = year;
                rows.push(this.renderMonthMarker(year));
            }
            rows.push(this.renderBucketRow(bucket, granularity));
        }
        return rows.join('');
    }

    private renderBucketRow(bucket: TimelineBucket, granularity: TimelineBucketGranularity): string {
        const label = formatTimelineBucketLabel(bucket, granularity);
        const totalsParts = buildTimelineBucketTotalsParts(bucket);
        const pips = getTimelineBucketPips(bucket);
        const dominantKind = getTimelineBucketDominantKind(bucket);
        const dominantKindClass = dominantKind ? ` kind-${dominantKind}` : '';

        return `
            <article
                class="timeline-bucket-row card${dominantKindClass}"
                data-timeline-date="${escapeHTML(bucket.startDate)}"
                data-bucket-key="${escapeHTML(bucket.key)}"
            >
                <div class="timeline-bucket-node" aria-hidden="true"></div>
                <div class="timeline-bucket-content">
                    <div class="timeline-bucket-header">
                        <h3 class="timeline-bucket-label">${escapeHTML(label)}</h3>
                        <span class="timeline-bucket-totals">${this.renderSeparatedParts(totalsParts, 'timeline-bucket-total')}</span>
                    </div>
                    ${
                        pips.length > 0
                            ? `<div class="timeline-bucket-pips">
                                ${pips
                                    .map(pip => `<span class="timeline-bucket-pip kind-${pip.kind}">${escapeHTML(pip.label)}</span>`)
                                    .join('')}
                            </div>`
                            : ''
                    }
                    ${this.renderBucketCovers(bucket)}
                </div>
            </article>
        `;
    }

    private renderBucketCovers(bucket: TimelineBucket): string {
        if (bucket.distinctMediaCount === 0) {
            return '';
        }

        const covers = bucket.highlights
            .map(highlight => this.renderCover(highlight, 'timeline-bucket-cover', true))
            .join('');
        return `
            <div class="timeline-bucket-covers" data-distinct-media="${bucket.distinctMediaCount}">
                ${covers}
                <span class="timeline-bucket-cover-overflow" hidden></span>
            </div>
        `;
    }

    private renderCover(source: TimelineCoverSource, extraClassName = '', showTitleTooltip = false): string {
        if (!source.coverImage || source.coverImage.trim().length === 0) {
            return '';
        }

        const coverUrl = MediaCoverLoader.getCached(source.coverImage);
        const mediaLabel = this.getMediaDisplayTitle(source);
        return `
            <div
                class="timeline-cover-shell${extraClassName ? ` ${extraClassName}` : ''}"
                data-cover-media-id="${source.mediaId}"
                data-cover-ref="${escapeHTML(source.coverImage)}"
                data-cover-alt="${escapeHTML(`${mediaLabel} cover`)}"
                ${showTitleTooltip ? `title="${escapeHTML(mediaLabel)}"` : ''}
            >
                ${
                    coverUrl
                        ? `<img class="timeline-cover-image progressive-cover-image is-loaded" src="${escapeHTML(coverUrl)}" alt="${escapeHTML(
                              mediaLabel,
                          )} cover" loading="lazy" decoding="async" />`
                        : '<span class="timeline-cover-placeholder"></span>'
                }
            </div>
        `;
    }

    private renderEventCopy(event: TimelineEvent): string {
        const mediaLabel = this.getMediaDisplayTitle(event);
        const mediaButton = `
            <button type="button" class="timeline-media-link" data-media-id="${event.mediaId}">
                ${escapeHTML(mediaLabel)}
            </button>
        `;
        const action = this.getActivityAction(event.activityType);
        const completedAction = this.getCompletedAction(event.activityType);

        switch (event.kind) {
            case 'started':
                return action
                    ? `Started ${escapeHTML(action)} ${mediaButton}`
                    : `Started ${mediaButton}`;
            case 'finished':
                if (event.sameDayTerminal) {
                    return completedAction
                        ? `${escapeHTML(completedAction)} ${mediaButton}`
                        : `Completed ${mediaButton}`;
                }
                return action
                    ? `Finished ${escapeHTML(action)} ${mediaButton}`
                    : `Finished ${mediaButton}`;
            case 'paused':
                return `Put ${mediaButton} on pause`;
            case 'dropped':
                return `Dropped ${mediaButton}`;
            case 'milestone':
                return `Reached "${escapeHTML(event.milestoneName ?? 'Milestone')}" in ${mediaButton}`;
        }
    }

    private getMediaDisplayTitle(entity: TimelineMediaDisplayEntity): string {
        if (!this.state.ambiguousTitles.includes(entity.mediaTitle)) {
            return entity.mediaTitle;
        }

        const variant = entity.mediaVariant.trim();
        return `${entity.mediaTitle} — ${variant || '(no variant)'}`;
    }

    private renderMetaItems(event: TimelineEvent): string[] {
        const isTerminal = this.isTerminalEvent(event.kind);
        const isMilestone = event.kind === 'milestone';

        return [
            { label: 'Total time', value: isTerminal ? formatOptionalStatsDuration(event.totalMinutes) : '' },
            { label: 'Total characters', value: isTerminal ? formatOptionalNumber(event.totalCharacters) : '' },
            { label: 'Time', value: isMilestone ? formatOptionalStatsDuration(event.milestoneMinutes) : '' },
            { label: 'Characters', value: isMilestone ? formatOptionalNumber(event.milestoneCharacters) : '' },
        ]
            .filter(item => item.value.length > 0)
            .map(
                item =>
                    `<span class="timeline-meta-item">${item.label}: <strong>${escapeHTML(item.value)}</strong></span>`,
            );
    }

    private getActivityAction(activityType: string): string | null {
        switch (activityType) {
            case 'Reading':
                return 'reading';
            case 'Watching':
                return 'watching';
            case 'Playing':
                return 'playing';
            case 'Listening':
                return 'listening';
            default:
                return null;
        }
    }

    private getCompletedAction(activityType: string): string | null {
        switch (activityType) {
            case 'Reading':
                return 'Read';
            case 'Watching':
                return 'Watched';
            case 'Playing':
                return 'Played';
            case 'Listening':
                return 'Listened to';
            default:
                return null;
        }
    }

    private getKindLabel(kind: TimelineEventKind): string {
        switch (kind) {
            case 'started':
                return 'Started';
            case 'finished':
                return 'Completed';
            case 'paused':
                return 'Paused';
            case 'dropped':
                return 'Dropped';
            case 'milestone':
                return 'Milestone';
            default:
                return 'Event';
        }
    }

    private isTerminalEvent(kind: TimelineEventKind): boolean {
        return kind === 'finished' || kind === 'paused' || kind === 'dropped';
    }

    private formatDate(date: string): string {
        return DATE_FORMATTER.format(this.toUtcDate(date));
    }

    private toUtcDate(date: string): Date {
        return new Date(`${date}T00:00:00Z`);
    }

    private attachZoomGestures(root: HTMLElement): void {
        if (this.zoomGesturesRoot === root) return;

        this.detachZoomGestures?.();
        this.zoomGesturesRoot = root;
        this.detachZoomGestures = attachZoomGestures(root, {
            onZoom: direction => this.setZoomLevel(stepTimelineZoomLevel(this.state.zoomLevel, direction)),
            enablePinch: true,
            pinchMode: 'once-per-gesture',
        });
    }

    private setupListeners(root: HTMLElement): void {
        const searchInput = root.querySelector('#timeline-search') as HTMLInputElement | null;
        searchInput?.addEventListener('input', event => {
            this.state.searchQuery = (event.target as HTMLInputElement).value;
            // Invalidate an already-running filter request immediately rather
            // than allowing it to flash old results during the debounce.
            this.requestId += 1;
            this.bucketRequestId += 1;
            root.setAttribute('aria-busy', 'true');
            if (this.searchTimer !== null) {
                globalThis.clearTimeout(this.searchTimer);
            }
            this.searchTimer = globalThis.setTimeout(() => {
                this.searchTimer = null;
                this.runBackgroundTask(this.loadForCurrentZoomLevel(true), 'Failed to filter timeline');
            }, TIMELINE_SEARCH_DEBOUNCE_MS);
        });

        const yearFilter = root.querySelector('#timeline-year-filter') as HTMLSelectElement | null;
        yearFilter?.addEventListener('change', event => {
            this.state.selectedYear = (event.target as HTMLSelectElement).value;
            this.runBackgroundTask(this.loadForCurrentZoomLevel(true), 'Failed to filter timeline by year');
        });

        const kindFilter = root.querySelector('#timeline-kind-filter') as HTMLSelectElement | null;
        kindFilter?.addEventListener('change', event => {
            this.state.selectedKind = (event.target as HTMLSelectElement).value as TimelineState['selectedKind'];
            this.runBackgroundTask(this.loadForCurrentZoomLevel(true), 'Failed to filter timeline by kind');
        });

        root.querySelector('#timeline-load-more')?.addEventListener('click', () => {
            this.runBackgroundTask(this.loadPage(false), 'Failed to load more timeline events');
        });

        root.querySelector('#btn-timeline-zoom-out')?.addEventListener('click', () => {
            this.setZoomLevel(stepTimelineZoomLevel(this.state.zoomLevel, 'out'));
        });
        root.querySelector('#btn-timeline-zoom-in')?.addEventListener('click', () => {
            this.setZoomLevel(stepTimelineZoomLevel(this.state.zoomLevel, 'in'));
        });
        root.querySelector('#btn-timeline-zoom-reset')?.addEventListener('click', () => {
            this.setZoomLevel(DEFAULT_TIMELINE_ZOOM_LEVEL);
        });

        this.attachZoomGestures(root);

        root.querySelectorAll<HTMLButtonElement>('.timeline-media-link').forEach(button => {
            button.addEventListener('click', () => {
                const mediaId = Number.parseInt(button.dataset.mediaId || '', 10);
                if (Number.isFinite(mediaId)) {
                    this.navigateToMedia(mediaId);
                }
            });
        });
    }

    private setZoomLevel(level: TimelineZoomLevel): void {
        if (level === this.state.zoomLevel) {
            return;
        }

        // Discard whatever the previous level had in flight. Its response would land
        // after this level's and overwrite the shared summary/year state with figures
        // computed under the other level's filters.
        this.requestId += 1;
        this.bucketRequestId += 1;

        const previousLevel = this.state.zoomLevel;
        this.persistZoomLevel(level);
        this.setState({ zoomLevel: level });
        this.scrollToTop();

        if (isTimelineBucketLevel(level)) {
            this.runBackgroundTask(this.loadBuckets(false), 'Failed to load timeline buckets');
            return;
        }

        // Detailed and compact share the same loaded events, so switching between
        // them needs no refetch. Coming back from a bucket level does, since events
        // may never have been loaded or may no longer match the active filters.
        if (isTimelineBucketLevel(previousLevel)) {
            this.runBackgroundTask(this.loadPage(true), 'Failed to load timeline events');
        }
    }

    private scrollToTop(): void {
        this.container.closest<HTMLElement>('.main-content')?.scrollTo({ top: 0 });
    }

    private persistZoomLevel(level: TimelineZoomLevel): void {
        this.runBackgroundTask(
            setSetting(SETTING_KEYS.TIMELINE_ZOOM_LEVEL, level),
            'Failed to persist timeline zoom level preference',
        );
    }

    private getSummaryItems(): TimelineSummaryItem[] {
        const isKindFilterRendered = !isTimelineBucketLevel(this.state.zoomLevel);
        const secondItem =
            isKindFilterRendered && this.state.selectedKind !== 'all'
                ? {
                    label: KIND_SUMMARY_LABELS[this.state.selectedKind],
                    value: this.state.summary.filtered_media_count.toLocaleString(),
                }
                : {
                    label: 'Completed titles',
                    value: this.state.summary.completed_titles.toLocaleString(),
                };

        const items: TimelineSummaryItem[] = [
            {
                label: 'Total time',
                value: formatStatsDuration(this.state.summary.total_minutes),
            },
            secondItem,
        ];

        if (this.state.summary.total_characters > 0) {
            items.push({
                label: 'Characters tracked',
                value: this.state.summary.total_characters.toLocaleString(),
            });
        }

        return items;
    }

    private setupCoverLoading(root: HTMLElement): void {
        const coverNodes = Array.from(root.querySelectorAll<HTMLElement>('[data-cover-media-id][data-cover-ref]'));
        if (coverNodes.length === 0) {
            return;
        }

        const token = ++this.renderToken;
        this.coverNodesByKey = new Map();
        for (const node of coverNodes) {
            const key = buildCoverNodeKey(node.dataset.coverMediaId, node.dataset.coverRef);
            const existing = this.coverNodesByKey.get(key);
            if (existing) {
                existing.push(node);
            } else {
                this.coverNodesByKey.set(key, [node]);
            }
        }

        const rootMargin = isTimelineBucketLevel(this.state.zoomLevel)
            ? BUCKET_COVER_PRELOAD_ROOT_MARGIN
            : COVER_PRELOAD_ROOT_MARGIN;
        this.coverVisibility = new CoverVisibilityController(rootMargin);
        const loadNodeCover = (node: HTMLElement) => {
            const mediaId = Number.parseInt(node.dataset.coverMediaId || '', 10);
            const coverRef = node.dataset.coverRef || '';
            if (
                !Number.isFinite(mediaId)
                || coverRef.trim().length === 0
                || node.querySelector('img.timeline-cover-image')
            ) {
                return;
            }
            this.runBackgroundTask(
                this.ensureCoverLoaded(mediaId, coverRef, token),
                `Failed to load timeline cover for media ${mediaId}`,
                'warn',
            );
        };

        // Eager candidates are picked in document order, and at bucket levels the leading nodes
        // may already be hidden by applyBucketCoverFit — fetching those would spend bytes on a
        // cover that is never shown. Hidden nodes stay observed so a resize that reveals them
        // still loads them.
        let eagerLoadCount = 0;
        coverNodes.forEach(node => {
            if (node.querySelector('img.timeline-cover-image')) return;
            if (!node.hidden && eagerLoadCount < COVER_EAGER_LOAD_COUNT) {
                eagerLoadCount += 1;
                this.coverVisibility?.loadNow(node, () => loadNodeCover(node));
            } else {
                this.coverVisibility?.observe(node, () => loadNodeCover(node));
            }
        });
    }

    private async ensureCoverLoaded(mediaId: number, coverRef: string, token: number): Promise<void> {
        const coverUrl = await MediaCoverLoader.load(coverRef);
        if (!coverUrl || token !== this.renderToken) return;

        const matchingNodes = this.coverNodesByKey.get(buildCoverNodeKey(String(mediaId), coverRef)) ?? [];

        for (const node of matchingNodes) {
            if (node.querySelector('img.timeline-cover-image')) continue;
            const image = document.createElement('img');
            image.className = 'timeline-cover-image progressive-cover-image';
            image.alt = node.dataset.coverAlt || 'Media cover';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
            image.src = coverUrl;
            node.replaceChildren(image);
            if (image.complete) requestAnimationFrame(() => image.classList.add('is-loaded'));
        }
    }

    private setupPagination(root: HTMLElement): void {
        if (!this.state.hasMore || this.state.isLoadingMore || typeof IntersectionObserver === 'undefined') {
            return;
        }
        const sentinel = root.querySelector<HTMLElement>('#timeline-page-sentinel');
        if (!sentinel) return;

        this.paginationObserver = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            this.paginationObserver?.disconnect();
            this.paginationObserver = null;
            this.runBackgroundTask(this.loadPage(false), 'Failed to load more timeline events');
        }, { rootMargin: PAGINATION_ROOT_MARGIN, threshold: PAGINATION_THRESHOLD });
        this.paginationObserver.observe(sentinel);
    }

    protected renderTimelineWave(root: HTMLElement, waveMetrics: number[]): void {
        const wave = root.querySelector('.timeline-wave') as SVGSVGElement | null;
        if (!wave) {
            return;
        }

        if (this.isWaveSuppressed()) {
            wave.innerHTML = '';
            return;
        }

        this.waveFrame = globalThis.requestAnimationFrame(() => {
            this.waveFrame = null;

            if (!root.isConnected || this.isWaveSuppressed()) {
                wave.innerHTML = '';
                return;
            }

            const nodes = Array.from(
                root.querySelectorAll<HTMLElement>('.timeline-entry-node, .timeline-compact-node, .timeline-bucket-node'),
            );
            const pointCount = Math.min(nodes.length, waveMetrics.length);

            const backdropRect = root.getBoundingClientRect();
            const waveWidth = Math.max(1, Math.ceil(root.clientWidth));
            const waveHeight = Math.max(1, Math.ceil(root.clientHeight));
            const availableWidth = Math.max(waveWidth, root.parentElement?.clientWidth ?? waveWidth);
            const amplitudeScale = availableWidth / waveWidth;

            const firstNodeRect = nodes[0]?.getBoundingClientRect() ?? null;
            const centerX = firstNodeRect
                ? firstNodeRect.left - backdropRect.left + firstNodeRect.width / 2
                : waveWidth / 2;

            const nodeOffsets = nodes.slice(0, pointCount).map(node => {
                const nodeRect = node.getBoundingClientRect();
                return nodeRect.top - backdropRect.top + nodeRect.height / 2;
            });

            const paths = buildTimelineWavePaths(
                { waveWidth, waveHeight, centerX, amplitudeScale, nodeOffsets },
                waveMetrics,
            );
            if (!paths) {
                wave.innerHTML = '';
                return;
            }

            wave.setAttribute('viewBox', paths.viewBox);
            wave.innerHTML = `
                <path class="timeline-wave-haze timeline-wave-haze-left" d="${paths.haze[0]}"></path>
                <path class="timeline-wave-haze timeline-wave-haze-right" d="${paths.haze[1]}"></path>
                <path class="timeline-wave-body timeline-wave-body-left" d="${paths.body[0]}"></path>
                <path class="timeline-wave-body timeline-wave-body-right" d="${paths.body[1]}"></path>
            `;
        });
    }

    private isSmallTimelineLayout(): boolean {
        if (typeof globalThis.matchMedia !== 'function') {
            return false;
        }

        return globalThis.matchMedia(SMALL_TIMELINE_MEDIA_QUERY).matches;
    }

    private isWaveSuppressed(): boolean {
        return this.state.zoomLevel === 'detailed' && this.isSmallTimelineLayout();
    }

    private runBackgroundTask(
        task: Promise<void>,
        message: string,
        level: 'error' | 'warn' = 'error',
    ): void {
        task.catch(error => {
            if (level === 'warn') {
                Logger.warn(message, error);
                return;
            }

            Logger.error(message, error);
        });
    }

    private navigateToMedia(mediaId: number): void {
        globalThis.dispatchEvent(
            new CustomEvent(EVENTS.APP_NAVIGATE, {
                detail: {
                    view: VIEW_NAMES.MEDIA,
                    focusMediaId: mediaId,
                },
            }),
        );
    }

    public override destroy(): void {
        this.requestId += 1;
        this.bucketRequestId += 1;
        this.renderToken += 1;
        globalThis.removeEventListener('resize', this.handleViewportResize);
        if (this.waveResizeTimer !== null) {
            globalThis.clearTimeout(this.waveResizeTimer);
            this.waveResizeTimer = null;
        }
        this.coverVisibility?.disconnect();
        this.coverVisibility = null;
        this.paginationObserver?.disconnect();
        this.paginationObserver = null;
        this.resizeObserver.disconnect();
        this.observedResizeRoot = null;
        this.detachZoomGestures?.();
        this.detachZoomGestures = null;
        this.zoomGesturesRoot = null;
        if (this.searchTimer !== null) {
            globalThis.clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        if (this.waveFrame !== null) {
            globalThis.cancelAnimationFrame(this.waveFrame);
            this.waveFrame = null;
        }
    }
}

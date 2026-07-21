import {
    getTimelinePage,
    type TimelineEvent,
} from '../api';
import { VIEW_NAMES, EVENTS } from '../constants';
import { Component } from '../component';
import { html, escapeHTML } from '../html';
import { Logger } from '../logger';
import type { TimelineEventKind, TimelineSummary } from '../types';
import { formatHhMm, formatStatsDuration } from '../time';
import { MediaCoverLoader } from '../media/cover_loader';
import { CoverVisibilityController } from '../media/cover_visibility';
import { measureSynchronous } from '../performance';

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

const SMALL_TIMELINE_MEDIA_QUERY = '(max-width: 1024px)';
const TIMELINE_PAGE_SIZE = 40;
const TIMELINE_SEARCH_DEBOUNCE_MS = 180;

export class TimelineView extends Component<TimelineState> {
    private coverVisibility: CoverVisibilityController | null = null;
    private paginationObserver: IntersectionObserver | null = null;
    private requestId = 0;
    private renderToken = 0;
    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    private waveFrame: number | null = null;

    constructor(container: HTMLElement) {
        super(container, {
            events: [],
            availableYears: [],
            ambiguousTitles: [],
            summary: { total_minutes: 0, completed_titles: 0, total_characters: 0 },
            totalCount: 0,
            allEventCount: 0,
            hasMore: false,
            searchQuery: '',
            selectedYear: 'all',
            selectedKind: 'all',
            isLoading: false,
            isLoadingMore: false,
            isInitialized: false,
        });
    }

    async loadData(): Promise<void> {
        if (this.state.isLoading) {
            return;
        }
        await this.loadPage(true);
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
                summary: { total_minutes: 0, completed_titles: 0, total_characters: 0 },
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

    private async loadPage(reset: boolean): Promise<void> {
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

        // Keep the view root stable across async page/filter responses. This
        // avoids a detach/reattach layout flash and preserves interaction
        // targets while only the timeline contents are updated.
        const root = this.getOrCreateRoot();
        root.setAttribute('aria-busy', String(this.state.isLoading || this.state.isLoadingMore));

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

        const visibleEvents = this.state.events;
        const groups = measureSynchronous(
            'aggregation',
            'timeline_groups',
            () => this.groupEventsByMonth(visibleEvents),
            { event_count: visibleEvents.length },
        );
        root.innerHTML = measureSynchronous(
            'render',
            'timeline_markup',
            () => this.renderContent(visibleEvents, groups),
            { event_count: visibleEvents.length },
        );
        this.setupListeners(root);
        this.setupCoverLoading(root);
        this.setupPagination(root);
        this.renderTimelineWave(root, visibleEvents);
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

    private renderContent(visibleEvents: TimelineEvent[], groups: TimelineGroup[]): string {
        const summaryItems = this.getSummaryItems();
        const yearOptions = this.getYearOptions();
        const hasAnyEvents = this.state.allEventCount > 0;
        let timelineContent = groups.map((group, groupIndex) => this.renderGroup(group, groupIndex)).join('');

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

        return `
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
                        <label class="timeline-filter-field">
                            <span class="timeline-filter-label">Search</span>
                            <input
                                id="timeline-search"
                                type="search"
                                placeholder="Search titles or milestones"
                                value="${escapeHTML(this.state.searchQuery)}"
                            />
                        </label>

                        <label class="timeline-filter-field timeline-filter-field-sm">
                            <span class="timeline-filter-label">Year</span>
                            <select id="timeline-year-filter">
                                <option value="all" ${this.state.selectedYear === 'all' ? 'selected' : ''}>All years</option>
                                ${yearOptions
                                    .map(
                                        year => `<option value="${escapeHTML(year)}" ${
                                            this.state.selectedYear === year ? 'selected' : ''
                                        }>${escapeHTML(year)}</option>`,
                                    )
                                    .join('')}
                            </select>
                        </label>

                        <label class="timeline-filter-field timeline-filter-field-sm">
                            <span class="timeline-filter-label">Kind</span>
                            <select id="timeline-kind-filter">
                                ${this.renderKindOptions()}
                            </select>
                        </label>
                    </div>
                </section>

                <section class="timeline-shell">
                    <svg class="timeline-wave" aria-hidden="true"></svg>
                    ${timelineContent}
                </section>
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

    private renderCover(event: TimelineEvent): string {
        if (!event.coverImage || event.coverImage.trim().length === 0) {
            return '';
        }

        const coverUrl = MediaCoverLoader.getCached(event.coverImage);
        const mediaLabel = this.getMediaDisplayTitle(event);
        return `
            <div
                class="timeline-cover-shell"
                data-cover-media-id="${event.mediaId}"
                data-cover-ref="${escapeHTML(event.coverImage)}"
                data-cover-alt="${escapeHTML(`${mediaLabel} cover`)}"
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

    private getMediaDisplayTitle(event: TimelineEvent): string {
        if (!this.state.ambiguousTitles.includes(event.mediaTitle)) {
            return event.mediaTitle;
        }

        const variant = event.mediaVariant.trim();
        return `${event.mediaTitle} — ${variant || '(no variant)'}`;
    }

    private renderMetaItems(event: TimelineEvent): string[] {
        const metaItems: string[] = [];

        if (this.isTerminalEvent(event.kind) && event.totalMinutes > 0) {
            metaItems.push(
                `<span class="timeline-meta-item">Total time: <strong>${escapeHTML(
                    this.formatTimelineDuration(event.totalMinutes),
                )}</strong></span>`,
            );
        }

        if (this.isTerminalEvent(event.kind) && event.totalCharacters > 0) {
            metaItems.push(
                `<span class="timeline-meta-item">Total characters: <strong>${escapeHTML(
                    event.totalCharacters.toLocaleString(),
                )}</strong></span>`,
            );
        }

        if (event.kind === 'milestone' && event.milestoneMinutes > 0) {
            metaItems.push(
                `<span class="timeline-meta-item">Time: <strong>${escapeHTML(
                    this.formatTimelineDuration(event.milestoneMinutes),
                )}</strong></span>`,
            );
        }

        if (event.kind === 'milestone' && event.milestoneCharacters > 0) {
            metaItems.push(
                `<span class="timeline-meta-item">Characters: <strong>${escapeHTML(
                    event.milestoneCharacters.toLocaleString(),
                )}</strong></span>`,
            );
        }

        return metaItems;
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

    private formatTimelineDuration(totalMinutes: number): string {
        if (totalMinutes > 60) {
            return formatHhMm(totalMinutes);
        }
        return `${totalMinutes} Minutes`;
    }

    private formatDate(date: string): string {
        return DATE_FORMATTER.format(this.toUtcDate(date));
    }

    private toUtcDate(date: string): Date {
        return new Date(`${date}T00:00:00Z`);
    }

    private setupListeners(root: HTMLElement): void {
        const searchInput = root.querySelector('#timeline-search') as HTMLInputElement | null;
        searchInput?.addEventListener('input', event => {
            this.state.searchQuery = (event.target as HTMLInputElement).value;
            // Invalidate an already-running filter request immediately rather
            // than allowing it to flash old results during the debounce.
            this.requestId += 1;
            root.setAttribute('aria-busy', 'true');
            if (this.searchTimer !== null) {
                globalThis.clearTimeout(this.searchTimer);
            }
            this.searchTimer = globalThis.setTimeout(() => {
                this.searchTimer = null;
                this.runBackgroundTask(this.loadPage(true), 'Failed to filter timeline');
            }, TIMELINE_SEARCH_DEBOUNCE_MS);
        });

        const yearFilter = root.querySelector('#timeline-year-filter') as HTMLSelectElement | null;
        yearFilter?.addEventListener('change', event => {
            this.state.selectedYear = (event.target as HTMLSelectElement).value;
            this.runBackgroundTask(this.loadPage(true), 'Failed to filter timeline by year');
        });

        const kindFilter = root.querySelector('#timeline-kind-filter') as HTMLSelectElement | null;
        kindFilter?.addEventListener('change', event => {
            this.state.selectedKind = (event.target as HTMLSelectElement).value as TimelineState['selectedKind'];
            this.runBackgroundTask(this.loadPage(true), 'Failed to filter timeline by kind');
        });

        root.querySelector('#timeline-load-more')?.addEventListener('click', () => {
            this.runBackgroundTask(this.loadPage(false), 'Failed to load more timeline events');
        });

        root.querySelectorAll<HTMLButtonElement>('.timeline-media-link').forEach(button => {
            button.addEventListener('click', () => {
                const mediaId = Number.parseInt(button.dataset.mediaId || '', 10);
                if (Number.isFinite(mediaId)) {
                    this.navigateToMedia(mediaId);
                }
            });
        });
    }

    private getSummaryItems(): TimelineSummaryItem[] {
        const items: TimelineSummaryItem[] = [
            {
                label: 'Total time',
                value: formatStatsDuration(this.state.summary.total_minutes),
            },
            {
                label: 'Completed titles',
                value: this.state.summary.completed_titles.toLocaleString(),
            },
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
        this.coverVisibility = new CoverVisibilityController('420px 0px');
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

        coverNodes.forEach((node, index) => {
            if (node.querySelector('img.timeline-cover-image')) return;
            if (index < 4) {
                this.coverVisibility?.loadNow(node, () => loadNodeCover(node));
            } else {
                this.coverVisibility?.observe(node, () => loadNodeCover(node));
            }
        });
    }

    private async ensureCoverLoaded(mediaId: number, coverRef: string, token: number): Promise<void> {
        const coverUrl = await MediaCoverLoader.load(coverRef);
        if (!coverUrl || token !== this.renderToken) return;

        const matchingNodes = Array.from(
            this.container.querySelectorAll<HTMLElement>('[data-cover-media-id][data-cover-ref]'),
        ).filter(node => (
            Number.parseInt(node.dataset.coverMediaId || '', 10) === mediaId
            && node.dataset.coverRef === coverRef
        ));

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
        }, { rootMargin: '800px 0px', threshold: 0.01 });
        this.paginationObserver.observe(sentinel);
    }

    private renderTimelineWave(root: HTMLElement, visibleEvents: TimelineEvent[]): void {
        const shell = root.querySelector('.timeline-shell') as HTMLElement | null;
        const wave = root.querySelector('.timeline-wave') as SVGSVGElement | null;
        if (!shell || !wave) {
            return;
        }

        if (this.isSmallTimelineLayout()) {
            wave.innerHTML = '';
            return;
        }

        this.waveFrame = globalThis.requestAnimationFrame(() => {
            this.waveFrame = null;

            if (!root.isConnected || this.isSmallTimelineLayout()) {
                wave.innerHTML = '';
                return;
            }

            const nodes = Array.from(shell.querySelectorAll<HTMLElement>('.timeline-entry-node'));
            const pointCount = Math.min(nodes.length, visibleEvents.length);
            if (pointCount < 2) {
                wave.innerHTML = '';
                return;
            }

            const shellRect = shell.getBoundingClientRect();
            const firstNodeRect = nodes[0].getBoundingClientRect();
            const centerX = firstNodeRect.left - shellRect.left + firstNodeRect.width / 2;
            const shellWidth = Math.max(1, Math.ceil(shell.clientWidth));
            const shellHeight = Math.max(1, Math.ceil(shell.scrollHeight));

            const points = visibleEvents.slice(0, pointCount).map((event, index) => {
                const nodeRect = nodes[index].getBoundingClientRect();
                return {
                    y: nodeRect.top - shellRect.top + nodeRect.height / 2,
                    metric: this.getWaveMetric(event),
                };
            });

            const normalizedMetrics = points.map(point => Math.sqrt(point.metric));
            const maxMetric = Math.max(...normalizedMetrics, 1);
            const minAmplitude = Math.max(52, Math.min(88, shellWidth * 0.085));
            const maxAmplitude = Math.max(220, Math.min(420, shellWidth * 0.34));
            const wavePoints = points.map((point, index) => ({
                y: point.y,
                amplitude:
                    minAmplitude +
                    (normalizedMetrics[index] / maxMetric) * (maxAmplitude - minAmplitude),
            }));

            const leftSamples = this.buildWaveSamples(wavePoints, shellHeight, minAmplitude);
            const rightSamples = this.buildWaveSamples(wavePoints, shellHeight, minAmplitude);
            const leftBodyPath = this.buildSideWaveAreaPath(leftSamples, centerX, -1, minAmplitude, 1.42, 0.2);
            const rightBodyPath = this.buildSideWaveAreaPath(rightSamples, centerX, 1, minAmplitude, 1.42, 0.2);
            const leftHazePath = this.buildSideWaveAreaPath(leftSamples, centerX, -1, minAmplitude, 1.92, 0.08);
            const rightHazePath = this.buildSideWaveAreaPath(rightSamples, centerX, 1, minAmplitude, 1.92, 0.08);

            wave.setAttribute('viewBox', `0 0 ${shellWidth} ${shellHeight}`);
            wave.innerHTML = `
                <path class="timeline-wave-haze timeline-wave-haze-left" d="${leftHazePath}"></path>
                <path class="timeline-wave-haze timeline-wave-haze-right" d="${rightHazePath}"></path>
                <path class="timeline-wave-body timeline-wave-body-left" d="${leftBodyPath}"></path>
                <path class="timeline-wave-body timeline-wave-body-right" d="${rightBodyPath}"></path>
            `;
        });
    }

    private isSmallTimelineLayout(): boolean {
        if (typeof globalThis.matchMedia !== 'function') {
            return false;
        }

        return globalThis.matchMedia(SMALL_TIMELINE_MEDIA_QUERY).matches;
    }

    private buildWaveSamples(
        points: Array<{ y: number; amplitude: number }>,
        shellHeight: number,
        minAmplitude: number,
    ): Array<{ y: number; amplitude: number }> {
        if (points.length === 0) {
            return [];
        }

        const samples: Array<{ y: number; amplitude: number }> = [];

        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];
            const previousPoint = points[index - 1] ?? null;
            const nextPoint = points[index + 1] ?? null;
            const previousAmplitude = previousPoint?.amplitude ?? point.amplitude;
            const nextAmplitude = nextPoint?.amplitude ?? point.amplitude;
            const crestAmplitude =
                previousAmplitude * 0.22 + point.amplitude * 0.56 + nextAmplitude * 0.22;
            const leadingGap = previousPoint ? point.y - previousPoint.y : 136;
            const trailingGap = nextPoint ? nextPoint.y - point.y : 136;
            const localGap = Math.max(72, Math.min(leadingGap, trailingGap));
            const shoulder = Math.max(34, Math.min(72, localGap * 0.42));
            const troughAmplitude = Math.max(minAmplitude * 0.72, crestAmplitude * 0.74);

            if (index === 0) {
                samples.push({
                    y: Math.max(0, point.y - shoulder * 3.6),
                    amplitude: Math.max(minAmplitude * 0.68, troughAmplitude * 0.92),
                });
            }

            const upperShoulderY = Math.max(0, point.y - shoulder);
            if (samples[samples.length - 1]?.y !== upperShoulderY) {
                samples.push({
                    y: upperShoulderY,
                    amplitude: Math.max(minAmplitude * 0.76, crestAmplitude * 0.84),
                });
            }

            samples.push({
                y: point.y,
                amplitude: crestAmplitude,
            });

            const lowerShoulderY = Math.min(shellHeight, point.y + shoulder);
            samples.push({
                y: lowerShoulderY,
                amplitude: Math.max(minAmplitude * 0.76, crestAmplitude * 0.84),
            });

            if (nextPoint) {
                const midpointY = (point.y + nextPoint.y) / 2;
                const nextCrestAmplitude =
                    point.amplitude * 0.22 + nextAmplitude * 0.56 + (points[index + 2]?.amplitude ?? nextAmplitude) * 0.22;
                samples.push({
                    y: midpointY,
                    amplitude: Math.max(minAmplitude * 0.68, (crestAmplitude + nextCrestAmplitude) * 0.46),
                });
            } else {
                samples.push({
                    y: Math.min(shellHeight, point.y + shoulder * 3.6),
                    amplitude: Math.max(minAmplitude * 0.68, troughAmplitude * 0.92),
                });
            }
        }

        return samples;
    }

    private buildSideWaveAreaPath(
        samples: Array<{ y: number; amplitude: number }>,
        centerX: number,
        direction: -1 | 1,
        minAmplitude: number,
        outerStretch = 1.16,
        innerRatio = 0.18,
    ): string {
        if (samples.length === 0) {
            return '';
        }

        const outerPoints = samples.map(sample => ({
            x: centerX + direction * sample.amplitude * outerStretch,
            y: sample.y,
        }));
        const innerPoints = [...samples]
            .reverse()
            .map(sample => ({
                x: centerX + direction * Math.max(minAmplitude * innerRatio, sample.amplitude * innerRatio),
                y: sample.y,
            }));

        return [
            `M ${outerPoints[0].x} ${outerPoints[0].y}`,
            this.buildSmoothWaveSegments(outerPoints),
            `L ${innerPoints[0].x} ${innerPoints[0].y}`,
            this.buildSmoothWaveSegments(innerPoints),
            'Z',
        ].join(' ');
    }

    private buildSmoothWaveSegments(points: Array<{ x: number; y: number }>): string {
        let path = '';
        for (let index = 1; index < points.length; index += 1) {
            const previousPoint = points[index - 1];
            const currentPoint = points[index];
            const midpointY = (previousPoint.y + currentPoint.y) / 2;
            path += ` C ${previousPoint.x} ${midpointY}, ${currentPoint.x} ${midpointY}, ${currentPoint.x} ${currentPoint.y}`;
        }
        return path;
    }

    private getWaveMetric(event: TimelineEvent): number {
        if (event.kind === 'milestone') {
            if (event.milestoneMinutes > 0) {
                return event.milestoneMinutes;
            }
            if (event.milestoneCharacters > 0) {
                return event.milestoneCharacters / 240;
            }
        }

        if (event.totalMinutes > 0) {
            if (event.kind === 'started') {
                return Math.max(20, Math.min(event.totalMinutes * 0.35, 220));
            }
            return event.totalMinutes;
        }

        if (event.totalCharacters > 0) {
            const scaledCharacters = event.totalCharacters / 240;
            if (event.kind === 'started') {
                return Math.max(20, Math.min(scaledCharacters * 0.35, 220));
            }
            return scaledCharacters;
        }

        return 20;
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
        this.renderToken += 1;
        this.coverVisibility?.disconnect();
        this.coverVisibility = null;
        this.paginationObserver?.disconnect();
        this.paginationObserver = null;
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

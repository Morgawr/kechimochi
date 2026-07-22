import { Component } from '../component';
import { html } from '../html';
import { Media, ActivitySummary, LibrarySnapshot, getLibrarySnapshot, getLogsForMedia, setSetting } from '../api';
import { MediaLibraryBrowser, type LibraryMediaSelection } from './MediaLibraryBrowser';
import { MediaDetail } from './MediaDetail';
import { Logger } from '../logger';
import { SETTING_KEYS, EVENTS, VIEW_NAMES } from '../constants';
import {
    GRID_LAYOUT_MEDIA_QUERY,
    LIBRARY_GRID_ZOOM,
    normalizeLibraryGridZoom,
    type LibraryActivityMetrics,
    type LibraryLayoutMode,
} from './library_types';
import { measureSynchronous } from '../performance';

interface MediaViewState {
    viewMode: 'grid' | 'detail';
    libraryMediaList: Media[];
    detailMediaList: Media[];
    currentLogs: ActivitySummary[];
    currentIndex: number;
    libraryFilters: {
        searchQuery: string;
        typeFilters: string[];
        statusFilters: string[];
        hideArchived: boolean;
    };
    preferredLayout: LibraryLayoutMode;
    gridZoom: number;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, LibraryActivityMetrics>;
    isLoading: boolean;
    isInitialized: boolean;
}

interface RenderedLibraryPresentation {
    mediaList: Media[];
    libraryFilters: MediaViewState['libraryFilters'];
    preferredLayout: LibraryLayoutMode;
    gridZoom: number;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, LibraryActivityMetrics>;
}

interface LegacyMediaQueryListCompat {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
}

export class MediaView extends Component<MediaViewState> {
    private activeSubComponent: Component | null = null;
    private targetMediaId: number | null = null;
    private gridSupportQuery: MediaQueryList | null = null;
    private isDestroyed = false;
    private navigationSource?:  'dashboard' | 'timeline';
    private detailNavigationRequestId = 0;
    private loadRequestId = 0;
    private renderedLibraryPresentation: RenderedLibraryPresentation | null = null;

    constructor(container: HTMLElement) {
        super(container, {
            viewMode: 'grid',
            libraryMediaList: [],
            detailMediaList: [],
            currentLogs: [],
            currentIndex: 0,
            libraryFilters: {
                searchQuery: '',
                typeFilters: [],
                statusFilters: [],
                hideArchived: false,
            },
            preferredLayout: 'grid',
            gridZoom: LIBRARY_GRID_ZOOM.DEFAULT,
            isGridSupported: MediaView.isGridLayoutSupported(),
            listMetricsByMediaId: {},
            isLoading: false,
            isInitialized: false,
        });
    }

    protected onMount() {
        globalThis.addEventListener('keydown', this.keyboardHandler);
        globalThis.addEventListener('mouseup', this.mouseHandler);
        this.bindGridSupportListener();
    }

    public destroy() {
        this.isDestroyed = true;
        if (this.state.isLoading) {
            this.loadRequestId += 1;
        }
        this.detailNavigationRequestId += 1;
        this.activeSubComponent?.destroy?.();
        this.activeSubComponent = null;
        globalThis.removeEventListener('keydown', this.keyboardHandler);
        globalThis.removeEventListener('mouseup', this.mouseHandler);
        this.unbindGridSupportListener();
        super.destroy();
    }

    private static isGridLayoutSupported(): boolean {
        if (typeof globalThis.matchMedia !== 'function') {
            return true;
        }

        return globalThis.matchMedia(GRID_LAYOUT_MEDIA_QUERY).matches;
    }

    private bindGridSupportListener() {
        if (typeof globalThis.matchMedia !== 'function') {
            return;
        }

        this.gridSupportQuery = globalThis.matchMedia(GRID_LAYOUT_MEDIA_QUERY);
        this.updateGridSupport(this.gridSupportQuery.matches);

        if (typeof this.gridSupportQuery.addEventListener === 'function') {
            this.gridSupportQuery.addEventListener('change', this.onGridSupportChange);
            return;
        }

        const legacyQuery = this.gridSupportQuery as unknown as LegacyMediaQueryListCompat;
        legacyQuery.addListener?.(this.onGridSupportChange);
    }

    private unbindGridSupportListener() {
        if (!this.gridSupportQuery) {
            return;
        }

        if (typeof this.gridSupportQuery.removeEventListener === 'function') {
            this.gridSupportQuery.removeEventListener('change', this.onGridSupportChange);
            this.gridSupportQuery = null;
            return;
        }

        const legacyQuery = this.gridSupportQuery as unknown as LegacyMediaQueryListCompat;
        legacyQuery.removeListener?.(this.onGridSupportChange);
        this.gridSupportQuery = null;
    }

    private readonly onGridSupportChange = (event: MediaQueryListEvent) => {
        this.updateGridSupport(event.matches);
    };

    private updateGridSupport(isGridSupported: boolean) {
        if (this.state.isGridSupported === isGridSupported) {
            return;
        }

        this.setState({ isGridSupported });
    }

    private readonly keyboardHandler = (e: KeyboardEvent) => {
        if (!document.getElementById('media-root')) return;
        if (this.state.viewMode !== 'detail') return;

        if (e.target instanceof HTMLElement) {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        }

        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
            this.runAsync(this.navigateDetail(1), 'Failed to navigate to next media');
        } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
            this.runAsync(this.navigateDetail(-1), 'Failed to navigate to previous media');
        } else if (e.key === 'Escape') {
            this.runAsync(this.exitDetail(), 'Failed to exit media detail');
        }
    };

    private readonly mouseHandler = (e: MouseEvent) => {
        if (!document.getElementById('media-root')) return;
        if (e.button === 3 && this.state.viewMode === 'detail') {
            this.runAsync(this.exitDetail(), 'Failed to exit media detail');
            e.preventDefault();
        }
    };

    private runAsync(task: Promise<unknown> | void, message: string) {
        Promise.resolve(task).catch((error) => Logger.error(message, error));
    }

    private async navigateDetail(direction: number) {
        const { detailMediaList, currentIndex } = this.state;
        if (detailMediaList.length === 0) return;

        const nextIndex = (currentIndex + direction + detailMediaList.length) % detailMediaList.length;
        await this.navigateToDetailIndex(nextIndex);
    }

    private async navigateToDetailIndex(nextIndex: number) {
        const media = this.state.detailMediaList[nextIndex];
        if (!media) return;

        const requestId = ++this.detailNavigationRequestId;
        this.setState({ currentIndex: nextIndex, currentLogs: [] });

        await this.loadDetailLogs(media, requestId);
    }

    private async loadDetailLogs(media: Media, requestId: number) {
        if (typeof media.id !== 'number') return;

        try {
            const currentLogs = await getLogsForMedia(media.id);
            if (this.isDestroyed || requestId !== this.detailNavigationRequestId) return;
            this.state.currentLogs = currentLogs;
            if (
                this.activeSubComponent instanceof MediaDetail
                && this.activeSubComponent.updateLogs(media.id, currentLogs)
            ) {
                return;
            }
            this.render();
        } catch (e) {
            Logger.error('Failed to load logs for media detail navigation', e);
            if (!this.isDestroyed && requestId === this.detailNavigationRequestId) {
                this.state.currentLogs = [];
                if (
                    !(this.activeSubComponent instanceof MediaDetail)
                    || !this.activeSubComponent.updateLogs(media.id, [])
                ) {
                    this.render();
                }
            }
        }
    }

    private async openLibraryDetail(selection: LibraryMediaSelection) {
        const mediaById = new Map(
            this.state.libraryMediaList.flatMap((media) => (
                typeof media.id === 'number' ? [[media.id, media] as const] : []
            )),
        );
        const detailMediaList = selection.navigationIds.flatMap((mediaId) => {
            const media = mediaById.get(mediaId);
            return media ? [media] : [];
        });
        const currentIndex = detailMediaList.findIndex((media) => media.id === selection.mediaId);
        if (currentIndex === -1) {
            Logger.warn('Selected media was not present in the visible library navigation context', selection.mediaId);
            return;
        }

        const requestId = ++this.detailNavigationRequestId;
        this.navigationSource = undefined;
        this.setState({
            detailMediaList,
            currentIndex,
            currentLogs: [],
            viewMode: 'detail',
        });
        await this.loadDetailLogs(detailMediaList[currentIndex], requestId);
    }

    private async exitDetail(shouldRefresh: boolean = false) {
        if (shouldRefresh) {
            await this.loadData();
        }
        this.navigationSource = undefined;
        this.setState({
            viewMode: 'grid',
            detailMediaList: [],
            currentLogs: [],
            currentIndex: 0,
        });
    }

private async handleBack() {
        if (this.navigationSource === 'dashboard') {
            this.navigationSource = undefined;

            globalThis.dispatchEvent(new CustomEvent(EVENTS.APP_NAVIGATE, {
                detail: { view: VIEW_NAMES.DASHBOARD }
            }));
        } else {
            await this.exitDetail(false);
        }
    }

    private async handleBackToLibrary() {
        this.navigationSource = undefined;
        await this.exitDetail(false);
    }
    
    public prepareLibraryView(): boolean {
        const requiresRender = this.state.viewMode !== 'grid';
        this.targetMediaId = null;
        this.navigationSource = undefined;
        this.loadRequestId += 1;
        this.detailNavigationRequestId += 1;
        this.state = {
            ...this.state,
            viewMode: 'grid',
            detailMediaList: [],
            currentLogs: [],
            currentIndex: 0,
            isLoading: false,
        };
        return requiresRender;
    }

    public async resetView() {
        const requiresRender = this.prepareLibraryView();
        if (requiresRender || !this.container.querySelector('#media-root')) {
            this.render();
        }
        await this.loadData();
    }

    public async jumpToMedia(mediaId: number, source?: 'dashboard' | 'timeline') {
        this.targetMediaId = mediaId;
        this.navigationSource = source;
        await this.loadData(mediaId);
    }

    private resolveDetailState(mediaList: Media[], jumpToId?: number) {
        const targetId = jumpToId ?? this.targetMediaId;

        if (targetId !== null && targetId !== undefined) {
            this.targetMediaId = null;
            const currentIndex = mediaList.findIndex((media) => media.id === targetId);
            return {
                targetId,
                detailMediaList: currentIndex === -1 ? [] : mediaList,
                currentIndex: Math.max(currentIndex, 0),
            };
        }

        if (this.state.viewMode !== 'detail') {
            return { targetId, detailMediaList: [], currentIndex: 0 };
        }

        const currentMediaId = this.state.detailMediaList[this.state.currentIndex]?.id;
        const mediaById = new Map(
            mediaList.flatMap((media) => (
                typeof media.id === 'number' ? [[media.id, media] as const] : []
            )),
        );
        const detailMediaList = this.state.detailMediaList.flatMap((media) => {
            if (typeof media.id !== 'number') return [];
            const refreshedMedia = mediaById.get(media.id);
            return refreshedMedia ? [refreshedMedia] : [];
        });
        const refreshedIndex = detailMediaList.findIndex((media) => media.id === currentMediaId);
        if (refreshedIndex === -1) {
            return { targetId, detailMediaList: [], currentIndex: 0 };
        }

        return {
            targetId,
            detailMediaList,
            currentIndex: Math.max(refreshedIndex, 0),
        };
    }

    private isStaleLoad(requestId: number): boolean {
        return this.isDestroyed || requestId !== this.loadRequestId;
    }

    private resolveSnapshotPresentation(snapshot: LibrarySnapshot, isInitialLoad: boolean) {
        let libraryFilters = this.state.libraryFilters;
        let preferredLayout = this.state.preferredLayout;
        let gridZoom = this.state.gridZoom;

        if (isInitialLoad) {
            libraryFilters = {
                ...libraryFilters,
                hideArchived: snapshot.settings.hide_archived,
            };
            preferredLayout = snapshot.settings.preferred_layout;
            gridZoom = normalizeLibraryGridZoom(snapshot.settings.grid_zoom);
        }

        const availableTypes = new Set(
            snapshot.media.map((media) => (media.content_type || 'Unknown').trim() || 'Unknown'),
        );
        libraryFilters = {
            ...libraryFilters,
            typeFilters: libraryFilters.typeFilters.filter((type) => availableTypes.has(type)),
        };

        return { libraryFilters, preferredLayout, gridZoom };
    }

    private projectSnapshotMetrics(snapshot: LibrarySnapshot): Record<number, LibraryActivityMetrics> {
        return measureSynchronous(
            'aggregation',
            'library_metrics_projection',
            () => snapshot.metrics.reduce<Record<number, LibraryActivityMetrics>>((metrics, value) => {
                metrics[value.media_id] = {
                    firstActivityDate: value.first_activity_date,
                    lastActivityDate: value.last_activity_date,
                    totalMinutes: value.total_minutes,
                };
                return metrics;
            }, {}),
            { media_count: snapshot.media.length, metric_count: snapshot.metrics.length },
        );
    }

    private async buildSnapshotState(
        snapshot: LibrarySnapshot,
        requestId: number,
        isInitialLoad: boolean,
        jumpToId?: number,
    ): Promise<Partial<MediaViewState> | null> {
        const { libraryFilters, preferredLayout, gridZoom } = this.resolveSnapshotPresentation(
            snapshot,
            isInitialLoad,
        );
        const listMetricsByMediaId = this.projectSnapshotMetrics(snapshot);
        const { targetId, detailMediaList, currentIndex } = this.resolveDetailState(snapshot.media, jumpToId);
        const requestedViewMode = targetId !== null && targetId !== undefined ? 'detail' : this.state.viewMode;
        const viewMode: MediaViewState['viewMode'] = requestedViewMode === 'detail' && detailMediaList.length > 0
            ? 'detail'
            : 'grid';
        let currentLogs: ActivitySummary[] = [];

        if (viewMode === 'detail' && detailMediaList[currentIndex]) {
            currentLogs = await getLogsForMedia(detailMediaList[currentIndex].id!);
            if (this.isStaleLoad(requestId)) return null;
        }

        return {
            libraryMediaList: snapshot.media,
            detailMediaList,
            currentLogs,
            currentIndex,
            libraryFilters,
            preferredLayout,
            gridZoom,
            isGridSupported: MediaView.isGridLayoutSupported(),
            listMetricsByMediaId,
            isLoading: false,
            isInitialized: true,
            viewMode,
        };
    }

    private handleLoadError(error: unknown, requestId: number, isInitialLoad: boolean): void {
        if (this.isStaleLoad(requestId)) return;
        Logger.error('Failed to load media view content', error);
        if (isInitialLoad) {
            this.setState({ isLoading: false, isInitialized: true });
            return;
        }
        this.state.isLoading = false;
    }

    private canReuseRenderedLibrary(nextState: Partial<MediaViewState>): boolean {
        const rendered = this.renderedLibraryPresentation;
        if (
            !rendered
            || !this.activeSubComponent
            || this.state.viewMode !== 'grid'
            || nextState.viewMode !== 'grid'
        ) {
            return false;
        }

        const nextFilters = nextState.libraryFilters;
        const nextMedia = nextState.libraryMediaList;
        const nextMetrics = nextState.listMetricsByMediaId;
        return Boolean(
            nextFilters
            && nextMedia
            && nextMetrics
            && this.areFiltersEqual(rendered.libraryFilters, nextFilters)
            && rendered.preferredLayout === nextState.preferredLayout
            && rendered.gridZoom === nextState.gridZoom
            && rendered.isGridSupported === nextState.isGridSupported
            && this.areMediaListsEqual(rendered.mediaList, nextMedia)
            && this.areMetricMapsEqual(rendered.listMetricsByMediaId, nextMetrics)
        );
    }

    private areFiltersEqual(
        left: MediaViewState['libraryFilters'],
        right: MediaViewState['libraryFilters'],
    ): boolean {
        return left.searchQuery === right.searchQuery
            && left.hideArchived === right.hideArchived
            && this.areStringArraysEqual(left.typeFilters, right.typeFilters)
            && this.areStringArraysEqual(left.statusFilters, right.statusFilters);
    }

    private areStringArraysEqual(left: string[], right: string[]): boolean {
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    private areMediaListsEqual(left: Media[], right: Media[]): boolean {
        if (left.length !== right.length) return false;
        return left.every((media, index) => {
            const other = right[index];
            return media.id === other.id
                && media.uid === other.uid
                && media.title === other.title
                && media.variant === other.variant
                && media.default_activity_type === other.default_activity_type
                && media.status === other.status
                && media.language === other.language
                && media.description === other.description
                && media.cover_image === other.cover_image
                && media.extra_data === other.extra_data
                && media.content_type === other.content_type
                && media.tracking_status === other.tracking_status;
        });
    }

    private areMetricMapsEqual(
        left: Record<number, LibraryActivityMetrics>,
        right: Record<number, LibraryActivityMetrics>,
    ): boolean {
        const leftIds = Object.keys(left);
        const rightIds = Object.keys(right);
        if (leftIds.length !== rightIds.length) return false;
        return leftIds.every((id) => {
            const leftMetric = left[Number(id)];
            const rightMetric = right[Number(id)];
            return leftMetric.firstActivityDate === rightMetric?.firstActivityDate
                && leftMetric.lastActivityDate === rightMetric?.lastActivityDate
                && leftMetric.totalMinutes === rightMetric?.totalMinutes;
        });
    }

    private captureRenderedLibraryPresentation(): void {
        this.renderedLibraryPresentation = {
            mediaList: this.state.libraryMediaList,
            libraryFilters: {
                ...this.state.libraryFilters,
                typeFilters: [...this.state.libraryFilters.typeFilters],
                statusFilters: [...this.state.libraryFilters.statusFilters],
            },
            preferredLayout: this.state.preferredLayout,
            gridZoom: this.state.gridZoom,
            isGridSupported: this.state.isGridSupported,
            listMetricsByMediaId: this.state.listMetricsByMediaId,
        };
    }

    private markLibraryRequest(requestId: number): void {
        const root = this.container.querySelector<HTMLElement>('#media-root');
        if (root) root.dataset.libraryRequestId = requestId.toString();
    }

    async loadData(jumpToId?: number) {
        if (this.state.isLoading && jumpToId === undefined) return;
        const requestId = ++this.loadRequestId;
        const isInitialLoad = !this.state.isInitialized;
        this.detailNavigationRequestId += 1;
        if (isInitialLoad) {
            this.state.isLoading = true;
            if (!this.container.querySelector('#media-root')) {
                this.render();
            }
        } else {
            this.state.isLoading = true;
        }

        try {
            const snapshot = await getLibrarySnapshot({ request_id: requestId });
            if (this.isStaleLoad(requestId) || snapshot.request_id !== requestId) return;
            const nextState = await this.buildSnapshotState(snapshot, requestId, isInitialLoad, jumpToId);
            if (!nextState) return;
            if (this.canReuseRenderedLibrary(nextState)) {
                this.state = { ...this.state, ...nextState };
            } else {
                this.setState(nextState);
            }
            this.markLibraryRequest(requestId);
        } catch (e) {
            this.handleLoadError(e, requestId, isInitialLoad);
        }
    }

    render() {
        this.activeSubComponent?.destroy?.();
        this.activeSubComponent = null;
        this.renderedLibraryPresentation = null;
        this.clear();
        const root = html`<div style="display: flex; flex-direction: column; height: 100%; gap: 1rem;" id="media-root"></div>`;
        this.container.appendChild(root);

        if (!this.state.isInitialized || this.state.isLoading) {
            root.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.7;">
                    <div style="width: 40px; height: 40px; border: 3px solid var(--border-color); border-top-color: var(--accent-green); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem;"></div>
                    <div style="font-size: 0.9rem; letter-spacing: 0.5px;">Initializing Library...</div>
                </div>
                <style>
                    @keyframes spin { to { transform: rotate(360deg); } }
                </style>
            `;
            return;
        }

        if (this.state.viewMode === 'grid') {
            this.renderBrowser(root);
        } else {
            this.renderDetail(root);
        }
    }

    private renderBrowser(root: HTMLElement) {
        this.activeSubComponent = new MediaLibraryBrowser(
            root,
            {
                mediaList: this.state.libraryMediaList,
                ...this.state.libraryFilters,
                preferredLayout: this.state.preferredLayout,
                gridZoom: this.state.gridZoom,
                isGridSupported: this.state.isGridSupported,
                listMetricsByMediaId: this.state.listMetricsByMediaId,
                isListMetricsLoading: false,
            },
            (selection) => {
                this.openLibraryDetail(selection).catch((err) => Logger.error('Failed to load media detail', err));
            },
            async (jumpToId) => {
                await this.loadData(jumpToId).catch((err) => Logger.error('Failed to jump to media', err));
            },
            (filters) => {
                const oldHideArchived = this.state.libraryFilters.hideArchived;
                this.state.libraryFilters = { ...this.state.libraryFilters, ...filters };
                this.captureRenderedLibraryPresentation();
                if (filters.hideArchived !== undefined && oldHideArchived !== filters.hideArchived) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED, filters.hideArchived.toString()),
                        'Failed to persist hide archived preference',
                    );
                }
            },
            (layout) => {
                this.state.preferredLayout = layout;
                this.captureRenderedLibraryPresentation();
                this.runAsync(
                    setSetting(SETTING_KEYS.LIBRARY_LAYOUT_MODE, layout),
                    'Failed to persist library layout preference',
                );
            },
            (gridZoom) => {
                this.state.gridZoom = gridZoom;
                this.captureRenderedLibraryPresentation();
                this.runAsync(
                    setSetting(SETTING_KEYS.LIBRARY_GRID_ZOOM, gridZoom.toString()),
                    'Failed to persist library grid zoom',
                );
            },
        );
        this.activeSubComponent.render();
        this.captureRenderedLibraryPresentation();
    }

    private renderDetail(root: HTMLElement) {
        const media = this.state.detailMediaList[this.state.currentIndex];
        if (!media) {
            this.setState({ viewMode: 'grid' });
            return;
        }

        this.activeSubComponent = new MediaDetail(
            root,
            media,
            this.state.currentLogs,
            this.state.detailMediaList,
            this.state.currentIndex,
            {
                onBack: () => { this.runAsync(this.handleBack(), 'Failed to handle back navigation'); },
                onBackToLibrary: () => { this.runAsync(this.handleBackToLibrary(), 'Failed to navigate back to library'); },
                onNext: () => { this.runAsync(this.navigateDetail(1), 'Failed to navigate to next media'); },
                onPrev: () => { this.runAsync(this.navigateDetail(-1), 'Failed to navigate to previous media'); },
                onNavigate: (index) => { this.runAsync(this.navigateToDetailIndex(index), 'Failed to navigate to selected media'); },
                onDelete: () => { this.runAsync(this.exitDetail(true), 'Failed to refresh library after delete'); },
            },
        );
        this.activeSubComponent.render();
    }
}

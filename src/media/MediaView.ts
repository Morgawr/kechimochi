import { Component } from '../component';
import { html } from '../html';
import { Media, ActivitySummary, LibraryActivityMetricsRow, getAllMedia, getLibraryActivityMetrics, getLogsForMedia, getSetting, setSetting } from '../api';
import { MediaLibraryBrowser } from './MediaLibraryBrowser';
import { MediaDetail } from './MediaDetail';
import { Logger } from '../logger';
import { SETTING_KEYS, EVENTS, VIEW_NAMES, CONTENT_TYPES, TRACKING_STATUSES } from '../constants';
import { GRID_LAYOUT_MEDIA_QUERY, type LibraryActivityMetrics, type LibraryLayoutMode } from './library_types';
import { resolveDisplayContentType } from './content_type';
import {
    buildExtraDataIndex,
    getUniqueExtraFieldNames,
    parseLibrarySortStages,
    serializeLibrarySortStages,
    reconcileEnumOrder,
    type LibraryBuiltinSortKey,
    type LibrarySortStage,
} from './sorting';

const METRICS_DEPENDENT_SORT_KEYS: ReadonlySet<LibraryBuiltinSortKey> = new Set([
    'lastActivity', 'firstActivity', 'timeLogged', 'totalCharacters',
]);

function sortStagesNeedMetrics(stages: LibrarySortStage[]): boolean {
    return stages.some((stage) => stage.field.kind === 'builtin' && METRICS_DEPENDENT_SORT_KEYS.has(stage.field.key));
}

interface MediaViewLibraryFilters {
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
    sortStages: LibrarySortStage[];
    groupByType: boolean;
    keepOngoingFirst: boolean;
    keepArchivedLast: boolean;
}

interface MediaViewState {
    viewMode: 'grid' | 'detail';
    currentMediaList: Media[];
    currentLogs: ActivitySummary[];
    currentIndex: number;
    libraryFilters: MediaViewLibraryFilters;
    contentTypeOrder: string[];
    trackingStatusOrder: string[];
    preferredLayout: LibraryLayoutMode;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, LibraryActivityMetrics>;
    isListMetricsLoaded: boolean;
    isListMetricsLoading: boolean;
    isLoading: boolean;
    isInitialized: boolean;
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

    constructor(container: HTMLElement) {
        super(container, {
            viewMode: 'grid',
            currentMediaList: [],
            currentLogs: [],
            currentIndex: 0,
            libraryFilters: {
                searchQuery: '',
                typeFilters: [],
                statusFilters: [],
                hideArchived: false,
                sortStages: [],
                groupByType: false,
                keepOngoingFirst: true,
                keepArchivedLast: true,
            },
            contentTypeOrder: [...CONTENT_TYPES],
            trackingStatusOrder: [...TRACKING_STATUSES],
            preferredLayout: 'grid',
            isGridSupported: MediaView.isGridLayoutSupported(),
            listMetricsByMediaId: {},
            isListMetricsLoaded: false,
            isListMetricsLoading: false,
            isLoading: false,
            isInitialized: false,
        });
    }

    protected onMount() {
        globalThis.addEventListener('keydown', this.keyboardHandler);
        globalThis.addEventListener('mouseup', this.mouseHandler);
        globalThis.addEventListener(EVENTS.LIBRARY_PREFERENCES_CHANGED, this.libraryPreferencesHandler);
        this.bindGridSupportListener();
    }

    public destroy() {
        this.isDestroyed = true;
        globalThis.removeEventListener('keydown', this.keyboardHandler);
        globalThis.removeEventListener('mouseup', this.mouseHandler);
        globalThis.removeEventListener(EVENTS.LIBRARY_PREFERENCES_CHANGED, this.libraryPreferencesHandler);
        this.unbindGridSupportListener();
        super.destroy();
    }

    private async reloadLibraryEnumOrders() {
        const [contentTypeOrderStr, trackingStatusOrderStr] = await Promise.all([
            getSetting(SETTING_KEYS.CONTENT_TYPE_ORDER),
            getSetting(SETTING_KEYS.TRACKING_STATUS_ORDER),
        ]);
        if (this.isDestroyed) return;

        this.setState({
            contentTypeOrder: reconcileEnumOrder(contentTypeOrderStr, CONTENT_TYPES),
            trackingStatusOrder: reconcileEnumOrder(trackingStatusOrderStr, TRACKING_STATUSES),
        });
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

    private readonly libraryPreferencesHandler = () => {
        if (!this.state.isInitialized) return;
        this.runAsync(this.reloadLibraryEnumOrders(), 'Failed to reload library ordering preferences');
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

    private getEffectiveLayout(): LibraryLayoutMode {
        return this.state.isGridSupported ? this.state.preferredLayout : 'list';
    }

    private async navigateDetail(direction: number) {
        const { currentMediaList, currentIndex } = this.state;
        if (currentMediaList.length === 0) return;

        const nextIndex = (currentIndex + direction + currentMediaList.length) % currentMediaList.length;
        await this.navigateToDetailIndex(nextIndex);
    }

    private async navigateToDetailIndex(nextIndex: number) {
        const media = this.state.currentMediaList[nextIndex];
        if (!media) return;

        const requestId = ++this.detailNavigationRequestId;
        this.setState({ currentIndex: nextIndex, currentLogs: [] });

        if (typeof media.id !== 'number') return;

        try {
            const currentLogs = await getLogsForMedia(media.id);
            if (this.isDestroyed || requestId !== this.detailNavigationRequestId) return;
            this.setState({ currentLogs });
        } catch (e) {
            Logger.error('Failed to load logs for media detail navigation', e);
            if (!this.isDestroyed && requestId === this.detailNavigationRequestId) {
                this.setState({ currentLogs: [] });
            }
        }
    }

    private async exitDetail(shouldRefresh: boolean = false) {
        if (shouldRefresh) {
            await this.loadData();
        }
        this.navigationSource = undefined;
        this.setState({ viewMode: 'grid' });
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
    
    public async resetView() {
        this.setState({ viewMode: 'grid' });
        await this.loadData();
    }

    public async jumpToMedia(mediaId: number, source?: 'dashboard' | 'timeline') {
        this.targetMediaId = mediaId;
        this.navigationSource = source;
        await this.loadData(mediaId);
    }

    private mapMetricsRows(rows: LibraryActivityMetricsRow[]): Record<number, LibraryActivityMetrics> {
        return rows.reduce<Record<number, LibraryActivityMetrics>>((acc, row) => {
            acc[row.media_id] = {
                firstActivityDate: row.first_activity_date,
                lastActivityDate: row.last_activity_date,
                totalMinutes: row.total_minutes,
                totalCharacters: row.total_characters,
            };
            return acc;
        }, {});
    }

    private async resolveMetricsRows(): Promise<Record<number, LibraryActivityMetrics>> {
        try {
            return this.mapMetricsRows(await getLibraryActivityMetrics());
        } catch (e) {
            Logger.error('Failed to load list activity metrics', e);
            return {};
        }
    }

    private async ensureListMetricsLoaded() {
        if (this.state.viewMode !== 'grid') return;
        if (this.getEffectiveLayout() !== 'list') return;
        if (this.state.isListMetricsLoaded || this.state.isListMetricsLoading) return;

        this.setState({ isListMetricsLoading: true });
        const listMetricsByMediaId = await this.resolveMetricsRows();
        if (this.isDestroyed) return;

        this.setState({
            listMetricsByMediaId,
            isListMetricsLoaded: true,
            isListMetricsLoading: false,
        });
    }

    private async loadInitialPreferences() {
        let nextFilters = this.state.libraryFilters;
        let nextPreferredLayout = this.state.preferredLayout;
        let nextContentTypeOrder = this.state.contentTypeOrder;
        let nextTrackingStatusOrder = this.state.trackingStatusOrder;

        if (this.state.isInitialized) {
            return { nextFilters, nextPreferredLayout, nextContentTypeOrder, nextTrackingStatusOrder };
        }

        const [
            hideArchivedStr,
            storedLayout,
            sortStagesStr,
            groupByTypeStr,
            keepOngoingFirstStr,
            keepArchivedLastStr,
            contentTypeOrderStr,
            trackingStatusOrderStr,
        ] = await Promise.all([
            getSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED),
            getSetting(SETTING_KEYS.LIBRARY_LAYOUT_MODE),
            getSetting(SETTING_KEYS.LIBRARY_SORT_STAGES),
            getSetting(SETTING_KEYS.LIBRARY_GROUP_BY_TYPE),
            getSetting(SETTING_KEYS.LIBRARY_KEEP_ONGOING_FIRST),
            getSetting(SETTING_KEYS.LIBRARY_KEEP_ARCHIVED_LAST),
            getSetting(SETTING_KEYS.CONTENT_TYPE_ORDER),
            getSetting(SETTING_KEYS.TRACKING_STATUS_ORDER),
        ]);

        if (storedLayout === 'grid' || storedLayout === 'list') {
            nextPreferredLayout = storedLayout;
        }

        nextFilters = {
            ...nextFilters,
            hideArchived: hideArchivedStr != null ? hideArchivedStr === 'true' : nextFilters.hideArchived,
            // Validated with the real extra-field names once the media list is available (loadData).
            sortStages: parseLibrarySortStages(sortStagesStr ?? '[]', []),
            groupByType: groupByTypeStr != null ? groupByTypeStr === 'true' : nextFilters.groupByType,
            keepOngoingFirst: keepOngoingFirstStr != null ? keepOngoingFirstStr === 'true' : nextFilters.keepOngoingFirst,
            keepArchivedLast: keepArchivedLastStr != null ? keepArchivedLastStr === 'true' : nextFilters.keepArchivedLast,
        };

        nextContentTypeOrder = reconcileEnumOrder(contentTypeOrderStr, CONTENT_TYPES);
        nextTrackingStatusOrder = reconcileEnumOrder(trackingStatusOrderStr, TRACKING_STATUSES);

        return { nextFilters, nextPreferredLayout, nextContentTypeOrder, nextTrackingStatusOrder };
    }

    private resolveSelectedMedia(mediaList: Media[], jumpToId?: number) {
        const targetId = jumpToId ?? this.targetMediaId;
        let finalNextIndex = this.state.currentIndex;

        if (targetId !== null && targetId !== undefined) {
            const idx = mediaList.findIndex((media) => media.id === targetId);
            if (idx !== -1) {
                finalNextIndex = idx;
            }
            this.targetMediaId = null;
        }

        return { targetId, finalNextIndex };
    }

    async loadData(jumpToId?: number) {
        if (this.state.isLoading && jumpToId === undefined) return;
        this.setState({ isLoading: true });

        try {
            const initialPreferences = await this.loadInitialPreferences();
            let nextFilters = initialPreferences.nextFilters;
            const nextPreferredLayout = initialPreferences.nextPreferredLayout;
            const nextContentTypeOrder = initialPreferences.nextContentTypeOrder;
            const nextTrackingStatusOrder = initialPreferences.nextTrackingStatusOrder;

            // Metrics are bounded by logged-media count (post step-5), so firing them alongside
            // getAllMedia costs ~0 wall clock; only await below when the active sort needs them.
            const sortNeedsMetrics = sortStagesNeedMetrics(nextFilters.sortStages);
            const mediaListPromise = getAllMedia();
            const metricsPromise = this.resolveMetricsRows();

            const mediaList = await mediaListPromise;
            const availableTypes = new Set(mediaList.map((media) => resolveDisplayContentType(media)));
            const extraFieldNames = getUniqueExtraFieldNames(buildExtraDataIndex(mediaList));
            nextFilters = {
                ...nextFilters,
                typeFilters: nextFilters.typeFilters.filter((type) => availableTypes.has(type)),
                sortStages: parseLibrarySortStages(serializeLibrarySortStages(nextFilters.sortStages), extraFieldNames),
            };

            let currentLogs: ActivitySummary[] = [];
            const { targetId, finalNextIndex } = this.resolveSelectedMedia(mediaList, jumpToId);

            const viewMode = targetId !== null && targetId !== undefined ? 'detail' : this.state.viewMode;
            if (viewMode === 'detail' && mediaList[finalNextIndex]) {
                currentLogs = await getLogsForMedia(mediaList[finalNextIndex].id!);
            }

            // Seeded from current state so a reload keeps showing the metrics it already has
            // until the fresh ones land, instead of flashing stat-less rows for a microtask.
            let listMetricsByMediaId = this.state.listMetricsByMediaId;
            let isListMetricsLoaded = this.state.isListMetricsLoaded;
            if (sortNeedsMetrics) {
                listMetricsByMediaId = await metricsPromise;
                isListMetricsLoaded = true;
            } else {
                this.runAsync(
                    metricsPromise.then((backgroundMetricsByMediaId) => {
                        if (this.isDestroyed) return;
                        this.setState({
                            listMetricsByMediaId: backgroundMetricsByMediaId,
                            isListMetricsLoaded: true,
                            isListMetricsLoading: false,
                        });
                    }),
                    'Failed to load list activity metrics',
                );
            }

            this.setState({
                currentMediaList: mediaList,
                currentLogs,
                currentIndex: finalNextIndex,
                libraryFilters: nextFilters,
                contentTypeOrder: nextContentTypeOrder,
                trackingStatusOrder: nextTrackingStatusOrder,
                preferredLayout: nextPreferredLayout,
                isGridSupported: MediaView.isGridLayoutSupported(),
                listMetricsByMediaId,
                isListMetricsLoaded,
                isListMetricsLoading: !sortNeedsMetrics,
                isLoading: false,
                isInitialized: true,
                viewMode,
            });
        } catch (e) {
            Logger.error('Failed to load media view content', e);
        } finally {
            if (!this.isDestroyed) {
                this.setState({ isLoading: false });
            }
        }
    }

    render() {
        if (!this.state.isInitialized && !this.state.isLoading && !this.targetMediaId) {
            this.loadData().catch((err) => Logger.error('Failed to load data in render', err));
            return;
        }

        if (this.state.viewMode === 'grid' && this.getEffectiveLayout() === 'list' && !this.state.isListMetricsLoaded && !this.state.isListMetricsLoading) {
            this.runAsync(this.ensureListMetricsLoaded(), 'Failed to load list activity metrics');
        }

        this.clear();
        const root = html`<div class="animate-fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 1rem;" id="media-root"></div>`;
        this.container.appendChild(root);

        if (this.state.isLoading) {
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

        this.activeSubComponent?.destroy?.();

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
                mediaList: this.state.currentMediaList,
                ...this.state.libraryFilters,
                contentTypeOrder: this.state.contentTypeOrder,
                trackingStatusOrder: this.state.trackingStatusOrder,
                preferredLayout: this.state.preferredLayout,
                isGridSupported: this.state.isGridSupported,
                listMetricsByMediaId: this.state.listMetricsByMediaId,
                isListMetricsLoading: this.state.isListMetricsLoading,
            },
            (id) => {
                this.loadData(id).catch((err) => Logger.error('Failed to load media detail', err));
            },
            async (jumpToId) => {
                await this.loadData(jumpToId).catch((err) => Logger.error('Failed to jump to media', err));
            },
            (filters) => {
                const oldFilters = this.state.libraryFilters;
                this.state.libraryFilters = { ...oldFilters, ...filters };

                if (filters.hideArchived !== undefined && oldFilters.hideArchived !== filters.hideArchived) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED, filters.hideArchived.toString()),
                        'Failed to persist hide archived preference',
                    );
                }

                if (filters.sortStages !== undefined) {
                    const serializedSortStages = serializeLibrarySortStages(filters.sortStages);
                    if (serializedSortStages !== serializeLibrarySortStages(oldFilters.sortStages)) {
                        this.runAsync(
                            setSetting(SETTING_KEYS.LIBRARY_SORT_STAGES, serializedSortStages),
                            'Failed to persist library sort stages preference',
                        );
                    }
                }

                if (filters.groupByType !== undefined && oldFilters.groupByType !== filters.groupByType) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.LIBRARY_GROUP_BY_TYPE, filters.groupByType.toString()),
                        'Failed to persist group by type preference',
                    );
                }

                if (filters.keepOngoingFirst !== undefined && oldFilters.keepOngoingFirst !== filters.keepOngoingFirst) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.LIBRARY_KEEP_ONGOING_FIRST, filters.keepOngoingFirst.toString()),
                        'Failed to persist keep ongoing first preference',
                    );
                }

                if (filters.keepArchivedLast !== undefined && oldFilters.keepArchivedLast !== filters.keepArchivedLast) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.LIBRARY_KEEP_ARCHIVED_LAST, filters.keepArchivedLast.toString()),
                        'Failed to persist keep archived last preference',
                    );
                }
            },
            (layout) => {
                this.setState({ preferredLayout: layout });
                this.runAsync(
                    setSetting(SETTING_KEYS.LIBRARY_LAYOUT_MODE, layout),
                    'Failed to persist library layout preference',
                );
            },
        );
        this.activeSubComponent.render();
    }

    private renderDetail(root: HTMLElement) {
        const media = this.state.currentMediaList[this.state.currentIndex];
        if (!media) {
            this.setState({ viewMode: 'grid' });
            return;
        }

        this.activeSubComponent = new MediaDetail(
            root,
            media,
            this.state.currentLogs,
            this.state.currentMediaList,
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

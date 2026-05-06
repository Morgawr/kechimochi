import { Component } from '../component';
import { html } from '../html';
import { Media, ActivitySummary, getAllMedia, getLogs, getLogsForMedia, getSetting, setSetting } from '../api';
import { MediaLibraryBrowser } from './MediaLibraryBrowser';
import { MediaDetail } from './MediaDetail';
import { Logger } from '../logger';
import { SETTING_KEYS } from '../constants';
import { GRID_LAYOUT_MEDIA_QUERY, type LibraryActivityMetrics, type LibraryLayoutMode } from './library_types';

interface MediaViewState {
    viewMode: 'grid' | 'detail';
    currentMediaList: Media[];
    currentLogs: ActivitySummary[];
    currentIndex: number;
    libraryFilters: {
        searchQuery: string;
        typeFilters: string[];
        statusFilters: string[];
        hideArchived: boolean;
    };
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
            },
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
        this.bindGridSupportListener();
    }

    public destroy() {
        this.isDestroyed = true;
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

    private getEffectiveLayout(): LibraryLayoutMode {
        return this.state.isGridSupported ? this.state.preferredLayout : 'list';
    }

    private async navigateDetail(direction: number) {
        const { currentMediaList, currentIndex } = this.state;
        if (currentMediaList.length === 0) return;

        const nextIndex = (currentIndex + direction + currentMediaList.length) % currentMediaList.length;
        this.setState({ currentIndex: nextIndex });
    }

    private async exitDetail(shouldRefresh: boolean = false) {
        if (shouldRefresh) {
            await this.loadData();
        }
        this.setState({ viewMode: 'grid' });
    }

    public async resetView() {
        this.setState({ viewMode: 'grid' });
        await this.loadData();
    }

    public async jumpToMedia(mediaId: number) {
        this.targetMediaId = mediaId;
        await this.loadData(mediaId);
    }

    private async ensureListMetricsLoaded() {
        if (this.state.viewMode !== 'grid') return;
        if (this.getEffectiveLayout() !== 'list') return;
        if (this.state.isListMetricsLoaded || this.state.isListMetricsLoading) return;

        this.setState({ isListMetricsLoading: true });
        try {
            const logs = await getLogs();
            const metricsByMediaId = this.aggregateListMetrics(logs);
            if (this.isDestroyed) return;

            this.setState({
                listMetricsByMediaId: metricsByMediaId,
                isListMetricsLoaded: true,
                isListMetricsLoading: false,
            });
        } catch (e) {
            Logger.error('Failed to load list activity metrics', e);
            if (!this.isDestroyed) {
                this.setState({
                    listMetricsByMediaId: {},
                    isListMetricsLoaded: true,
                    isListMetricsLoading: false,
                });
            }
        }
    }

    private aggregateListMetrics(logs: ActivitySummary[]): Record<number, LibraryActivityMetrics> {
        return logs.reduce<Record<number, LibraryActivityMetrics>>((acc, log) => {
            const current = acc[log.media_id] ?? {
                firstActivityDate: null,
                lastActivityDate: null,
                totalMinutes: 0,
            };

            const firstActivityDate = current.firstActivityDate === null || log.date < current.firstActivityDate
                ? log.date
                : current.firstActivityDate;
            const lastActivityDate = current.lastActivityDate === null || log.date > current.lastActivityDate
                ? log.date
                : current.lastActivityDate;

            acc[log.media_id] = {
                firstActivityDate,
                lastActivityDate,
                totalMinutes: current.totalMinutes + log.duration_minutes,
            };
            return acc;
        }, {});
    }

    private async loadInitialPreferences() {
        let nextFilters = this.state.libraryFilters;
        let nextPreferredLayout = this.state.preferredLayout;

        if (this.state.isInitialized) {
            return { nextFilters, nextPreferredLayout };
        }

        const [hideArchivedStr, storedLayout] = await Promise.all([
            getSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED),
            getSetting(SETTING_KEYS.LIBRARY_LAYOUT_MODE),
        ]);

        if (hideArchivedStr != null) {
            nextFilters = {
                ...nextFilters,
                hideArchived: hideArchivedStr === 'true',
            };
        }

        if (storedLayout === 'grid' || storedLayout === 'list') {
            nextPreferredLayout = storedLayout;
        }

        return { nextFilters, nextPreferredLayout };
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

            const mediaList = await getAllMedia();
            const availableTypes = new Set(mediaList.map((media) => (media.content_type || 'Unknown').trim() || 'Unknown'));
            nextFilters = {
                ...nextFilters,
                typeFilters: nextFilters.typeFilters.filter((type) => availableTypes.has(type)),
            };

            let currentLogs: ActivitySummary[] = [];
            const { targetId, finalNextIndex } = this.resolveSelectedMedia(mediaList, jumpToId);

            const viewMode = targetId !== null && targetId !== undefined ? 'detail' : this.state.viewMode;
            if (viewMode === 'detail' && mediaList[finalNextIndex]) {
                currentLogs = await getLogsForMedia(mediaList[finalNextIndex].id!);
            }

            this.setState({
                currentMediaList: mediaList,
                currentLogs,
                currentIndex: finalNextIndex,
                libraryFilters: nextFilters,
                preferredLayout: nextPreferredLayout,
                isGridSupported: MediaView.isGridLayoutSupported(),
                listMetricsByMediaId: {},
                isListMetricsLoaded: false,
                isListMetricsLoading: false,
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
                const oldHideArchived = this.state.libraryFilters.hideArchived;
                this.state.libraryFilters = { ...this.state.libraryFilters, ...filters };
                if (filters.hideArchived !== undefined && oldHideArchived !== filters.hideArchived) {
                    this.runAsync(
                        setSetting(SETTING_KEYS.GRID_HIDE_ARCHIVED, filters.hideArchived.toString()),
                        'Failed to persist hide archived preference',
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
                onBack: () => { this.runAsync(this.exitDetail(), 'Failed to exit media detail'); },
                onNext: () => { this.runAsync(this.navigateDetail(1), 'Failed to navigate to next media'); },
                onPrev: () => { this.runAsync(this.navigateDetail(-1), 'Failed to navigate to previous media'); },
                onNavigate: (index) => this.setState({ currentIndex: index }),
                onDelete: () => { this.runAsync(this.exitDetail(true), 'Failed to refresh library after delete'); },
            },
        );
        this.activeSubComponent.render();
    }
}

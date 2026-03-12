import { Component } from '../core/component';
import { html } from '../core/html';
import { Media, ActivitySummary, getAllMedia, getLogsForMedia, getSetting, setSetting } from '../api';
import { MediaGrid, MediaFilters } from './media/MediaGrid';
import { MediaDetail } from './media/MediaDetail';
import { Logger } from '../core/logger';

interface MediaViewState {
    viewMode: 'grid' | 'detail';
    currentMediaList: Media[];
    currentLogs: ActivitySummary[];
    currentIndex: number;
    gridFilters: {
        searchQuery: string;
        typeFilter: string;
        statusFilter: string;
        hideArchived: boolean;
    },
    isLoading: boolean;
    isInitialized: boolean;
}

export class MediaView extends Component<MediaViewState> {
    private activeSubComponent: Component | null = null;
    private targetMediaId: number | null = null;

    constructor(container: HTMLElement) {
        super(container, {
            viewMode: 'grid',
            currentMediaList: [],
            currentLogs: [],
            currentIndex: 0,
            gridFilters: {
                searchQuery: '',
                typeFilter: 'All',
                statusFilter: 'All',
                hideArchived: false
            },
            isLoading: false,
            isInitialized: false
        });
    }

    protected onMount() {
        globalThis.addEventListener('keydown', this.keyboardHandler);
        globalThis.addEventListener('mouseup', this.mouseHandler);
        this.loadData().catch(e => Logger.error("Failed to load data", e));
    }

    public destroy() {
        globalThis.removeEventListener('keydown', this.keyboardHandler);
        globalThis.removeEventListener('mouseup', this.mouseHandler);
        super.destroy();
    }

    private readonly keyboardHandler = (e: KeyboardEvent) => {
        if (!document.getElementById('media-root')) return;
        if (this.state.viewMode !== 'detail') return;

        if (e.target instanceof HTMLElement) {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        }

        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
            this.navigateDetail(1);
        } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
            this.navigateDetail(-1);
        } else if (e.key === 'Escape') {
            this.exitDetail();
        }
    }

    private readonly mouseHandler = (e: MouseEvent) => {
        if (!document.getElementById('media-root')) return;
        if (e.button === 3 && this.state.viewMode === 'detail') {
            this.exitDetail();
            e.preventDefault();
        }
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
        await this.loadData();
        this.setState({ viewMode: 'detail' });
    }

    async loadData(jumpToId?: number) {
        if (this.state.isLoading && jumpToId === undefined) return;
        this.setState({ isLoading: true });
        try {
            if (!this.state.isInitialized) {
                const hideArchivedStr = await getSetting('grid_hide_archived');
                if (hideArchivedStr !== null) {
                    this.state.gridFilters.hideArchived = hideArchivedStr === 'true';
                }
            }

            const mediaList = await getAllMedia();
            const nextIndex = this.state.currentIndex;
            const targetId = jumpToId !== undefined ? jumpToId : this.targetMediaId;
            let finalNextIndex = nextIndex;
            let currentLogs: ActivitySummary[] = [];

            if (targetId !== null && targetId !== undefined) {
                const idx = mediaList.findIndex(m => m.id === targetId);
                if (idx !== -1) {
                    finalNextIndex = idx;
                }
                this.targetMediaId = null;
            }

            const viewMode = jumpToId !== undefined ? 'detail' : this.state.viewMode;
            if (viewMode === 'detail' && mediaList[finalNextIndex]) {
                currentLogs = await getLogsForMedia(mediaList[finalNextIndex].id!);
            }

            this.setState({
                currentMediaList: mediaList,
                currentLogs,
                currentIndex: finalNextIndex,
                isLoading: false,
                isInitialized: true,
                viewMode
            });
        } catch (e) {
            Logger.error("Failed to load media view content", e);
        } finally {
            this.setState({ isLoading: false });
        }
    }

    render() {
        if (!this.state.isInitialized && !this.state.isLoading && !this.targetMediaId) {
            this.loadData().catch(err => Logger.error("Failed to load data in render", err));
            return;
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

        if (this.activeSubComponent && this.activeSubComponent.destroy) {
            this.activeSubComponent.destroy();
        }

        if (this.state.viewMode === 'grid') {
            this.renderGrid(root);
        } else {
            this.renderDetail(root);
        }
    }

    private renderGrid(root: HTMLElement) {
        this.activeSubComponent = new MediaGrid(
            root,
            {
                mediaList: this.state.currentMediaList,
                ...this.state.gridFilters
            },
            (id) => {
                this.loadData(id).catch(err => Logger.error("Failed to load media detail", err));
            },
            async (jumpToId) => {
                await this.loadData(jumpToId).catch(err => Logger.error("Failed to jump to media", err));
            },
            (filters) => {
                const oldHideArchived = this.state.gridFilters.hideArchived;
                this.state.gridFilters = { ...this.state.gridFilters, ...filters as MediaFilters };
                if (filters.hideArchived !== undefined && oldHideArchived !== filters.hideArchived) {
                    void setSetting('grid_hide_archived', filters.hideArchived.toString());
                }
            }
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
                onBack: () => { this.exitDetail().catch(e => Logger.error(e)); },
                onNext: () => { this.navigateDetail(1).catch(e => Logger.error(e)); },
                onPrev: () => { this.navigateDetail(-1).catch(e => Logger.error(e)); },
                onNavigate: (index) => this.setState({ currentIndex: index }),
                onDelete: () => { this.exitDetail(true).catch(e => Logger.error(e)); }
            }
        );
        this.activeSubComponent.render();
    }
}

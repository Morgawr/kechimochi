import { Component } from '../core/component';
import { html } from '../core/html';
import { Media, getAllMedia, getLogsForMedia, getSetting, setSetting } from '../api';
import { MediaGrid } from './media/MediaGrid';
import { MediaDetail } from './media/MediaDetail';

interface MediaViewState {
    viewMode: 'grid' | 'detail';
    currentMediaList: Media[];
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
        this.setupGlobalNavigation();
    }

    private setupGlobalNavigation() {
        window.addEventListener('keydown', (e) => {
            if (!document.getElementById('media-root')) return;
            if (this.state.viewMode !== 'detail') return;

            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
                this.navigateDetail(1);
            } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
                this.navigateDetail(-1);
            } else if (e.key === 'Escape') {
                this.exitDetail();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!document.getElementById('media-root')) return;
            if (e.button === 3 && this.state.viewMode === 'detail') {
                this.exitDetail();
                e.preventDefault();
            }
        });
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
        this.setState({ isLoading: true });
        try {
            if (!this.state.isInitialized) {
                const hideArchivedStr = await getSetting('grid_hide_archived');
                if (hideArchivedStr !== null) {
                    this.state.gridFilters.hideArchived = hideArchivedStr === 'true';
                }
            }

            const mediaList = await getAllMedia();
            let nextIndex = this.state.currentIndex;

            const targetId = jumpToId !== undefined ? jumpToId : this.targetMediaId;
            if (targetId !== null && targetId !== undefined) {
                const idx = mediaList.findIndex(m => m.id === targetId);
                if (idx !== -1) {
                    nextIndex = idx;
                }
                this.targetMediaId = null;
            }

            this.setState({
                currentMediaList: mediaList,
                currentIndex: nextIndex,
                isLoading: false,
                isInitialized: true,
                viewMode: jumpToId !== undefined ? 'detail' : this.state.viewMode
            });
        } catch (e) {
            console.error("Failed to load media data", e);
            this.setState({ isLoading: false });
        }
    }

    async render() {
        if (!this.state.isInitialized && !this.state.isLoading && !this.targetMediaId) {
            await this.loadData();
            return; // loadData will re-trigger render
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
            await this.renderGrid(root);
        } else {
            await this.renderDetail(root);
        }
    }

    private async renderGrid(root: HTMLElement) {
        this.activeSubComponent = new MediaGrid(
            root,
            {
                mediaList: this.state.currentMediaList,
                ...this.state.gridFilters
            },
            (id) => {
                const idx = this.state.currentMediaList.findIndex(m => m.id === id);
                this.setState({ viewMode: 'detail', currentIndex: idx });
            },
            async (jumpToId) => {
                await this.loadData(jumpToId);
            },
            (filters) => {
                const oldHideArchived = this.state.gridFilters.hideArchived;
                this.state.gridFilters = { ...this.state.gridFilters, ...filters };
                if (oldHideArchived !== filters.hideArchived) {
                    setSetting('grid_hide_archived', filters.hideArchived.toString());
                }
            }
        );
        this.activeSubComponent.render();
    }

    private async renderDetail(root: HTMLElement) {
        const media = this.state.currentMediaList[this.state.currentIndex];
        if (!media) {
            this.setState({ viewMode: 'grid' });
            return;
        }

        const logs = await getLogsForMedia(media.id!);
        this.activeSubComponent = new MediaDetail(
            root,
            media,
            logs,
            this.state.currentMediaList,
            this.state.currentIndex,
            {
                onBack: () => this.exitDetail(),
                onNext: () => this.navigateDetail(1),
                onPrev: () => this.navigateDetail(-1),
                onNavigate: (index) => this.setState({ currentIndex: index }),
                onDelete: () => this.exitDetail(true)
            }
        );
        this.activeSubComponent.render();
    }
}

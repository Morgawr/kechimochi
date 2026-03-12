import { Component } from '../../core/component';
import { html, escapeHTML } from '../../core/html';
import { Media, addMedia } from '../../api';
import { MediaItem } from './MediaItem';
import { showAddMediaModal } from '../../modals';

interface MediaGridState {
    mediaList: Media[];
    searchQuery: string;
    typeFilter: string;
    statusFilter: string;
    hideArchived: boolean;
}

export interface MediaFilters {
    searchQuery?: string;
    typeFilter?: string;
    statusFilter?: string;
    hideArchived?: boolean;
}

export class MediaGrid extends Component<MediaGridState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private readonly onDataChange: (jumpToId?: number) => Promise<void>;
    private readonly onFilterChange?: (filters: MediaFilters) => void;
    private isDestroyed: boolean = false;
    private currentRenderId: number = 0;
    private headerRendered: boolean = false;

    constructor(container: HTMLElement, initialState: MediaGridState, onMediaClick: (mediaId: number) => void, onDataChange: (jumpToId?: number) => Promise<void>, onFilterChange?: (filters: MediaFilters) => void) {
        super(container, initialState);
        this.onMediaClick = onMediaClick;
        this.onDataChange = onDataChange;
        this.onFilterChange = onFilterChange;
    }

    public destroy() {
        this.isDestroyed = true;
    }

    render() {
        if (!this.headerRendered) {
            this.clear();
            const headerContainer = document.createElement('div');
            headerContainer.id = 'media-grid-header';
            this.container.appendChild(headerContainer);

            const gridContainer = document.createElement('div');
            gridContainer.id = 'media-grid-container';
            gridContainer.className = 'media-grid-scroll-container';
            gridContainer.style.cssText = `display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-auto-rows: 320px; gap: 1.5rem; overflow-y: auto; flex: 1; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;`;
            this.container.appendChild(gridContainer);

            this.renderHeader(headerContainer);
            this.headerRendered = true;
        }

        this.refreshGrid();
    }

    private refreshGrid() {
        const container = this.container.querySelector<HTMLElement>('#media-grid-container');
        if (container) {
            this.renderItems(container);
        }
    }

    private renderHeader(container: HTMLElement) {
        container.innerHTML = '';
        const uniqueTypes = Array.from(new Set(this.state.mediaList.map(m => m.content_type || 'Unknown'))).sort((a, b) => a.localeCompare(b));

        const header = html`
            <div style="padding: 0 1rem; display: flex; gap: 1rem; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <h2 style="margin: 0.5rem 0; color: var(--text-primary); white-space: nowrap;">Library</h2>
                    <button class="btn btn-ghost" id="btn-add-media-grid" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">+ New Media</button>
                    <button class="btn btn-ghost" id="btn-refresh-grid" title="Refresh Library" style="padding: 0.4rem; display: flex; align-items: center; justify-content: center;">
                        <svg id="refresh-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    </button>
                </div>
                <input type="text" id="grid-search-filter" placeholder="Search title..." style="flex: 1; min-width: 0; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none;" value="${this.state.searchQuery}" autocomplete="off" />
                <select id="grid-status-select" style="padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none; cursor: pointer;">
                    <option value="All" ${this.state.statusFilter === 'All' ? 'selected' : ''}>All Statuses</option>
                    ${["Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"].map(s => `<option value="${s}" ${this.state.statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <select id="grid-type-select" style="padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none; cursor: pointer;">
                    <option value="All" ${this.state.typeFilter === 'All' ? 'selected' : ''}>All Types</option>
                    ${uniqueTypes.map(t => `<option value="${escapeHTML(t)}" ${this.state.typeFilter === t ? 'selected' : ''}>${escapeHTML(t)}</option>`).join('')}
                </select>
                <div style="display: flex; align-items: center; gap: 0.6rem; user-select: none;">
                    <span style="font-size: 0.85rem; color: var(--text-secondary);">Hide Archived</span>
                    <label class="switch" style="font-size: 0.7rem;">
                        <input type="checkbox" id="grid-hide-archived" ${this.state.hideArchived ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>
            </div>
        `;
        container.appendChild(header);
        this.setupListeners(header);
    }

    private setupListeners(header: HTMLElement) {
        header.querySelector('#btn-add-media-grid')?.addEventListener('click', async () => {
            const result = await showAddMediaModal();
            if (!result) return;

            const newId = await addMedia({
                title: result.title,
                media_type: result.type,
                status: "Active",
                language: "Japanese",
                description: "",
                cover_image: "",
                extra_data: "{}",
                content_type: result.contentType,
                tracking_status: "Untracked"
            });
            await this.onDataChange(newId);
        });

        header.querySelector('#btn-refresh-grid')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget as HTMLElement;
            const icon = btn.querySelector<HTMLElement>('#refresh-icon');
            if (icon) icon.style.animation = 'spin 0.8s linear infinite';

            await this.onDataChange();

            // Note: MediaGrid might be re-initialized if MediaView recreates it, 
            // but the animation helps feedback until the update.
            if (icon) icon.style.animation = '';
        });

        const searchFilter = header.querySelector<HTMLInputElement>('#grid-search-filter');
        searchFilter?.addEventListener('input', () => {
            this.state.searchQuery = searchFilter.value;
            this.refreshGrid();
            this.notifyFilterChange();
        });

        const typeSelect = header.querySelector<HTMLSelectElement>('#grid-type-select');
        typeSelect?.addEventListener('change', () => {
            this.state.typeFilter = typeSelect.value;
            this.refreshGrid();
            this.notifyFilterChange();
        });

        const statusSelect = header.querySelector<HTMLSelectElement>('#grid-status-select');
        statusSelect?.addEventListener('change', () => {
            this.state.statusFilter = statusSelect.value;
            this.refreshGrid();
            this.notifyFilterChange();
        });

        const hideArchived = header.querySelector<HTMLInputElement>('#grid-hide-archived');
        hideArchived?.addEventListener('change', () => {
            this.state.hideArchived = hideArchived.checked;
            this.refreshGrid();
            this.notifyFilterChange();
        });
    }

    private notifyFilterChange() {
        if (this.onFilterChange) {
            const { searchQuery, typeFilter, statusFilter, hideArchived } = this.state;
            this.onFilterChange({ searchQuery, typeFilter, statusFilter, hideArchived });
        }
    }

    private renderItems(container: HTMLElement) {
        this.currentRenderId++;
        const renderId = this.currentRenderId;

        container.innerHTML = '';
        const { mediaList, searchQuery, typeFilter, statusFilter, hideArchived } = this.state;

        const filteredList = mediaList.filter(media => {
            const matchesQuery = media.title.toLowerCase().includes(searchQuery.toLowerCase());
            const typeMatch = typeFilter === 'All' || (media.content_type || 'Unknown') === typeFilter;
            const statusMatch = statusFilter === 'All' || media.tracking_status === statusFilter;
            const isArchived = media.status === 'Archived';
            const showStatus = !hideArchived || !isArchived;
            return matchesQuery && typeMatch && statusMatch && showStatus;
        });

        if (filteredList.length === 0) {
            container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>';
            return;
        }

        const batchSize = 10;
        const initialBatch = 15;
        let currentIndex = 0;

        const renderBatch = (isFirst = false) => {
            if (this.isDestroyed || renderId !== this.currentRenderId) return;
            const currentLimit = isFirst ? initialBatch : batchSize;
            const end = Math.min(currentIndex + currentLimit, filteredList.length);

            const fragment = document.createDocumentFragment();
            for (let i = currentIndex; i < end; i++) {
                const media = filteredList[i];
                const itemWrapper = document.createElement('div');
                itemWrapper.className = 'media-item-wrapper animate-page-fade-in';
                itemWrapper.style.opacity = '0';
                itemWrapper.style.animation = `fadeIn 0.25s ease-out ${isFirst ? (i * 0.02) : 0}s forwards`;

                // PERFORMANCE: Help browser skip rendering off-screen items
                itemWrapper.style.contentVisibility = 'auto';
                itemWrapper.style.containIntrinsicSize = '180px 320px';

                const item = new MediaItem(itemWrapper, media, () => this.onMediaClick(media.id!));
                item.render();

                fragment.appendChild(itemWrapper);
            }
            container.appendChild(fragment);

            currentIndex = end;
            if (currentIndex < filteredList.length && !this.isDestroyed && renderId === this.currentRenderId) {
                setTimeout(() => {
                    if (!this.isDestroyed && renderId === this.currentRenderId) requestAnimationFrame(() => renderBatch());
                }, isFirst ? 50 : 20);
            }
        };

        renderBatch(true);
    }
}

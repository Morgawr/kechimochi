import { Component } from '../../core/component';
import { html, escapeHTML, rawHtml } from '../../core/html';
import { Media, addMedia } from '../../api';
import { MediaItem } from './MediaItem';
import { showAddMediaModal } from '../../modals';
import { FILTERS, TRACKING_STATUSES, MEDIA_STATUS } from '../../constants';

interface MediaGridState {
    mediaList: Media[];
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
    filtersExpanded: boolean;
}

type MediaGridInitialState = Omit<MediaGridState, 'filtersExpanded'>;

export interface MediaFilters {
    searchQuery?: string;
    typeFilters?: string[];
    statusFilters?: string[];
    hideArchived?: boolean;
}

export class MediaGrid extends Component<MediaGridState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private readonly onDataChange: (jumpToId?: number) => Promise<void>;
    private readonly onFilterChange?: (filters: MediaFilters) => void;
    private isDestroyed: boolean = false;
    private currentRenderId: number = 0;
    private headerRendered: boolean = false;

    constructor(container: HTMLElement, initialState: MediaGridInitialState, onMediaClick: (mediaId: number) => void, onDataChange: (jumpToId?: number) => Promise<void>, onFilterChange?: (filters: MediaFilters) => void) {
        super(container, {
            ...initialState,
            typeFilters: [...new Set(initialState.typeFilters)],
            statusFilters: [...new Set(initialState.statusFilters)],
            filtersExpanded: false
        });
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
            this.headerRendered = true;
        }

        const headerContainer = this.container.querySelector<HTMLElement>('#media-grid-header');
        if (headerContainer) {
            this.renderHeader(headerContainer);
        }
        this.refreshGrid();
    }

    private refreshGrid() {
        const container = this.container.querySelector<HTMLElement>('#media-grid-container');
        if (container) {
            this.renderItems(container);
        }
    }

    private getUniqueTypes(): string[] {
        return Array.from(
            new Set(this.state.mediaList.map((media) => (media.content_type || 'Unknown').trim() || 'Unknown'))
        ).sort((a, b) => a.localeCompare(b));
    }

    private getActiveFilterCount(): number {
        return this.state.statusFilters.length + this.state.typeFilters.length;
    }

    private renderFilterChipGroup(label: string, group: 'status' | 'type', values: readonly string[], selectedValues: string[]): string {
        const chips = [
            `<button type="button" class="media-filter-chip ${selectedValues.length === 0 ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${FILTERS.ALL}" aria-pressed="${selectedValues.length === 0}">${FILTERS.ALL}</button>`,
            ...values.map((value) => {
                const isActive = selectedValues.includes(value);
                const escapedValue = escapeHTML(value);
                return `<button type="button" class="media-filter-chip ${isActive ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${escapedValue}" aria-pressed="${isActive}">${escapedValue}</button>`;
            })
        ].join('');

        return `
            <div class="media-grid-filter-row">
                <div class="media-grid-filter-label">${label}</div>
                <div class="media-grid-chip-list" role="group" aria-label="${label} filters">
                    ${chips}
                </div>
            </div>
        `;
    }

    private renderHeader(container: HTMLElement) {
        container.innerHTML = '';
        const uniqueTypes = this.getUniqueTypes();
        const activeFilterCount = this.getActiveFilterCount();
        const filterCountBadge = activeFilterCount > 0
            ? `<span class="media-grid-filter-count" aria-label="${activeFilterCount} active library filters">${activeFilterCount}</span>`
            : '';
        const panelStyle = this.state.filtersExpanded
            ? 'style="height: auto; opacity: 1; transform: translateY(0); pointer-events: auto;"'
            : 'style="height: 0; opacity: 0; transform: translateY(-8px); pointer-events: none;"';

        const header = html`
            <div class="media-grid-toolbar-shell">
                <div class="media-grid-toolbar">
                    <div class="media-grid-toolbar-primary">
                        <h2 style="margin: 0.5rem 0; color: var(--text-primary); white-space: nowrap;">Library</h2>
                        <button class="btn btn-ghost" id="btn-add-media-grid" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">+ New Media</button>
                        <button class="btn btn-ghost" id="btn-refresh-grid" title="Refresh Library" style="padding: 0.4rem; display: flex; align-items: center; justify-content: center;">
                            <svg id="refresh-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                        </button>
                    </div>

                    <div class="media-grid-toolbar-search">
                        <input type="text" id="grid-search-filter" placeholder="Search title..." style="width: 100%; min-width: 0; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none;" value="${this.state.searchQuery}" autocomplete="off" />
                    </div>

                    <div class="media-grid-toolbar-controls">
                        <button class="media-grid-filters-toggle" id="btn-toggle-filters" aria-expanded="${this.state.filtersExpanded}" aria-controls="media-grid-filter-panel">
                            <span>Filters</span>
                            ${rawHtml(filterCountBadge)}
                            <svg class="media-grid-filters-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2.5 4.5L6 7.5L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>

                        <div class="media-grid-archive-toggle">
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">Hide Archived</span>
                            <label class="switch" style="font-size: 0.7rem;">
                                <input type="checkbox" id="grid-hide-archived" ${this.state.hideArchived ? 'checked' : ''}>
                                <span class="slider round"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div id="media-grid-filter-panel" class="media-grid-filter-panel ${this.state.filtersExpanded ? 'is-expanded' : 'is-collapsed'}" aria-hidden="${this.state.filtersExpanded ? 'false' : 'true'}" ${rawHtml(panelStyle)}>
                    <div class="media-grid-filter-panel-body">
                        <div id="media-grid-filter-tray" class="media-grid-filter-tray">
                            ${rawHtml(this.renderFilterChipGroup('Status', 'status', TRACKING_STATUSES, this.state.statusFilters))}
                            ${rawHtml(this.renderFilterChipGroup('Type', 'type', uniqueTypes, this.state.typeFilters))}
                        </div>
                    </div>
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
                status: MEDIA_STATUS.ACTIVE,
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

        header.querySelector('#btn-toggle-filters')?.addEventListener('click', () => {
            this.toggleFiltersPanel();
        });

        header.querySelectorAll<HTMLButtonElement>('.media-filter-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const group = chip.dataset.filterGroup;
                const value = chip.dataset.filterValue;
                if (!group || !value) return;

                if (group === 'status') {
                    this.updateMultiFilter('statusFilters', value, [...TRACKING_STATUSES]);
                    return;
                }

                if (group === 'type') {
                    this.updateMultiFilter('typeFilters', value, this.getUniqueTypes());
                }
            });
        });

        const hideArchived = header.querySelector<HTMLInputElement>('#grid-hide-archived');
        hideArchived?.addEventListener('change', () => {
            this.state.hideArchived = hideArchived.checked;
            this.refreshGrid();
            this.notifyFilterChange();
        });
    }

    private toggleFiltersPanel() {
        const header = this.container.querySelector<HTMLElement>('#media-grid-header');
        const panel = header?.querySelector<HTMLElement>('#media-grid-filter-panel');
        const button = header?.querySelector<HTMLButtonElement>('#btn-toggle-filters');
        if (!panel || !button) return;

        const nextExpanded = !this.state.filtersExpanded;
        this.state.filtersExpanded = nextExpanded;
        button.setAttribute('aria-expanded', String(nextExpanded));
        panel.setAttribute('aria-hidden', String(!nextExpanded));
        panel.classList.toggle('is-expanded', nextExpanded);
        panel.classList.toggle('is-collapsed', !nextExpanded);

        if (nextExpanded) {
            this.animateFilterPanelOpen(panel);
        } else {
            this.animateFilterPanelClose(panel);
        }
    }

    private animateFilterPanelOpen(panel: HTMLElement) {
        panel.style.pointerEvents = 'none';
        panel.style.overflow = 'hidden';
        panel.style.height = '0px';
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(-8px)';

        requestAnimationFrame(() => {
            const nextHeight = panel.scrollHeight;
            panel.style.height = `${nextHeight}px`;
            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0)';
        });

        const finishOpen = (event: TransitionEvent) => {
            if (event.propertyName !== 'height') return;
            panel.style.height = 'auto';
            panel.style.overflow = 'visible';
            panel.style.pointerEvents = 'auto';
            panel.removeEventListener('transitionend', finishOpen);
        };

        panel.addEventListener('transitionend', finishOpen);
    }

    private animateFilterPanelClose(panel: HTMLElement) {
        panel.style.pointerEvents = 'none';
        panel.style.overflow = 'hidden';
        panel.style.height = `${panel.scrollHeight}px`;
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0)';

        requestAnimationFrame(() => {
            panel.style.height = '0px';
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(-8px)';
        });

        const finishClose = (event: TransitionEvent) => {
            if (event.propertyName !== 'height') return;
            panel.style.overflow = 'hidden';
            panel.removeEventListener('transitionend', finishClose);
        };

        panel.addEventListener('transitionend', finishClose);
    }

    private updateMultiFilter(key: 'statusFilters' | 'typeFilters', value: string, availableValues: string[]) {
        const currentValues = this.state[key];
        let nextValues: string[];

        if (value === FILTERS.ALL) {
            nextValues = [];
        } else if (currentValues.includes(value)) {
            nextValues = currentValues.filter((currentValue) => currentValue !== value);
        } else {
            nextValues = [...currentValues, value].sort((a, b) => availableValues.indexOf(a) - availableValues.indexOf(b));
        }

        this.setState({ [key]: nextValues } as Pick<MediaGridState, typeof key>);
        this.notifyFilterChange();
    }

    private notifyFilterChange() {
        if (this.onFilterChange) {
            const { searchQuery, typeFilters, statusFilters, hideArchived } = this.state;
            this.onFilterChange({
                searchQuery,
                typeFilters: [...typeFilters],
                statusFilters: [...statusFilters],
                hideArchived
            });
        }
    }

    private renderItems(container: HTMLElement) {
        this.currentRenderId++;
        const renderId = this.currentRenderId;

        container.innerHTML = '';
        const { mediaList, searchQuery, typeFilters, statusFilters, hideArchived } = this.state;

        const filteredList = mediaList.filter(media => {
            const matchesQuery = media.title.toLowerCase().includes(searchQuery.toLowerCase());
            const mediaType = (media.content_type || 'Unknown').trim() || 'Unknown';
            const typeMatch = typeFilters.length === 0 || typeFilters.includes(mediaType);
            const statusMatch = statusFilters.length === 0 || statusFilters.includes(media.tracking_status);
            const isArchived = media.status === MEDIA_STATUS.ARCHIVED;
            const archiveMatch = !hideArchived || !isArchived;
            return matchesQuery && typeMatch && statusMatch && archiveMatch;
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

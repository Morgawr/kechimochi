import { Component } from '../../core/component';
import { html, escapeHTML, rawHtml } from '../../core/html';
import { Media, addMedia } from '../../api';
import { showAddMediaModal } from '../../modals';
import { EVENTS, FILTERS, TRACKING_STATUSES, MEDIA_STATUS } from '../../constants';
import { MediaGrid } from './MediaGrid';
import { MediaList } from './MediaList';
import type { LibraryActivityMetrics, LibraryLayoutMode } from './library_types';

interface MediaLibraryBrowserState {
    mediaList: Media[];
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
    preferredLayout: LibraryLayoutMode;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, LibraryActivityMetrics>;
    isListMetricsLoading: boolean;
    filtersExpanded: boolean;
}

type MediaLibraryBrowserInitialState = Omit<MediaLibraryBrowserState, 'filtersExpanded'>;

export interface MediaLibraryFilters {
    searchQuery?: string;
    typeFilters?: string[];
    statusFilters?: string[];
    hideArchived?: boolean;
}

export class MediaLibraryBrowser extends Component<MediaLibraryBrowserState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private readonly onDataChange: (jumpToId?: number) => Promise<void>;
    private readonly onFilterChange?: (filters: MediaLibraryFilters) => void;
    private readonly onLayoutChange?: (layout: LibraryLayoutMode) => void;
    private activeLayoutComponent: Component | null = null;
    private shellRendered = false;

    constructor(
        container: HTMLElement,
        initialState: MediaLibraryBrowserInitialState,
        onMediaClick: (mediaId: number) => void,
        onDataChange: (jumpToId?: number) => Promise<void>,
        onFilterChange?: (filters: MediaLibraryFilters) => void,
        onLayoutChange?: (layout: LibraryLayoutMode) => void,
    ) {
        super(container, {
            ...initialState,
            typeFilters: [...new Set(initialState.typeFilters)],
            statusFilters: [...new Set(initialState.statusFilters)],
            filtersExpanded: false,
        });
        this.onMediaClick = onMediaClick;
        this.onDataChange = onDataChange;
        this.onFilterChange = onFilterChange;
        this.onLayoutChange = onLayoutChange;
    }

    public override destroy() {
        this.activeLayoutComponent?.destroy?.();
        super.destroy();
    }

    render() {
        if (!this.shellRendered) {
            this.clear();

            const headerContainer = document.createElement('div');
            headerContainer.id = 'media-library-header';
            this.container.appendChild(headerContainer);

            const contentContainer = document.createElement('div');
            contentContainer.id = 'media-library-content';
            // Allow the library content to shrink in flex layouts; otherwise long children can
            // force horizontal overflow which then gets clipped by the app shell.
            contentContainer.style.cssText = 'display: flex; flex: 1; min-height: 0; min-width: 0;';
            this.container.appendChild(contentContainer);

            this.shellRendered = true;
        }

        const headerContainer = this.container.querySelector<HTMLElement>('#media-library-header');
        const contentContainer = this.container.querySelector<HTMLElement>('#media-library-content');
        if (!headerContainer || !contentContainer) return;

        this.renderHeader(headerContainer);
        this.renderContent(contentContainer);
    }

    private getActiveLayout(): LibraryLayoutMode {
        return this.state.isGridSupported ? this.state.preferredLayout : 'list';
    }

    private getUniqueTypes(): string[] {
        return Array.from(
            new Set(this.state.mediaList.map((media) => (media.content_type || 'Unknown').trim() || 'Unknown'))
        ).sort((a, b) => a.localeCompare(b));
    }

    private getFilteredMediaList(): Media[] {
        const { mediaList, searchQuery, typeFilters, statusFilters, hideArchived } = this.state;
        return mediaList.filter((media) => {
            const matchesQuery = media.title.toLowerCase().includes(searchQuery.toLowerCase());
            const mediaType = (media.content_type || 'Unknown').trim() || 'Unknown';
            const typeMatch = typeFilters.length === 0 || typeFilters.includes(mediaType);
            const statusMatch = statusFilters.length === 0 || statusFilters.includes(media.tracking_status);
            const isArchived = media.status === MEDIA_STATUS.ARCHIVED;
            const archiveMatch = !hideArchived || !isArchived;
            return matchesQuery && typeMatch && statusMatch && archiveMatch;
        });
    }

    private getActiveFilterCount(): number {
        return this.state.statusFilters.length + this.state.typeFilters.length;
    }

    private renderFilterChipGroup(
        label: string,
        group: 'status' | 'type',
        values: readonly string[],
        selectedValues: string[],
    ): string {
        const chips = [
            `<button type="button" class="media-filter-chip ${selectedValues.length === 0 ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${FILTERS.ALL}" aria-pressed="${selectedValues.length === 0}">${FILTERS.ALL}</button>`,
            ...values.map((value) => {
                const isActive = selectedValues.includes(value);
                const escapedValue = escapeHTML(value);
                return `<button type="button" class="media-filter-chip ${isActive ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${escapedValue}" aria-pressed="${isActive}">${escapedValue}</button>`;
            }),
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
        const activeLayout = this.getActiveLayout();
        const activeFilterCount = this.getActiveFilterCount();
        const filterCountBadge = activeFilterCount > 0
            ? `<span class="media-grid-filter-count" aria-label="${activeFilterCount} active library filters">${activeFilterCount}</span>`
            : '';
        const panelStyle = this.state.filtersExpanded
            ? 'style="height: auto; opacity: 1; transform: translateY(0); pointer-events: auto;"'
            : 'style="height: 0; opacity: 0; transform: translateY(-8px); pointer-events: none;"';
        const compactHint = this.state.isGridSupported
            ? ''
            : '<span class="media-layout-hint">Grid re-enables when the window is wider.</span>';

        const header = html`
            <div class="media-grid-toolbar-shell">
                <div class="media-grid-toolbar">
                    <div class="media-grid-toolbar-primary">
                        <h2 style="margin: 0.5rem auto 0.5em 0; color: var(--text-primary); white-space: nowrap;">Library</h2>
                        <button class="btn btn-ghost" id="btn-add-media-grid" style="font-size: 0.9rem; padding: 0.4rem 0.6rem;">+ New Media</button>
                        <button class="btn btn-ghost" id="btn-refresh-grid" title="Refresh Library" style="padding: 0.4rem; display: flex; align-items: center; justify-content: center;">
                            <svg id="refresh-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                                <g transform="rotate(0 0 30)">><path d="M17.91 14c-.478 2.833-2.943 5-5.91 5-3.308 0-6-2.692-6-6s2.692-6 6-6h2.172l-2.086 2.086L13.5 10.5 18 6l-4.5-4.5-1.414 1.414L14.172 5H12c-4.418 0-8 3.582-8 8s3.582 8 8 8c4.08 0 7.438-3.055 7.93-7h-2.02z"/></g>
                            </svg>
                        </button>
                    </div>

                    <div class="media-grid-toolbar-search">
                        <input type="text" id="grid-search-filter" placeholder="Search title..." style="width: 100%; min-width: 0; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none;" value="${this.state.searchQuery}" autocomplete="off" />
                    </div>

                    <div class="media-grid-toolbar-controls">
                        <div class="media-layout-toggle-shell">
                            <div class="media-layout-toggle" role="group" aria-label="Library layout toggle">
                                <button
                                    type="button"
                                    class="media-layout-toggle-option ${activeLayout === 'grid' ? 'is-active' : ''}"
                                    id="btn-layout-grid"
                                    aria-pressed="${activeLayout === 'grid'}"
                                    ${this.state.isGridSupported ? '' : 'disabled'}
                                >
                                    Grid
                                </button>
                                <button
                                    type="button"
                                    class="media-layout-toggle-option ${activeLayout === 'list' ? 'is-active' : ''}"
                                    id="btn-layout-list"
                                    aria-pressed="${activeLayout === 'list'}"
                                >
                                    List
                                </button>
                            </div>
                            ${rawHtml(compactHint)}
                        </div>

                        <button class="media-grid-filters-toggle" id="btn-toggle-filters" aria-expanded="${this.state.filtersExpanded}" aria-controls="media-grid-filter-panel">
                            <span>Filters</span>
                            ${rawHtml(filterCountBadge)}
                            <svg class="media-grid-filters-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2.5 4.5L6 7.5L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <div id="media-grid-filter-panel" class="media-grid-filter-panel ${this.state.filtersExpanded ? 'is-expanded' : 'is-collapsed'}" aria-hidden="${this.state.filtersExpanded ? 'false' : 'true'}" ${rawHtml(panelStyle)}>
                    <div class="media-grid-filter-panel-body">
                        <div id="media-grid-filter-tray" class="media-grid-filter-tray">
                            ${rawHtml(this.renderFilterChipGroup('Status', 'status', TRACKING_STATUSES, this.state.statusFilters))}
                            ${rawHtml(this.renderFilterChipGroup('Type', 'type', uniqueTypes, this.state.typeFilters))}
                            <div class="media-grid-filter-row">
                                <div class="media-grid-filter-label">Other</div>
                                <div class="media-grid-archive-toggle" style="display: flex; align-items: center; gap: 0.5rem;">
                                    <span style="font-size: 0.85rem; color: var(--text-secondary);">Hide Archived</span>
                                    <label class="switch" style="font-size: 0.7rem;">
                                        <input type="checkbox" id="grid-hide-archived" ${this.state.hideArchived ? 'checked' : ''}>
                                        <span class="slider round"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(header);
        this.setupListeners(header);
    }

    private renderContent(container: HTMLElement) {
        this.activeLayoutComponent?.destroy?.();
        container.innerHTML = '';

        const layoutRoot = document.createElement('div');
        layoutRoot.className = 'media-library-layout-root';
        // Flex children default to min-width:auto, which can prevent shrinking and create
        // horizontal overflow (then clipped by the app shell). Allow the library layouts
        // to shrink properly at narrow window widths.
        layoutRoot.style.cssText = 'display: flex; flex: 1; min-height: 0; min-width: 0;';
        container.appendChild(layoutRoot);

        const filteredList = this.getFilteredMediaList();
        if (this.getActiveLayout() === 'grid') {
            this.activeLayoutComponent = new MediaGrid(layoutRoot, { mediaList: filteredList }, this.onMediaClick);
        } else {
            this.activeLayoutComponent = new MediaList(
                layoutRoot,
                {
                    mediaList: filteredList,
                    metricsByMediaId: this.state.listMetricsByMediaId,
                    isMetricsLoading: this.state.isListMetricsLoading,
                },
                this.onMediaClick,
            );
        }

        this.activeLayoutComponent.render();
    }

    private setupListeners(header: HTMLElement) {
        header.querySelector('#btn-add-media-grid')?.addEventListener('click', async () => {
            const result = await showAddMediaModal();
            if (!result) return;

            const newId = await addMedia({
                title: result.title,
                media_type: result.type,
                status: MEDIA_STATUS.ACTIVE,
                language: 'Japanese',
                description: '',
                cover_image: '',
                extra_data: '{}',
                content_type: result.contentType,
                tracking_status: 'Untracked',
            });
            await this.onDataChange(newId);
            globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED));
        });

        header.querySelector('#btn-refresh-grid')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget as HTMLElement;
            const icon = btn.querySelector<HTMLElement>('#refresh-icon');
            if (icon) icon.style.animation = 'spin 0.8s linear infinite';

            await this.onDataChange();

            if (icon) icon.style.animation = '';
        });

        const searchFilter = header.querySelector<HTMLInputElement>('#grid-search-filter');
        searchFilter?.addEventListener('input', () => {
            this.state.searchQuery = searchFilter.value;
            this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
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
            this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
            this.notifyFilterChange();
        });

        header.querySelector('#btn-layout-grid')?.addEventListener('click', () => {
            this.setLayout('grid');
        });

        header.querySelector('#btn-layout-list')?.addEventListener('click', () => {
            this.setLayout('list');
        });
    }

    private setLayout(layout: LibraryLayoutMode) {
        if (layout === 'grid' && !this.state.isGridSupported) {
            return;
        }

        if (this.state.preferredLayout === layout) {
            return;
        }

        this.state.preferredLayout = layout;
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.onLayoutChange?.(layout);
    }

    private toggleFiltersPanel() {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
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

        if (key === 'statusFilters') {
            this.state.statusFilters = nextValues;
        } else {
            this.state.typeFilters = nextValues;
        }
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private notifyFilterChange() {
        this.onFilterChange?.({
            searchQuery: this.state.searchQuery,
            typeFilters: [...this.state.typeFilters],
            statusFilters: [...this.state.statusFilters],
            hideArchived: this.state.hideArchived,
        });
    }
}

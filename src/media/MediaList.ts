import { Component } from '../component';
import { Media } from '../api';
import { MediaListItem } from './MediaListItem';
import type { LibraryActivityMetrics } from './library_types';
import type { LibraryRow } from './sorting';
import { createCollectionItemWrapper, createLibrarySectionHeaderWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';
import { CoverVisibilityController } from './cover_visibility';

interface MediaListState {
    rows: LibraryRow[];
    metricsByMediaId: Record<number, LibraryActivityMetrics>;
    isMetricsLoading: boolean;
}

export class MediaList extends Component<MediaListState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private isDestroyed = false;
    private currentRenderId = 0;
    private childItems: MediaListItem[] = [];
    private visibilityController: CoverVisibilityController | null = null;
    private readonly itemsByMediaId = new Map<number, MediaListItem>();
    private readonly elementsByMediaId = new Map<number, HTMLElement>();
    private readonly headerElementsByContentType = new Map<string, HTMLElement>();
    private isRenderComplete = false;

    constructor(container: HTMLElement, initialState: MediaListState, onMediaClick: (mediaId: number) => void) {
        super(container, initialState);
        this.onMediaClick = onMediaClick;
    }

    public destroy() {
        this.isDestroyed = true;
        this.destroyRenderedItems();
    }

    public async reconcileCoverUrls(): Promise<void> {
        await Promise.all(this.childItems.map(item => item.reconcileCoverUrl()));
    }

    public isRenderingComplete(): boolean {
        return this.isRenderComplete;
    }

    public getScrollContainer(): HTMLElement | null {
        return this.container.querySelector<HTMLElement>('#media-list-container');
    }

    public getMediaElement(mediaId: number): HTMLElement | null {
        return this.elementsByMediaId.get(mediaId) ?? null;
    }

    public getHeaderElement(contentType: string): HTMLElement | null {
        return this.headerElementsByContentType.get(contentType) ?? null;
    }

    public removeHeaderElement(contentType: string): void {
        this.headerElementsByContentType.get(contentType)?.remove();
        this.headerElementsByContentType.delete(contentType);
    }

    public async updateMediaItem(media: Media, metrics: LibraryActivityMetrics | null): Promise<void> {
        if (media.id == null) return;
        const item = this.itemsByMediaId.get(media.id);
        if (!item) return;

        // Re-rendering rebuilds the <img>, so a cover URL the shared cache has
        // since revoked must be refreshed before the card is redrawn.
        await item.reconcileCoverUrl();
        item.setState({ media, metrics });
    }

    public removeMediaItem(mediaId: number): void {
        const item = this.itemsByMediaId.get(mediaId);
        if (!item) return;

        item.destroy();
        this.itemsByMediaId.delete(mediaId);
        this.childItems = this.childItems.filter(candidate => candidate !== item);
        this.elementsByMediaId.get(mediaId)?.remove();
        this.elementsByMediaId.delete(mediaId);
    }

    render() {
        this.currentRenderId += 1;
        const renderId = this.currentRenderId;

        this.destroyRenderedItems();
        this.isRenderComplete = false;
        this.visibilityController = new CoverVisibilityController('360px 0px');
        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.rows,
            containerId: 'media-list-container',
            containerClassName: 'media-list-scroll-container',
            // min-width:0 is required for flex children to shrink instead of overflowing horizontally.
            containerStyle: 'display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; flex: 1; min-width: 0; padding: 0.5rem 1rem 2rem 1rem;',
            emptyStateMarkup: '<div style="text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 18,
            batchSize: 12,
            firstBatchDelayMs: 40,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            performanceOperation: 'library_list_batch',
            onRenderComplete: () => {
                this.isRenderComplete = true;
            },
            createItemWrapper: (row, index) => {
                if (row.kind === 'header') {
                    const headerWrapper = createLibrarySectionHeaderWrapper(row.contentType, false);
                    this.headerElementsByContentType.set(row.contentType, headerWrapper);
                    return headerWrapper;
                }

                const media = row.media;
                const itemWrapper = createCollectionItemWrapper(
                    'media-list-item-wrapper',
                    // Only reserve a reasonable block-size for content-visibility.
                    // Reserving a large inline-size (like 1000px) can create horizontal clipping
                    // when the window is narrower because offscreen items contribute to scrollWidth.
                    'auto 168px',
                );
                const metrics = media.id == null ? null : (this.state.metricsByMediaId[media.id] ?? null);
                const item = new MediaListItem(
                    itemWrapper,
                    media,
                    metrics,
                    this.state.isMetricsLoading,
                    () => {
                        if (media.id == null) {
                            return;
                        }
                        this.onMediaClick(media.id);
                    },
                    this.visibilityController ?? undefined,
                    index < 8,
                );
                this.childItems.push(item);
                if (media.id != null) {
                    this.itemsByMediaId.set(media.id, item);
                    this.elementsByMediaId.set(media.id, itemWrapper);
                }
                item.render();
                return itemWrapper;
            },
        });
    }

    private destroyRenderedItems(): void {
        this.visibilityController?.disconnect();
        this.visibilityController = null;
        this.childItems.forEach(item => item.destroy());
        this.childItems = [];
        this.itemsByMediaId.clear();
        this.elementsByMediaId.clear();
        this.headerElementsByContentType.clear();
    }
}

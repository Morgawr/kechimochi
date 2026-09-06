import { Component } from '../component';
import { Media } from '../api';
import { MediaItem } from './MediaItem';
import type { LibraryRow } from './sorting';
import { normalizeLibraryGridZoom } from './library_types';
import { createCollectionItemWrapper, createLibrarySectionHeaderWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';
import { CoverVisibilityController } from './cover_visibility';

interface MediaGridState {
    rows: LibraryRow[];
    gridZoom: number;
}

const DEFAULT_CARD_MIN_WIDTH = 180;
const DEFAULT_CARD_HEIGHT = 320;

export class MediaGrid extends Component<MediaGridState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private isDestroyed = false;
    private currentRenderId = 0;
    private childItems: MediaItem[] = [];
    private visibilityController: CoverVisibilityController | null = null;
    private itemsByMediaId = new Map<number, MediaItem>();
    private elementsByMediaId = new Map<number, HTMLElement>();
    private headerElementsByContentType = new Map<string, HTMLElement>();
    private isRenderComplete = false;

    constructor(container: HTMLElement, initialState: MediaGridState, onMediaClick: (mediaId: number) => void) {
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
        return this.container.querySelector<HTMLElement>('#media-grid-container');
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

    public async updateMediaItem(media: Media): Promise<void> {
        if (media.id == null) return;
        const item = this.itemsByMediaId.get(media.id);
        if (!item) return;

        // Re-rendering rebuilds the <img>, so a cover URL the shared cache has
        // since revoked must be refreshed before the card is redrawn.
        await item.reconcileCoverUrl();
        item.setState({ media });
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
        const gridZoom = normalizeLibraryGridZoom(this.state.gridZoom);
        const cardMinWidth = DEFAULT_CARD_MIN_WIDTH * gridZoom / 100;
        const cardHeight = DEFAULT_CARD_HEIGHT * gridZoom / 100;

        this.destroyRenderedItems();
        this.isRenderComplete = false;
        this.visibilityController = new CoverVisibilityController('320px 0px');
        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.rows,
            containerId: 'media-grid-container',
            containerClassName: 'media-grid-scroll-container',
            containerStyle: `display: grid; grid-template-columns: repeat(auto-fill, minmax(${cardMinWidth}px, 1fr)); grid-auto-rows: min-content; --library-card-height: ${cardHeight}px; gap: 1.5rem; overflow-y: auto; flex: 1; min-width: 0; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;`,
            emptyStateMarkup: '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 15,
            batchSize: 10,
            firstBatchDelayMs: 50,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            performanceOperation: 'library_grid_batch',
            onRenderComplete: () => {
                this.isRenderComplete = true;
            },
            createItemWrapper: (row, index) => {
                if (row.kind === 'header') {
                    const headerWrapper = createLibrarySectionHeaderWrapper(row.contentType, true);
                    this.headerElementsByContentType.set(row.contentType, headerWrapper);
                    return headerWrapper;
                }

                const itemWrapper = createCollectionItemWrapper(
                    'media-item-wrapper',
                    `${cardMinWidth}px ${cardHeight}px`,
                );
                const media = row.media;
                const mediaId = media.id;
                const item = new MediaItem(itemWrapper, media, () => {
                    if (mediaId == null) {
                        return;
                    }
                    this.onMediaClick(mediaId);
                }, this.visibilityController ?? undefined, index < 6);
                this.childItems.push(item);
                if (mediaId != null) {
                    this.itemsByMediaId.set(mediaId, item);
                    this.elementsByMediaId.set(mediaId, itemWrapper);
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

import { Component } from '../component';
import { Media } from '../api';
import { MediaItem } from './MediaItem';
import { normalizeLibraryGridZoom } from './library_types';
import { createCollectionItemWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';
import { CoverVisibilityController } from './cover_visibility';

interface MediaGridState {
    mediaList: Media[];
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

    constructor(container: HTMLElement, initialState: MediaGridState, onMediaClick: (mediaId: number) => void) {
        super(container, initialState);
        this.onMediaClick = onMediaClick;
    }

    public destroy() {
        this.isDestroyed = true;
        this.destroyRenderedItems();
    }

    render() {
        this.currentRenderId += 1;
        const renderId = this.currentRenderId;
        const gridZoom = normalizeLibraryGridZoom(this.state.gridZoom);
        const cardMinWidth = DEFAULT_CARD_MIN_WIDTH * gridZoom / 100;
        const cardHeight = DEFAULT_CARD_HEIGHT * gridZoom / 100;

        this.destroyRenderedItems();
        this.visibilityController = new CoverVisibilityController('320px 0px');
        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.mediaList,
            containerId: 'media-grid-container',
            containerClassName: 'media-grid-scroll-container',
            // min-width:0 is required for flex children to shrink instead of overflowing horizontally.
            containerStyle: `display: grid; grid-template-columns: repeat(auto-fill, minmax(${cardMinWidth}px, 1fr)); grid-auto-rows: ${cardHeight}px; gap: 1.5rem; overflow-y: auto; flex: 1; min-width: 0; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;`,
            emptyStateMarkup: '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 15,
            batchSize: 10,
            firstBatchDelayMs: 50,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            performanceOperation: 'library_grid_batch',
            createItemWrapper: (media, index) => {
                const itemWrapper = createCollectionItemWrapper(
                    'media-item-wrapper',
                    `${cardMinWidth}px ${cardHeight}px`,
                );
                const mediaId = media.id;
                const item = new MediaItem(itemWrapper, media, () => {
                    if (mediaId == null) {
                        return;
                    }
                    this.onMediaClick(mediaId);
                }, this.visibilityController ?? undefined, index < 6);
                this.childItems.push(item);
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
    }
}

import { Component } from '../component';
import { MediaItem } from './MediaItem';
import type { LibraryRow } from './sorting';
import { normalizeLibraryGridZoom } from './library_types';
import { createAnimatedCollectionItemWrapper, createLibrarySectionHeaderWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';

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

    constructor(container: HTMLElement, initialState: MediaGridState, onMediaClick: (mediaId: number) => void) {
        super(container, initialState);
        this.onMediaClick = onMediaClick;
    }

    public destroy() {
        this.isDestroyed = true;
    }

    render() {
        this.currentRenderId += 1;
        const renderId = this.currentRenderId;
        const gridZoom = normalizeLibraryGridZoom(this.state.gridZoom);
        const cardMinWidth = DEFAULT_CARD_MIN_WIDTH * gridZoom / 100;
        const cardHeight = DEFAULT_CARD_HEIGHT * gridZoom / 100;

        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.rows,
            containerId: 'media-grid-container',
            containerClassName: 'media-grid-scroll-container',
            // min-width:0 is required for flex children to shrink instead of overflowing horizontally.
            // grid-auto-rows is min-content (not a fixed height) so header rows collapse to their
            // content; the item height lives on .media-item-wrapper via --library-card-height.
            // The height must travel as a custom property rather than an inline height on the
            // wrapper, or it would outrank the mobile stylesheet's smaller card height.
            containerStyle: `display: grid; grid-template-columns: repeat(auto-fill, minmax(${cardMinWidth}px, 1fr)); grid-auto-rows: min-content; --library-card-height: ${cardHeight}px; gap: 1.5rem; overflow-y: auto; flex: 1; min-width: 0; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;`,
            emptyStateMarkup: '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 15,
            batchSize: 10,
            firstBatchDelayMs: 50,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            createItemWrapper: (row, index, isFirstBatch) => {
                if (row.kind === 'header') {
                    return createLibrarySectionHeaderWrapper(row.label, isFirstBatch ? index * 0.02 : 0, true);
                }

                const itemWrapper = createAnimatedCollectionItemWrapper(
                    'media-item-wrapper',
                    isFirstBatch ? index * 0.02 : 0,
                    `${cardMinWidth}px ${cardHeight}px`,
                );
                const media = row.media;
                const mediaId = media.id;
                const item = new MediaItem(itemWrapper, media, () => {
                    if (mediaId == null) {
                        return;
                    }
                    this.onMediaClick(mediaId);
                });
                item.render();
                return itemWrapper;
            },
        });
    }
}

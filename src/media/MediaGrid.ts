import { Component } from '../component';
import { Media } from '../api';
import { MediaItem } from './MediaItem';
import { createAnimatedCollectionItemWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';

interface MediaGridState {
    mediaList: Media[];
}

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

        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.mediaList,
            containerId: 'media-grid-container',
            containerClassName: 'media-grid-scroll-container',
            // min-width:0 is required for flex children to shrink instead of overflowing horizontally.
            containerStyle: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-auto-rows: 320px; gap: 1.5rem; overflow-y: auto; flex: 1; min-width: 0; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;',
            emptyStateMarkup: '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 15,
            batchSize: 10,
            firstBatchDelayMs: 50,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            createItemWrapper: (media, index, isFirstBatch) => {
                const itemWrapper = createAnimatedCollectionItemWrapper(
                    'media-item-wrapper',
                    isFirstBatch ? index * 0.02 : 0,
                    '180px 320px',
                );
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

import { Component } from '../../core/component';
import { Media } from '../../api';
import { MediaListItem } from './MediaListItem';
import type { LibraryActivityMetrics } from './library_types';
import { createAnimatedCollectionItemWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';

interface MediaListState {
    mediaList: Media[];
    metricsByMediaId: Record<number, LibraryActivityMetrics>;
    isMetricsLoading: boolean;
}

export class MediaList extends Component<MediaListState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private isDestroyed = false;
    private currentRenderId = 0;

    constructor(container: HTMLElement, initialState: MediaListState, onMediaClick: (mediaId: number) => void) {
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
            containerId: 'media-list-container',
            containerClassName: 'media-list-scroll-container',
            containerStyle: 'display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; flex: 1; padding: 0.5rem 1rem 2rem 1rem;',
            emptyStateMarkup: '<div style="text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>',
            initialBatchSize: 18,
            batchSize: 12,
            firstBatchDelayMs: 40,
            subsequentBatchDelayMs: 20,
            shouldContinue: () => !this.isDestroyed && renderId === this.currentRenderId,
            createItemWrapper: (media, index, isFirstBatch) => {
                const itemWrapper = createAnimatedCollectionItemWrapper(
                    'media-list-item-wrapper',
                    isFirstBatch ? index * 0.02 : 0,
                    '1000px 168px',
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
                );
                item.render();
                return itemWrapper;
            },
        });
    }
}

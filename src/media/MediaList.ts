import { Component } from '../component';
import { Media } from '../api';
import { MediaListItem } from './MediaListItem';
import type { LibraryActivityMetrics } from './library_types';
import { createCollectionItemWrapper, renderIncrementalMediaCollection } from './render_incremental_collection';
import { CoverVisibilityController } from './cover_visibility';

interface MediaListState {
    mediaList: Media[];
    metricsByMediaId: Record<number, LibraryActivityMetrics>;
    isMetricsLoading: boolean;
}

export class MediaList extends Component<MediaListState> {
    private readonly onMediaClick: (mediaId: number) => void;
    private isDestroyed = false;
    private currentRenderId = 0;
    private childItems: MediaListItem[] = [];
    private visibilityController: CoverVisibilityController | null = null;

    constructor(container: HTMLElement, initialState: MediaListState, onMediaClick: (mediaId: number) => void) {
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

        this.destroyRenderedItems();
        this.visibilityController = new CoverVisibilityController('360px 0px');
        this.clear();

        renderIncrementalMediaCollection({
            host: this.container,
            items: this.state.mediaList,
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
            createItemWrapper: (media, index) => {
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

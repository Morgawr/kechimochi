import { Component } from '../../core/component';
import { Media } from '../../api';
import { MediaListItem } from './MediaListItem';
import type { LibraryActivityMetrics } from './library_types';

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

        const container = document.createElement('div');
        container.id = 'media-list-container';
        container.className = 'media-list-scroll-container';
        container.style.cssText = 'display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; flex: 1; padding: 0.5rem 1rem 2rem 1rem;';
        this.container.appendChild(container);

        if (this.state.mediaList.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 4rem;">No media matches your filters.</div>';
            return;
        }

        const batchSize = 12;
        const initialBatch = 18;
        let currentIndex = 0;

        const renderBatch = (isFirst = false) => {
            if (this.isDestroyed || renderId !== this.currentRenderId) return;
            const currentLimit = isFirst ? initialBatch : batchSize;
            const end = Math.min(currentIndex + currentLimit, this.state.mediaList.length);

            const fragment = document.createDocumentFragment();
            for (let i = currentIndex; i < end; i += 1) {
                const media = this.state.mediaList[i];
                const itemWrapper = document.createElement('div');
                itemWrapper.className = 'media-list-item-wrapper animate-page-fade-in';
                itemWrapper.style.opacity = '0';
                itemWrapper.style.animation = `fadeIn 0.25s ease-out ${isFirst ? (i * 0.02) : 0}s forwards`;
                itemWrapper.style.contentVisibility = 'auto';
                itemWrapper.style.containIntrinsicSize = '1000px 168px';

                const metrics = media.id == null ? null : (this.state.metricsByMediaId[media.id] ?? null);
                const item = new MediaListItem(
                    itemWrapper,
                    media,
                    metrics,
                    this.state.isMetricsLoading,
                    () => this.onMediaClick(media.id!),
                );
                item.render();

                fragment.appendChild(itemWrapper);
            }

            container.appendChild(fragment);
            currentIndex = end;

            if (currentIndex < this.state.mediaList.length && !this.isDestroyed && renderId === this.currentRenderId) {
                setTimeout(() => {
                    if (!this.isDestroyed && renderId === this.currentRenderId) {
                        requestAnimationFrame(() => renderBatch());
                    }
                }, isFirst ? 40 : 20);
            }
        };

        renderBatch(true);
    }
}

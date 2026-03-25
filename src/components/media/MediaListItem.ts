import { Logger } from '../../core/logger';
import { Component } from '../../core/component';
import { html, escapeHTML, rawHtml } from '../../core/html';
import { Media } from '../../api';
import { formatHhMm } from '../../utils/time';
import { MediaCoverLoader } from './cover_loader';
import type { LibraryActivityMetrics } from './library_types';

interface MediaListItemState {
    media: Media;
    metrics: LibraryActivityMetrics | null;
    imgSrc: string | null;
    isMetricsLoading: boolean;
}

export class MediaListItem extends Component<MediaListItemState> {
    constructor(
        container: HTMLElement,
        media: Media,
        metrics: LibraryActivityMetrics | null,
        isMetricsLoading: boolean,
        onClick: () => void,
    ) {
        super(container, { media, metrics, imgSrc: null, isMetricsLoading });
        this.container.addEventListener('click', onClick);

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.loadImage().catch((e) => Logger.error('Failed to load list cover image', e));
                observer.disconnect();
            }
        }, { rootMargin: '240px' });
        observer.observe(this.container);
    }

    private async loadImage() {
        const { cover_image: coverImage } = this.state.media;
        if (!coverImage || coverImage.trim() === '') return;

        const src = await MediaCoverLoader.load(coverImage);
        if (!src) return;
        this.setState({ imgSrc: src });
    }

    private getTrackingStatusClass(status: string): string {
        switch (status) {
            case 'Ongoing': return 'status-ongoing';
            case 'Complete': return 'status-complete';
            case 'Paused': return 'status-paused';
            case 'Dropped': return 'status-dropped';
            case 'Not Started': return 'status-not-started';
            case 'Untracked': return 'status-untracked';
            default: return '';
        }
    }

    private getMetricValue(value: string | null, fallback: string): string {
        if (this.state.isMetricsLoading) {
            return 'Loading...';
        }

        return value && value.trim().length > 0 ? value : fallback;
    }

    private getDurationValue(): string {
        if (this.state.isMetricsLoading) {
            return 'Loading...';
        }

        const totalMinutes = this.state.metrics?.totalMinutes ?? 0;
        return totalMinutes > 0 ? formatHhMm(totalMinutes) : '--';
    }

    render() {
        const { media, metrics, imgSrc } = this.state;
        const contentType = (media.content_type || 'Unknown').trim() || 'Unknown';
        const description = media.description?.trim() || 'No description yet.';
        const isArchived = media.status === 'Archived';
        const firstActivity = this.getMetricValue(metrics?.firstActivityDate ?? null, '--');
        const lastActivity = this.getMetricValue(metrics?.lastActivityDate ?? null, '--');
        const duration = this.getDurationValue();
        const contentTypeBadge = contentType === 'Unknown'
            ? ''
            : `<span class="media-list-pill media-list-pill-type">${escapeHTML(contentType)}</span>`;
        const archivedBadge = isArchived
            ? '<span class="media-list-pill media-list-pill-archived">Archived</span>'
            : '';
        const coverStatusLabel = media.cover_image ? 'Loading...' : 'No Image';

        this.clear();

        const cover = imgSrc
            ? html`<img class="media-list-cover-image" src="${imgSrc}" alt="${media.title}" />`
            : html`
                <div class="media-list-cover-placeholder">
                    <div class="media-list-cover-placeholder-title">${media.title}</div>
                    <div class="media-list-cover-placeholder-label">${coverStatusLabel}</div>
                </div>
            `;

        const root = html`
            <div class="media-list-item ${isArchived ? 'is-archived' : ''}">
                <div class="media-list-cover-shell"></div>
                <div class="media-list-copy">
                    <div class="media-list-header">
                        <div class="media-list-title-block">
                            <h3 class="media-list-title">${media.title}</h3>
                            <div class="media-list-badges">
                                ${rawHtml(contentTypeBadge)}
                                <span class="badge badge-status ${this.getTrackingStatusClass(media.tracking_status)}">${media.tracking_status}</span>
                                ${rawHtml(archivedBadge)}
                            </div>
                        </div>
                    </div>

                    <p class="media-list-description">${description}</p>

                    <div class="media-list-stats">
                        <div class="media-list-stat">
                            <span class="media-list-stat-label">First Logged</span>
                            <strong class="media-list-stat-value">${firstActivity}</strong>
                        </div>
                        <div class="media-list-stat">
                            <span class="media-list-stat-label">Last Logged</span>
                            <strong class="media-list-stat-value">${lastActivity}</strong>
                        </div>
                        <div class="media-list-stat">
                            <span class="media-list-stat-label">Time Logged</span>
                            <strong class="media-list-stat-value">${duration}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;

        root.querySelector('.media-list-cover-shell')?.appendChild(cover);

        this.container.classList.add('media-list-item-shell');
        this.container.title = media.title;
        this.container.dataset.title = media.title;
        this.container.style.cursor = 'pointer';
        this.container.appendChild(root);
    }
}

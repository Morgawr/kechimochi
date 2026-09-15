import { html } from '../html';
import { Media } from '../api';
import type { CoverVisibilityController } from './cover_visibility';
import { MEDIA_GRID_COVER, ProgressiveCoverComponent } from './progressive_cover';

interface MediaItemState {
    media: Media;
    imgSrc: string | null;
}

export class MediaItem extends ProgressiveCoverComponent<MediaItemState> {
    constructor(
        container: HTMLElement,
        media: Media,
        onClick: () => void,
        visibilityController?: CoverVisibilityController,
        eager = false,
    ) {
        super(container, {
            media,
            imgSrc: null,
        }, MEDIA_GRID_COVER, visibilityController, eager);
        this.container.addEventListener('click', onClick);
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

    render() {
        const { media, imgSrc } = this.state;
        const contentType = media.content_type || 'Unknown';

        this.clear();

        const noImageLabel = media.cover_image ? 'Loading...' : 'No Image';
        const content = imgSrc
            ? html`<img class="media-grid-cover-image progressive-cover-image is-loaded" src="${imgSrc}" loading="lazy" decoding="async" alt="${media.title}" />`
            : html`
                <div class="image-placeholder">
                    <div class="grid-item-placeholder-label">${noImageLabel}</div>
                </div>
            `;
        const titleOverlay = document.createElement('div');
        titleOverlay.className = 'grid-item-overlay';
        const titleElement = document.createElement('div');
        titleElement.className = 'grid-item-title';
        titleElement.textContent = media.title;
        titleOverlay.appendChild(titleElement);
        if (media.variant) {
            const variantElement = document.createElement('div');
            variantElement.className = 'grid-item-variant';
            variantElement.textContent = media.variant;
            titleOverlay.appendChild(variantElement);
        }

        this.container.classList.add('media-grid-item');
        this.container.dataset.title = media.title;
        this.container.dataset.variant = media.variant || '';
        if (media.id != null) {
            this.container.dataset.mediaId = String(media.id);
        }
        if (media.tracking_status === 'Untracked') {
            delete this.container.dataset.trackingStatus;
        } else {
            this.container.dataset.trackingStatus = media.tracking_status;
        }

        const isArchived = media.status === 'Archived';
        const cardBody = document.createElement('div');
        cardBody.className = `media-grid-item-body${isArchived ? ' is-archived' : ''}`;

        cardBody.appendChild(content);
        cardBody.appendChild(titleOverlay);
        if (contentType !== 'Unknown' && contentType.trim() !== '') {
            cardBody.appendChild(html`<div class="grid-item-type-badge">${contentType}</div>`);
        }
        if (media.tracking_status !== 'Untracked') {
            const statusLed = document.createElement('div');
            statusLed.classList.add('status-led');
            const statusClass = this.getTrackingStatusClass(media.tracking_status);
            if (statusClass) statusLed.classList.add(statusClass);
            statusLed.title = `Status: ${media.tracking_status}`;
            cardBody.appendChild(statusLed);
        }
        this.container.appendChild(cardBody);
    }
}

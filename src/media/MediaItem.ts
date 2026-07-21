import { Logger } from '../logger';
import { Component } from '../component';
import { html } from '../html';
import { Media } from '../api';
import { MediaCoverLoader } from './cover_loader';

interface MediaItemState {
    media: Media;
    imgSrc: string | null;
}

export class MediaItem extends Component<MediaItemState> {
    constructor(container: HTMLElement, media: Media, onClick: () => void) {
        super(container, { media, imgSrc: null });
        this.container.addEventListener('click', onClick);
        
        // Lazy load image when visible
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.loadImage();
                observer.disconnect();
            }
        }, { rootMargin: '200px' });
        observer.observe(this.container);
    }

    private async loadImage() {
        const { cover_image } = this.state.media;
        if (!cover_image || cover_image.trim() === '') return;

        try {
            const src = await MediaCoverLoader.load(cover_image);
            if (!src) return;
            this.setState({ imgSrc: src });
        } catch (e) {
            Logger.error("Failed to load image", e);
        }
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
        const badgeHtml = (contentType !== 'Unknown' && contentType.trim() !== '')
            ? `<div class="grid-item-type-badge">${contentType}</div>`
            : '';
        const ledHtml = media.tracking_status === 'Untracked'
            ? ''
            : `<div class="status-led ${this.getTrackingStatusClass(media.tracking_status)}" title="Status: ${media.tracking_status}"></div>`;

        this.clear();

        const noImageLabel = media.cover_image ? 'Loading...' : 'No Image';
        const placeholderVariant = media.variant
            ? html`<div class="grid-item-variant">${media.variant}</div>`
            : '';
        const content = imgSrc
            ? html`<img src="${imgSrc}" class="grid-item-cover" alt="${media.title}" />`
            : html`
                <div class="image-placeholder">
                    <div>
                        <div class="grid-item-title">${media.title}</div>
                        ${placeholderVariant}
                    </div>
                    <div class="grid-item-placeholder-label">${noImageLabel}</div>
                </div>
            `;

        this.container.classList.add('media-grid-item');
        this.container.title = media.variant ? `${media.title} — ${media.variant}` : media.title;
        this.container.dataset.title = media.title;
        this.container.dataset.variant = media.variant || '';

        const isArchived = media.status === 'Archived';
        const cardBody = document.createElement('div');
        cardBody.className = `media-grid-item-body${isArchived ? ' is-archived' : ''}`;

        cardBody.appendChild(content);
        if (badgeHtml) cardBody.insertAdjacentHTML('beforeend', badgeHtml);
        if (ledHtml) cardBody.insertAdjacentHTML('beforeend', ledHtml);
        this.container.appendChild(cardBody);
    }
}

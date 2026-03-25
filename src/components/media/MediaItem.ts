import { Logger } from '../../core/logger';
import { Component } from '../../core/component';
import { html } from '../../core/html';
import { Media } from '../../api';
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
        const content = imgSrc
            ? html`<img src="${imgSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${media.title}" />`
            : html`
                <div class="image-placeholder" style="flex: 1; display: flex; flex-direction: column; padding: 1.2rem 1rem; color: var(--text-secondary); text-align: center; justify-content: space-between;">
                    <div class="grid-item-title" style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.3;">${media.title}</div>
                    <div style="font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px;">${noImageLabel}</div>
                </div>
            `;

        this.container.classList.add('media-grid-item');
        this.container.title = media.title;
        this.container.dataset.title = media.title;
        
        const isArchived = media.status === 'Archived';
        const opacity = isArchived ? '0.6' : '1';
        
        this.container.style.cssText = `cursor: pointer; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-dark); border: 1px solid var(--border-color); display: flex; flex-direction: column; height: 100%; position: relative; opacity: ${opacity};`;
        this.container.appendChild(content);
        if (badgeHtml) this.container.insertAdjacentHTML('beforeend', badgeHtml);
        if (ledHtml) this.container.insertAdjacentHTML('beforeend', ledHtml);
    }
}

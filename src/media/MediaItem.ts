import { Component } from '../component';
import { html } from '../html';
import { Media } from '../api';
import { MediaCoverLoader } from './cover_loader';
import { CoverVisibilityController } from './cover_visibility';

interface MediaItemState {
    media: Media;
    imgSrc: string | null;
}

export class MediaItem extends Component<MediaItemState> {
    private readonly ownVisibilityController: CoverVisibilityController | null;
    private readonly stopObserving: () => void;
    private isDestroyed = false;

    constructor(
        container: HTMLElement,
        media: Media,
        onClick: () => void,
        visibilityController?: CoverVisibilityController,
        eager = false,
    ) {
        super(container, {
            media,
            imgSrc: media.cover_image ? MediaCoverLoader.getCached(media.cover_image) : null,
        });
        this.container.addEventListener('click', onClick);
        const visibility = visibilityController ?? new CoverVisibilityController('240px 0px');
        this.ownVisibilityController = visibilityController ? null : visibility;
        const task = () => {
            this.loadImage().catch(() => undefined);
        };
        if (!media.cover_image || this.state.imgSrc) {
            this.stopObserving = () => undefined;
        } else if (eager) {
            visibility.loadNow(this.container, task);
            this.stopObserving = () => undefined;
        } else {
            this.stopObserving = visibility.observe(this.container, task);
        }
    }

    private async loadImage() {
        const { cover_image } = this.state.media;
        if (!cover_image || cover_image.trim() === '') return;

        const src = await MediaCoverLoader.load(cover_image);
        if (!src || this.isDestroyed) return;
        this.state.imgSrc = src;
        this.commitImage(src);
    }

    private commitImage(src: string): void {
        const existing = this.container.querySelector<HTMLImageElement>('img.media-grid-cover-image');
        if (existing) {
            if (existing.src !== src) existing.src = src;
            return;
        }

        const placeholder = this.container.querySelector<HTMLElement>('.image-placeholder');
        if (!placeholder) return;
        const image = document.createElement('img');
        image.className = 'media-grid-cover-image progressive-cover-image';
        image.alt = this.state.media.title;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
        image.src = src;
        placeholder.replaceWith(image);
        if (image.complete) requestAnimationFrame(() => image.classList.add('is-loaded'));
    }

    public override destroy(): void {
        this.isDestroyed = true;
        this.stopObserving();
        this.ownVisibilityController?.disconnect();
        super.destroy();
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
            ? html`<div class="grid-item-variant" style="margin-top: 0.35rem; font-size: 0.78rem; color: var(--text-secondary);">${media.variant}</div>`
            : '';
        const content = imgSrc
            ? html`<img class="media-grid-cover-image progressive-cover-image is-loaded" src="${imgSrc}" loading="lazy" decoding="async" alt="${media.title}" />`
            : html`
                <div class="image-placeholder" style="flex: 1; display: flex; flex-direction: column; padding: 1.2rem 1rem; color: var(--text-secondary); text-align: center; justify-content: space-between;">
                    <div>
                        <div class="grid-item-title" style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.3;">${media.title}</div>
                        ${placeholderVariant}
                    </div>
                    <div style="font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px;">${noImageLabel}</div>
                </div>
            `;

        this.container.classList.add('media-grid-item');
        this.container.title = media.variant ? `${media.title} — ${media.variant}` : media.title;
        this.container.dataset.title = media.title;
        this.container.dataset.variant = media.variant || '';
        
        const isArchived = media.status === 'Archived';
        const opacity = isArchived ? '0.6' : '1';
        
        this.container.style.cssText = `cursor: pointer; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-dark); border: 1px solid var(--border-color); display: flex; flex-direction: column; height: 100%; position: relative; opacity: ${opacity};`;
        this.container.appendChild(content);
        if (badgeHtml) this.container.insertAdjacentHTML('beforeend', badgeHtml);
        if (ledHtml) this.container.insertAdjacentHTML('beforeend', ledHtml);
    }
}

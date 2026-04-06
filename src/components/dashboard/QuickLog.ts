import { ActivitySummary, Media } from '../../api';
import { Component } from '../../core/component';
import { html, escapeHTML } from '../../core/html';
import { Logger } from '../../core/logger';
import { showLogActivityModal } from '../../modals';
import { MediaCoverLoader } from '../media/cover_loader';

interface QuickLogState {
    logs: ActivitySummary[];
    mediaList: Media[];
    coverUrls: Record<number, string>;
}

interface QuickLogProps {
    onLogged: () => Promise<void>;
}

const MAX_QUICK_LOG_ITEMS = 5;

export class QuickLog extends Component<QuickLogState> {
    private readonly props: QuickLogProps;
    private readonly attemptedCoverIds = new Set<number>();

    constructor(container: HTMLElement, initialState: Omit<QuickLogState, 'coverUrls'>, props: QuickLogProps) {
        super(container, { ...initialState, coverUrls: {} });
        this.props = props;
    }

    render() {
        this.clear();

        const items = this.getSortedMedia();
        const content = html`
            <div class="card quick-log-card" style="display: flex; flex-direction: column; gap: 0.9rem; min-height: 0;">
                <h3 style="color: var(--text-secondary); font-size: 1.1rem; margin: 0;">Quick Log</h3>
                <div id="quick-log-list" style="display: flex; flex-direction: column; gap: 0.2rem;"></div>
            </div>
        `;

        const list = content.querySelector<HTMLElement>('#quick-log-list')!;
        if (items.length === 0) {
            list.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; padding: 0.25rem 0;">No loggable media yet.</div>';
        } else {
            list.innerHTML = items.map(media => this.renderItem(media)).join('');
            list.querySelectorAll<HTMLElement>('[data-quick-log-media-id]').forEach(node => {
                node.addEventListener('click', () => {
                    const mediaId = Number.parseInt(node.dataset.quickLogMediaId || '', 10);
                    const media = items.find(entry => entry.id === mediaId);
                    if (!media) return;

                    this.openQuickLog(media).catch(error => {
                        Logger.error('Failed to open Quick Log activity modal', error);
                    });
                });
            });
        }

        this.container.appendChild(content);
        this.ensureCoverUrls(items).catch(error => {
            Logger.error('Failed to prepare Quick Log cover images', error);
        });
    }

    private getSortedMedia(): Media[] {
        const latestLogIdByMedia = new Map<number, number>();
        for (const log of this.state.logs) {
            const previous = latestLogIdByMedia.get(log.media_id) || 0;
            if (log.id > previous) {
                latestLogIdByMedia.set(log.media_id, log.id);
            }
        }

        return this.state.mediaList
            .filter(media => media.id && media.status !== 'Archived')
            .sort((left, right) => {
                const leftCompleteRank = left.tracking_status === 'Complete' ? 1 : 0;
                const rightCompleteRank = right.tracking_status === 'Complete' ? 1 : 0;
                if (leftCompleteRank !== rightCompleteRank) {
                    return leftCompleteRank - rightCompleteRank;
                }

                const leftLatestLogId = latestLogIdByMedia.get(left.id!) || 0;
                const rightLatestLogId = latestLogIdByMedia.get(right.id!) || 0;
                if (leftLatestLogId !== rightLatestLogId) {
                    return rightLatestLogId - leftLatestLogId;
                }

                return left.title.localeCompare(right.title);
            })
            .slice(0, MAX_QUICK_LOG_ITEMS);
    }

    private renderItem(media: Media): string {
        const coverUrl = media.id ? this.state.coverUrls[media.id] : '';
        const contentType = (media.content_type || media.media_type || 'Unknown').trim() || 'Unknown';
        const placeholderLabel = media.cover_image ? 'Loading' : 'No Image';
        const coverHtml = coverUrl
            ? `<img src="${escapeHTML(coverUrl)}" alt="${escapeHTML(media.title)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />`
            : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;">${placeholderLabel}</div>`;

        return `
            <button
                type="button"
                class="quick-log-item"
                data-quick-log-media-id="${media.id}"
                style="display: grid; grid-template-columns: 2.8rem minmax(0, 1fr); gap: 0.7rem; align-items: center; width: 100%; padding: 0.35rem 0; border: none; background: transparent; color: inherit; cursor: pointer; text-align: left;"
            >
                <div class="quick-log-cover" style="width: 2.8rem; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 8px;">
                    ${coverHtml}
                </div>
                <div class="quick-log-copy" style="display: flex; flex-direction: column; min-width: 0; gap: 0.18rem;">
                    <div class="quick-log-title" style="font-size: 0.84rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; line-height: 1.2;">${escapeHTML(media.title)}</div>
                    <div class="quick-log-type" style="font-size: 0.74rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(contentType)}</div>
                </div>
            </button>
        `;
    }

    private async ensureCoverUrls(items: Media[]): Promise<void> {
        await Promise.all(items.map(async media => {
            if (!media.id || !media.cover_image || this.state.coverUrls[media.id] || this.attemptedCoverIds.has(media.id)) {
                return;
            }

            this.attemptedCoverIds.add(media.id);
            try {
                const src = await MediaCoverLoader.load(media.cover_image);
                if (!src) return;
                this.setState({
                    coverUrls: {
                        ...this.state.coverUrls,
                        [media.id]: src,
                    }
                });
            } catch (error) {
                Logger.error('Failed to load Quick Log cover image', error);
            }
        }));
    }

    private async openQuickLog(media: Media): Promise<void> {
        const success = await showLogActivityModal(media.title);
        if (!success) {
            return;
        }

        await this.props.onLogged();
    }
}
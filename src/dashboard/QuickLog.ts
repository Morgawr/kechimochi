import { ActivitySummary, Media } from '../api';
import { Component } from '../component';
import { html, escapeHTML } from '../html';
import { Logger } from '../logger';
import { showLogActivityModal } from '../activity_modal';
import { EVENTS } from '../constants';
import { MediaCoverLoader } from '../media/cover_loader';

interface QuickLogState {
    logs: ActivitySummary[];
    mediaList: Media[];
    coverUrls: Record<number, string>;
}

interface QuickLogProps {
    onLogged: () => Promise<void>;
}

const MAX_QUICK_LOG_ITEMS = 6;

export class QuickLog extends Component<QuickLogState> {
    private readonly props: QuickLogProps;
    private readonly attemptedCoverIds = new Set<number>();
    private static readonly LONG_PRESS_MS = 420;

    constructor(container: HTMLElement, initialState: Omit<QuickLogState, 'coverUrls'>, props: QuickLogProps) {
        super(container, { ...initialState, coverUrls: {} });
        this.props = props;
    }

    render() {
        this.clear();

        const items = this.getSortedMedia();
        const content = html`
            <div class="card quick-log-card" style="display: flex; flex-direction: column; gap: 0.9rem; min-height: 0;">
                <h3 class="dashboard-module-title">Quick Log</h3>
                <div id="quick-log-list" style="display: flex; flex-direction: column; gap: 0.2rem;"></div>
            </div>
        `;

        const list = content.querySelector<HTMLElement>('#quick-log-list')!;
        if (items.length === 0) {
            list.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; padding: 0.25rem 0;">No loggable media yet.</div>';
        } else {
            list.innerHTML = items.map(media => this.renderItem(media)).join('');
            list.querySelectorAll<HTMLElement>('[data-quick-log-media-id]').forEach(node => {
                const mediaId = Number.parseInt(node.dataset.quickLogMediaId || '', 10);
                const media = items.find(entry => entry.id === mediaId);
                if (!media) return;

                this.attachQuickLogInteractions(node, media);
            });

            list.querySelectorAll<HTMLElement>('[data-quick-log-open-media-id]').forEach(node => {
                node.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const mediaId = Number.parseInt(node.dataset.quickLogOpenMediaId || '', 10);
                    if (!Number.isFinite(mediaId)) return;
                    this.navigateToMediaDetail(mediaId);
                });
            });
        }

        this.container.appendChild(content);
        this.ensureCoverUrls(items).catch(error => {
            Logger.error('Failed to prepare Quick Log cover images', error);
        });
    }

    private getSortedMedia(): Media[] {
        const latestLogByMedia = new Map<number, { date: string; id: number }>();
        for (const log of this.state.logs) {
            const previous = latestLogByMedia.get(log.media_id);
            if (!previous || this.compareLogRecency(log, previous) > 0) {
                latestLogByMedia.set(log.media_id, { date: log.date, id: log.id });
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

                const leftLatestLog = latestLogByMedia.get(left.id!);
                const rightLatestLog = latestLogByMedia.get(right.id!);
                const leftLatestDate = leftLatestLog?.date || '';
                const rightLatestDate = rightLatestLog?.date || '';
                if (leftLatestDate !== rightLatestDate) {
                    return this.compareDateRecency(rightLatestDate, leftLatestDate);
                }

                const leftLatestLogId = leftLatestLog?.id || 0;
                const rightLatestLogId = rightLatestLog?.id || 0;
                if (leftLatestLogId !== rightLatestLogId) {
                    return rightLatestLogId - leftLatestLogId;
                }

                return left.title.localeCompare(right.title);
            })
            .slice(0, MAX_QUICK_LOG_ITEMS);
    }

    private compareLogRecency(left: { date: string; id: number }, right: { date: string; id: number }): number {
        const dateComparison = this.compareDateRecency(left.date, right.date);
        if (dateComparison !== 0) {
            return dateComparison;
        }
        return left.id - right.id;
    }

    private compareDateRecency(left: string, right: string): number {
        const leftTime = Date.parse(left);
        const rightTime = Date.parse(right);
        if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
            return leftTime - rightTime;
        }
        return left.localeCompare(right);
    }

    private renderItem(media: Media): string {
        const coverUrl = media.id ? this.state.coverUrls[media.id] : '';
        const contentType = (media.content_type || media.media_type || 'Unknown').trim() || 'Unknown';
        const variant = (media.variant || '').trim();
        const secondaryLabel = variant && variant.toLowerCase() !== contentType.toLowerCase()
            ? `${contentType} · ${variant}`
            : variant || contentType;
        const placeholderLabel = media.cover_image ? 'Loading' : 'No Image';
        const isMobileApp = document.body.dataset.runtime === 'mobile-app';
        const coverHtml = coverUrl
            ? `<img src="${escapeHTML(coverUrl)}" alt="${escapeHTML(media.title)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />`
            : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;">${placeholderLabel}</div>`;

        return `
            <div
                class="quick-log-item"
                data-quick-log-media-id="${media.id}"
                data-quick-log-title="${escapeHTML(media.title)}"
                role="button"
                tabindex="0"
                style="position: relative; display: grid; grid-template-columns: 2.8rem minmax(0, 1fr) auto; gap: 0.7rem; align-items: center; width: 100%; padding: 0.45rem 0; border: none; background: transparent; color: inherit; cursor: pointer; text-align: left;"
            >
                <div class="quick-log-cover" style="width: 2.8rem; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 8px;">
                    ${coverHtml}
                    <button class="cover-action"
                        data-quick-log-open-media-id="${media.id}">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path
                                d="M8 5L16 12L8 19"
                                stroke="white"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </button>
                </div>
                <div class="quick-log-copy" style="display: flex; flex-direction: column; min-width: 0; gap: 0.18rem;">
                    <div class="quick-log-title" style="font-size: 0.84rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; line-height: 1.2;">${escapeHTML(media.title)}</div>
                    <div class="quick-log-second-row">
                        <div class="quick-log-type" style="font-size: 0.74rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(secondaryLabel)}</div>
                        <button
                            type="button"
                            class="quick-log-shortcut-btn"
                            data-quick-log-open-media-id="${media.id}"
                            title="Open media details"
                            aria-label="Open ${escapeHTML(media.title)} details"
                            style="display: ${isMobileApp ? 'none' : 'inline-flex'}; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--border-color); background: color-mix(in srgb, var(--bg-card) 82%, transparent); color: var(--text-secondary); cursor: pointer; transition: background-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"/>
                                <path d="m12 5 7 7-7 7"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
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
        globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED));
    }

    private navigateToMediaDetail(mediaId: number): void {
        globalThis.dispatchEvent(new CustomEvent(EVENTS.APP_NAVIGATE, {
            detail: { view: 'media', focusMediaId: mediaId, source: 'dashboard' }
        }));
    }

    private attachQuickLogInteractions(node: HTMLElement, media: Media): void {
        const isMobileApp = document.body.dataset.runtime === 'mobile-app';
        let longPressTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        let suppressClick = false;

        node.addEventListener('click', () => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }

            this.openQuickLog(media).catch(error => {
                Logger.error('Failed to open Quick Log activity modal', error);
            });
        });

        node.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openQuickLog(media).catch(error => {
                    Logger.error('Failed to open Quick Log activity modal', error);
                });
            }
        });

        if (!isMobileApp) {
            return;
        }

        const clearLongPress = () => {
            if (!longPressTimer) return;
            globalThis.clearTimeout(longPressTimer);
            longPressTimer = null;
        };

        node.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse') return;
            clearLongPress();
            longPressTimer = globalThis.setTimeout(() => {
                suppressClick = true;
                longPressTimer = null;
                this.navigateToMediaDetail(media.id!);
            }, QuickLog.LONG_PRESS_MS);
        });

        node.addEventListener('pointerup', clearLongPress);
        node.addEventListener('pointercancel', clearLongPress);
        node.addEventListener('pointerleave', clearLongPress);
    }
}

import { Logger } from '../../core/logger';
import { Component } from '../../core/component';
import { html, escapeHTML, rawHtml } from '../../core/html';
import { Media, ActivitySummary, Milestone, updateMedia, deleteMedia, getSetting, getMilestones, addMilestone, deleteMilestone, clearMilestones, getLogsForMedia, readFileBytes, downloadAndSaveImage } from '../../api';
import { customAlert, customConfirm, customPrompt, showJitenSearchModal, showImportMergeModal, showAddMilestoneModal, showLogActivityModal } from '../../modals';
import { isValidImporterUrl, fetchMetadataForUrl } from '../../importers';
import { getServices } from '../../services';
import { MediaLog } from './MediaLog';
import { setupCopyButton } from '../../utils/clipboard';
import { getCharacterCountFromExtraData, mergeExtraData, normalizeExtraData, removeExtraDataKey, renameExtraDataKey, upsertExtraDataValue } from '../../utils/extra_data';
import { formatHhMm } from '../../utils/time';
import { TRACKING_STATUSES, ACTIVITY_TYPES, MEDIA_STATUS, CONTENT_TYPE_TO_ACTIVITY_TYPE } from '../../constants';

interface MediaDetailState {
    media: Media;
    logs: ActivitySummary[];
    milestones: Milestone[];
    imgSrc: string | null;
    isDescriptionExpanded: boolean;
}

export class MediaDetail extends Component<MediaDetailState> {
    private static readonly DESCRIPTION_COLLAPSE_CHAR_LIMIT = 420;
    private static readonly DESCRIPTION_COLLAPSE_NEWLINE_LIMIT = 4;
    private readonly onBack: () => void;
    private readonly onNext: () => void;
    private readonly onPrev: () => void;
    private readonly onNavigate: (index: number) => void;
    private readonly onDelete: () => void;
    private readonly mediaList: Media[];
    private readonly currentIndex: number;
    private readonly onViewportResize: () => void;
    private readonly onGlobalPointerDown: (event: PointerEvent) => void;
    private readonly onGlobalKeyDown: (event: KeyboardEvent) => void;
    private currentObjectUrl: string | null = null;
    private isDestroyed = false;
    private overflowMenuRoot: HTMLElement | null = null;
    private overflowMenu: HTMLElement | null = null;
    private overflowMenuButton: HTMLButtonElement | null = null;

    constructor(container: HTMLElement, media: Media, logs: ActivitySummary[], mediaList: Media[], currentIndex: number, callbacks: { onBack: () => void, onNext: () => void, onPrev: () => void, onNavigate: (index: number) => void, onDelete: () => void }) {
        super(container, { media, logs, milestones: [], imgSrc: null, isDescriptionExpanded: false });
        this.mediaList = mediaList;
        this.currentIndex = currentIndex;
        this.onBack = callbacks.onBack;
        this.onNext = callbacks.onNext;
        this.onPrev = callbacks.onPrev;
        this.onNavigate = callbacks.onNavigate;
        this.onDelete = callbacks.onDelete;
        this.onViewportResize = () => this.syncViewportLayout();
        this.onGlobalPointerDown = (event: PointerEvent) => this.handleGlobalPointerDown(event);
        this.onGlobalKeyDown = (event: KeyboardEvent) => this.handleGlobalKeyDown(event);
        globalThis.addEventListener('resize', this.onViewportResize);
        globalThis.addEventListener('pointerdown', this.onGlobalPointerDown, true);
        globalThis.addEventListener('keydown', this.onGlobalKeyDown);
    }

    protected override onMount() {
        this.loadImage().catch(e => Logger.error("Failed to load image", e));
        this.loadMilestones().catch(e => Logger.error("Failed to load milestones", e));
    }

    public override destroy() {
        this.isDestroyed = true;
        globalThis.removeEventListener('resize', this.onViewportResize);
        globalThis.removeEventListener('pointerdown', this.onGlobalPointerDown, true);
        globalThis.removeEventListener('keydown', this.onGlobalKeyDown);
        this.revokeCurrentObjectUrl();
        super.destroy();
    }

    private async loadMilestones() {
        try {
            const milestones = await getMilestones(this.state.media.title);
            if (!this.isDestroyed) {
                this.setState({ milestones });
            }
        } catch (e) {
            Logger.error("Failed to load milestones", e);
        }
    }

    private async loadImage() {
        const { cover_image } = this.state.media;
        if (!cover_image || cover_image.trim() === '') {
            this.revokeCurrentObjectUrl();
            if (this.state.imgSrc !== null && !this.isDestroyed) {
                this.setState({ imgSrc: null });
            }
            return;
        }

        let src: string | null;
        if (getServices().isDesktop()) {
            const bytes = await readFileBytes(cover_image);
            const blob = new Blob([new Uint8Array(bytes)]);
            src = URL.createObjectURL(blob);
            this.revokeCurrentObjectUrl();
            this.currentObjectUrl = src;
        } else {
            src = await getServices().loadCoverImage(cover_image);
        }
        if (src && !this.isDestroyed) this.setState({ imgSrc: src });
    }

    private revokeCurrentObjectUrl() {
        if (!this.currentObjectUrl) return;
        URL.revokeObjectURL(this.currentObjectUrl);
        this.currentObjectUrl = null;
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

    private shouldCollapseDescription(description: string | undefined): boolean {
        if (!description) return false;
        const newlineCount = (description.match(/\n/g) || []).length;
        return description.length > MediaDetail.DESCRIPTION_COLLAPSE_CHAR_LIMIT
            || newlineCount >= MediaDetail.DESCRIPTION_COLLAPSE_NEWLINE_LIMIT;
    }

    private getDescriptionViewModel(description: string | undefined, isExpanded: boolean) {
        const hasLongDescription = this.shouldCollapseDescription(description);
        const isCollapsed = hasLongDescription && !isExpanded;

        return {
            content: description || 'No description provided. Double click here to add one.',
            hasLongDescription,
            shellClassName: isCollapsed ? 'media-description-shell is-collapsed' : 'media-description-shell',
            descriptionClassName: isCollapsed ? 'media-description-content is-collapsed' : 'media-description-content',
            toggleClassName: isExpanded ? 'media-description-toggle is-expanded' : 'media-description-toggle',
            toggleLabel: isExpanded ? 'see less' : 'see more',
            ariaExpanded: isExpanded ? 'true' : 'false'
        };
    }

    private renderDescriptionCard(media: Media, isExpanded: boolean): HTMLElement {
        const descriptionView = this.getDescriptionViewModel(media.description, isExpanded);

        return html`
            <div class="card" style="display: flex; flex-direction: column; gap: 0.5rem;">
                <h4 style="margin: 0; color: var(--text-secondary);">Description</h4>
                <div class="${descriptionView.shellClassName}">
                    <div
                        id="media-description"
                        class="${descriptionView.descriptionClassName}"
                        title="Double click to edit description"
                        style="cursor: pointer; white-space: pre-wrap;"
                    >${descriptionView.content}</div>
                    ${descriptionView.hasLongDescription ? html`
                        <button
                            type="button"
                            class="${descriptionView.toggleClassName}"
                            id="media-description-toggle"
                            aria-expanded="${descriptionView.ariaExpanded}"
                        >${descriptionView.toggleLabel}</button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    render() {
        this.clear();
        const { media, imgSrc, logs, isDescriptionExpanded } = this.state;

        const detailView = html`
            <div class="animate-fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 1rem;" id="media-root">
                <!-- Header Controls -->
                <div id="media-detail-header" style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; background: var(--bg-dark); padding: 0.5rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div id="media-back-slot" style="flex: 1; display: flex; justify-content: flex-start;">
                        <button class="btn btn-ghost" id="btn-back-grid" style="font-size: 0.9rem; padding: 0.4rem 0.8rem; display: flex; align-items: center; gap: 0.3rem;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Library</button>
                    </div>
                    
                    <div id="media-detail-nav" style="display: flex; justify-content: center; align-items: center; gap: 1rem;">
                        <button class="btn btn-ghost" id="media-prev" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&lt;&lt;</button>
                        <div id="media-title-group" style="position: relative; display: flex; align-items: center; gap: 0.45rem; min-width: 0;">
                            <select id="media-select" style="flex: 1 1 auto; min-width: 0; max-width: 800px; text-align: center; border: none; background: transparent; font-size: 1.1rem; color: var(--text-primary); outline: none; appearance: none; cursor: pointer; text-align-last: center; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                                ${rawHtml(this.mediaList.map((m, i) => `<option value="${i}" ${i === this.currentIndex ? 'selected' : ''}>${escapeHTML(m.title)}</option>`).join(''))}
                            </select>
                            <div id="media-overflow-root" style="position: relative; flex: 0 0 auto;">
                                <button
                                    type="button"
                                    class="btn btn-ghost"
                                    id="btn-media-overflow"
                                    aria-haspopup="menu"
                                    aria-expanded="false"
                                    title="More actions"
                                    style="width: 2.4rem; height: 2.4rem; padding: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.3rem; line-height: 1;"
                                >⋯</button>
                                <div id="media-overflow-menu" hidden style="position: absolute; top: calc(100% + 0.5rem); right: 0; min-width: 12rem; padding: 0.35rem; border: 1px solid var(--border-color); border-radius: 12px; background: color-mix(in srgb, var(--bg-card) 94%, black 6%); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); z-index: 20;">
                                    <button
                                        type="button"
                                        id="btn-delete-media-detail"
                                        style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.7rem; border: none; border-radius: 9px; background: transparent; color: #ff7582; font: inherit; font-size: 0.9rem; text-align: left; cursor: pointer;"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                                        Delete media
                                    </button>
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-ghost" id="media-next" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&gt;&gt;</button>
                    </div>
                </div>

                <!-- Main Content -->
                <div id="media-content-area" style="display: flex; gap: 2rem; flex: 1; overflow: hidden;">
                    <!-- Left Column: Cover -->
                    <div id="media-cover-column" style="flex: 0 0 300px; display: flex; flex-direction: column; min-height: 0;">
                        ${imgSrc
                ? html`<img src="${imgSrc}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: var(--radius-md); cursor: pointer;" id="media-cover-img" alt="Cover" title="Double click to change image" />`
                : html`<div style="width: 100%; aspect-ratio: 2/3; background: var(--bg-dark); border: 2px dashed var(--border-color); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary);" id="media-cover-img" title="Double click to add image">No Image</div>`
            }
                        <div id="media-milestones-slot-left">
                            <!-- Milestones -->
                            <div id="media-milestones-card" class="card" style="margin-top: 1.5rem; padding: 0.5rem; display: flex; flex-direction: column; border: 1px solid var(--border-color); flex: 1; min-height: 0;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0 0.2rem;">
                                    <h4 style="margin: 0; color: var(--text-secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">Milestones</h4>
                                    <button class="btn btn-ghost" id="btn-add-milestone" style="padding: 0.15rem 0.4rem; font-size: 0.65rem; border-radius: 4px;">+ Add</button>
                                </div>
                                <div id="milestone-list-container" style="display: flex; flex-direction: column; gap: 0.3rem; flex: 1; min-height: 0; overflow-y: auto;">
                                    ${rawHtml(this.renderMilestones())}
                                </div>
                                ${this.state.milestones.length > 0 ? html`
                                    <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05);">
                                        <button class="btn btn-ghost" id="btn-clear-milestones" style="padding: 0.2rem 0.4rem; font-size: 0.6rem; border-radius: 4px; color: var(--accent-red); opacity: 0.6; font-weight: 500;">Delete all milestones</button>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Details -->
                    <div id="media-detail-column" style="flex: 1; display: flex; flex-direction: column; gap: 1rem; min-height: 0;">
                        <div>
                            <div style="display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap;">
                                <h1 id="media-title" title="Double click to edit title" style="margin: 0; font-size: 2rem; cursor: pointer;">${media.title}</h1>
                                <button class="copy-btn" id="btn-copy-title" title="Copy Title" style="margin-bottom: 3px;">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                </button>
                            </div>
                            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center; flex-wrap: wrap;">
                                <select class="badge badge-select ${this.getTrackingStatusClass(media.tracking_status)}" id="media-tracking-status" title="Click to edit tracking status">
                                    ${rawHtml(TRACKING_STATUSES.map(opt => `<option value="${opt}" ${opt === media.tracking_status ? 'selected' : ''}>${opt}</option>`).join(''))}
                                </select>
                                <select class="badge badge-select" id="media-type" title="Click to edit default activity type">
                                    ${rawHtml(ACTIVITY_TYPES.map(opt => `<option value="${opt}" ${opt === media.media_type ? 'selected' : ''}>${opt}</option>`).join(''))}
                                </select>
                                <select class="badge badge-select badge-content" id="media-content-type" title="Click to edit content type">
                                    ${rawHtml(this.getContentTypeOptions(media))}
                                </select>
                                <span class="badge" style="background: var(--bg-card-hover); color: var(--text-secondary);">${media.language}</span>
                                <span class="badge" style="background: var(--bg-card-hover); color: var(--text-secondary); border: 1px solid var(--border-color); display: flex; align-items: center; gap: 0.5rem; padding: 0.2rem 0.6rem;">
                                    <label class="switch">
                                        <input type="checkbox" id="status-toggle" ${this.isActive(media.status) ? 'checked' : ''}>
                                        <span class="slider"></span>
                                    </label>
                                    <span id="status-label" style="font-weight: 600; font-size: 0.75rem; text-transform: uppercase;">${this.isActive(media.status) ? MEDIA_STATUS.ACTIVE : MEDIA_STATUS.ARCHIVED}</span>
                                </span>
                                <button class="btn btn-ghost" id="btn-search-jiten" style="padding: 0.2rem 0.8rem; font-size: 0.75rem; border-color: var(--accent-purple); color: var(--accent-purple); border-radius: 12px; height: 1.6rem; margin-left: 0.5rem;">Search on Jiten.moe</button>
                                ${media.tracking_status === 'Complete' ? '' : html`<button class="btn btn-ghost" id="btn-mark-complete" style="padding: 0.2rem 0.8rem; font-size: 0.75rem; border-color: var(--accent-green); color: var(--accent-green); border-radius: 12px; height: 1.6rem; margin-left: 0.5rem;">Mark as complete</button>`}
                            </div>
                        </div>

                        ${this.renderDescriptionCard(media, isDescriptionExpanded)}

                        <!-- Stats & Extra Fields -->
                        <div id="media-stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                            <div class="card" id="media-first-last-stats" style="grid-column: span 3; display: none; justify-content: flex-start; gap: 2rem; padding: 0.5rem 1rem; font-size: 0.85rem;"></div>
                            ${rawHtml(this.getExtraDataHtml(media))}
                        </div>

                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button class="btn btn-ghost" id="btn-add-extra" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">+ Add Extra Field</button>
                            <button class="btn btn-ghost btn-meta-fetch" id="btn-import-meta" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Fetch Metadata from URL</button>
                            <button class="btn btn-ghost btn-meta-clear" id="btn-clear-meta" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Clear Metadata</button>
                        </div>

                        <div id="media-milestones-slot-main"></div>

                        <!-- Activity Logs -->
                        <div class="card" style="margin-top: 1rem; flex: 1; display: flex; flex-direction: column; min-height: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                                <h4 style="margin: 0; color: var(--text-secondary);">Recent Activity</h4>
                                <button class="btn btn-ghost" id="btn-new-media-entry" style="padding: 0.2rem 0.6rem; font-size: 0.75rem; border-radius: 6px; color: var(--accent-green); border-color: var(--accent-green);">+ New Entry</button>
                            </div>
                            <div id="media-logs-container" style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1; overflow-y: auto;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(detailView);
        this.syncOverflowMenuRefs();
        this.syncViewportLayout();
        this.setupListeners(detailView);
        this.renderStats(detailView);

        const logsContainer = detailView.querySelector('#media-logs-container') as HTMLElement;
        new MediaLog(logsContainer, logs).render();

        logsContainer.addEventListener('activity-updated', async () => {
            if (this.state.media.id) {
                const updatedLogs = await getLogsForMedia(this.state.media.id);
                this.setState({ logs: updatedLogs });
            }
        });
    }

    private placeMilestonesCard() {
        const card = this.container.querySelector<HTMLElement>('#media-milestones-card');
        const leftSlot = this.container.querySelector<HTMLElement>('#media-milestones-slot-left');
        const mainSlot = this.container.querySelector<HTMLElement>('#media-milestones-slot-main');
        if (!card || !leftSlot || !mainSlot) return;

        const useMainColumn = globalThis.matchMedia('(max-width: 1024px)').matches;
        const activeSlot = useMainColumn ? mainSlot : leftSlot;
        const inactiveSlot = useMainColumn ? leftSlot : mainSlot;

        activeSlot.appendChild(card);
        activeSlot.style.display = 'flex';
        activeSlot.style.flexDirection = 'column';
        activeSlot.style.flex = '1';
        activeSlot.style.minHeight = '0';

        inactiveSlot.style.display = 'none';
        inactiveSlot.style.flex = '';
    }

    private syncOverflowMenuRefs() {
        this.overflowMenuRoot = this.container.querySelector<HTMLElement>('#media-overflow-root');
        this.overflowMenu = this.container.querySelector<HTMLElement>('#media-overflow-menu');
        this.overflowMenuButton = this.container.querySelector<HTMLButtonElement>('#btn-media-overflow');
    }

    private closeOverflowMenu() {
        if (this.overflowMenu) this.overflowMenu.hidden = true;
        if (this.overflowMenuButton) this.overflowMenuButton.setAttribute('aria-expanded', 'false');
    }

    private toggleOverflowMenu() {
        if (!this.overflowMenu || !this.overflowMenuButton) return;
        const nextOpen = this.overflowMenu.hidden;
        this.overflowMenu.hidden = !nextOpen;
        this.overflowMenuButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    }

    private handleGlobalPointerDown(event: PointerEvent) {
        if (!this.overflowMenu || !this.overflowMenuButton || this.overflowMenu.hidden) return;
        const target = event.target as Node | null;
        if (!target || !this.overflowMenuRoot?.contains(target)) {
            this.closeOverflowMenu();
        }
    }

    private handleGlobalKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape') return;
        this.closeOverflowMenu();
    }

    private syncViewportLayout() {
        this.placeMilestonesCard();
        this.adjustDesktopCoverSize();
    }

    private adjustDesktopCoverSize() {
        const coverEl = this.container.querySelector<HTMLElement>('#media-cover-img');
        if (!coverEl) return;

        const isDesktop = globalThis.matchMedia('(min-width: 1025px)').matches;
        if (isDesktop) {
            coverEl.style.height = '';
            coverEl.style.width = '100%';
            coverEl.style.aspectRatio = '2 / 3';
            coverEl.style.objectFit = 'cover';
        } else {
            coverEl.style.height = '';
            coverEl.style.width = '';
            coverEl.style.maxWidth = '';
            coverEl.style.margin = '';
            coverEl.style.aspectRatio = '';
        }
    }

    private renderMilestones(): string {
        if (this.state.milestones.length === 0) {
            return `<div style="text-align: center; color: var(--text-secondary); padding: 0.5rem; font-size: 0.75rem; opacity: 0.6;">No milestones yet.</div>`;
        }

        return this.state.milestones.map(m => {
            const dateHover = m.date ? `title="Achieved on ${m.date}"` : '';
            return `
                <div class="milestone-item" data-milestone-name="${escapeHTML(m.name)}" ${dateHover} style="display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; background: rgba(255,255,255,0.03); border-radius: 3px; border: 1px solid rgba(255,255,255,0.05); position: relative;">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 0.05rem;">
                        <span style="font-weight: 600; font-size: 0.8rem; line-height: 1.1;">${escapeHTML(m.name)}</span>
                        <span style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">
                            ${m.duration > 0 ? formatHhMm(m.duration) : ''}${(m.duration > 0 && m.characters > 0) ? ' • ' : ''}${m.characters > 0 ? `${m.characters.toLocaleString()} chars` : ''}
                        </span>
                    </div>
                    <button class="delete-milestone-btn" data-id="${m.id}" style="background: transparent; border: none; color: var(--accent-red); cursor: pointer; padding: 0.15rem; display: flex; align-items: center; justify-content: center; opacity: 0.4; transition: opacity 0.2s;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                    </button>
                </div>
            `;
        }).join('');
    }

    private isActive(status: string): boolean {
        return status !== MEDIA_STATUS.ARCHIVED;
    }

    private getContentTypeOptions(media: Media): string {
        const validOptions = ['Unknown', 'Visual Novel', 'Manga', 'Novel', 'WebNovel', 'NonFiction', 'Videogame', 'Audio', 'Anime', 'Movie', 'Youtube Video', 'Livestream', 'Drama'];
        return validOptions.map(opt => `<option value="${opt}" ${opt === media.content_type ? 'selected' : ''}>${opt}</option>`).join('');
    }

    private getExtraDataHtml(media: Media) {
        let extraData: Record<string, string> = {};
        try {
            extraData = normalizeExtraData(JSON.parse(media.extra_data || "{}"));
        } catch (e) {
            Logger.warn("Could not parse extra data", e);
        }

        const sortedEntries = Object.entries(extraData).sort((a, b) => {
            const aIsSource = a[0].toLowerCase().includes("source");
            const bIsSource = b[0].toLowerCase().includes("source");
            if (aIsSource && !bIsSource) return -1;
            if (!aIsSource && bIsSource) return 1;
            return 0;
        });

        return sortedEntries.map(([k, v]) => {
            const isSourceUrl = k.toLowerCase().includes('source') && typeof v === 'string' && v.startsWith('http') && isValidImporterUrl(v, media.content_type || "Unknown");
            let refreshBtn = '';
            if (isSourceUrl) {
                refreshBtn = `<div class="refresh-extra-btn" data-url="${v}" data-key="${k}" title="Refresh Metadata" style="position: absolute; bottom: 0.5rem; right: 0.5rem; cursor: pointer; color: var(--accent-purple); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--bg-dark);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                </div>`;
            }

            return `
                <div class="card" style="padding: 0.5rem 1rem; position: relative;" data-ekey="${k}">
                    <div class="editable-extra-key" data-key="${k}" title="Double click to rename field" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; cursor: pointer;">${k}</div>
                    <div class="editable-extra" data-key="${k}" title="Double click to edit" style="cursor: pointer; font-weight: 500;">${v || '-'}</div>
                    <div class="delete-extra-btn" data-key="${k}" title="Delete field" style="position: absolute; top: 0.5rem; right: 0.5rem; cursor: pointer; color: var(--accent-red); font-size: 0.8rem; font-weight: bold; opacity: 0.6;">&times;</div>
                    ${refreshBtn}
                </div>
            `;
        }).join('');
    }

    private async computeReadingSpeedHtml(media: Media, readingMin: number): Promise<string> {
        try {
            const extra = JSON.parse(media.extra_data || "{}");
            const charCount = getCharacterCountFromExtraData(extra);
            if (charCount === null || charCount <= 0) return "";
            if (readingMin <= 0) return "";

            if (media.tracking_status === 'Complete') {
                const speed = Math.round(charCount / (readingMin / 60));
                return `<span style="margin-left: 2rem; color: var(--accent-yellow); font-weight: 800; border: 1px solid var(--accent-yellow); padding: 0.2rem 0.6rem; border-radius: 4px; background: rgba(0,0,0,0.2);">Est. Reading Speed: <strong style="color: var(--text-primary);">${speed.toLocaleString()} char/hr</strong></span>`;
            }

            let speedKey = "";
            if (media.content_type === "Novel") speedKey = "stats_novel_speed";
            else if (media.content_type === "Manga") speedKey = "stats_manga_speed";
            else if (media.content_type === "Visual Novel") speedKey = "stats_vn_speed";
            if (!speedKey) return "";

            const avgSpeedStr = await getSetting(speedKey);
            const avgSpeed = Number.parseInt(avgSpeedStr || "0", 10);
            if (avgSpeed <= 0) return "";

            const estTotalMin = (charCount / avgSpeed) * 60;
            const totalEstTotalMin = Math.round(estTotalMin);
            const estRemainingMin = Math.max(0, totalEstTotalMin - readingMin);
            const completionRate = Math.min(100, Math.round((readingMin / estTotalMin) * 100));
            const remStr = formatHhMm(estRemainingMin);
            const totalEstStr = formatHhMm(totalEstTotalMin);

            return `
                <span id="est-remaining-time" style="margin-left: 2rem; color: var(--accent-yellow); font-weight: 800; border: 1px solid var(--accent-yellow); padding: 0.2rem 0.6rem; border-radius: 4px; background: rgba(0,0,0,0.2);">Est. remaining time: <strong style="color: var(--text-primary);">${remStr}</strong> (<strong style="color: var(--text-primary);">${totalEstStr}</strong> total)</span>
                <span id="est-completion-rate" style="margin-left: 1rem; color: var(--accent-yellow); font-weight: 800; border: 1px solid var(--accent-yellow); padding: 0.2rem 0.6rem; border-radius: 4px; background: rgba(0,0,0,0.2);">Est. completion rate: <strong style="color: var(--text-primary);">${completionRate}%</strong></span>
            `;
        } catch (e) {
            Logger.warn("Could not compute reading speed stats", e);
            return "";
        }
    }

    private async renderStats(root: HTMLElement) {
        const statsDiv = root.querySelector('#media-first-last-stats') as HTMLElement;
        const { logs, media } = this.state;
        if (!statsDiv || logs.length === 0) return;

        statsDiv.style.display = 'flex';
        statsDiv.style.alignItems = 'center';

        const lastLogDate = logs[0].date;
        const firstLogDate = logs[logs.length - 1].date;
        const totalMin = logs.reduce((acc, log) => acc + log.duration_minutes, 0);
        const totalChars = logs.reduce((acc, log) => acc + log.characters, 0);
        const totalStr = formatHhMm(totalMin);

        // Determine verb from the most common activity type across logs
        const typeCounts = new Map<string, number>();
        for (const log of logs) {
            const t = log.media_type || media.media_type;
            typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
        }
        let dominantType = media.media_type;
        let maxCount = 0;
        for (const [t, c] of typeCounts) {
            if (c > maxCount) { dominantType = t; maxCount = c; }
        }

        let verb = "Logged";
        let totalLabel = "Total Time";
        if (dominantType === "Playing") { verb = "Played"; totalLabel = "Total Playtime"; }
        else if (dominantType === "Listening") { verb = "Listened"; totalLabel = "Total Listening Time"; }
        else if (dominantType === "Watching") { verb = "Watched"; totalLabel = "Total Watchtime"; }
        else if (dominantType === "Reading") { verb = "Read"; totalLabel = "Total Readtime"; }

        const isReadingType = ["Novel", "Visual Novel", "Manga", "WebNovel", "NonFiction"].includes(media.content_type || "");
        // For reading speed, only use time from logs tagged as Reading
        const readingMin = isReadingType
            ? logs.filter(l => (l.media_type || media.media_type) === 'Reading').reduce((acc, l) => acc + l.duration_minutes, 0)
            : 0;
        const readingSpeedHtml = isReadingType && readingMin > 0 ? await this.computeReadingSpeedHtml(media, readingMin) : "";

        statsDiv.innerHTML = `
            <span style="color: var(--text-secondary);">First ${verb}: <strong style="color: var(--text-primary);">${firstLogDate}</strong></span>
            <span style="color: var(--text-secondary);">Last ${verb}: <strong style="color: var(--text-primary);">${lastLogDate}</strong></span>
            ${totalMin > 0 ? `<span style="color: var(--text-secondary);">${totalLabel}: <strong style="color: var(--text-primary);">${totalStr}</strong></span>` : ''}
            ${totalChars > 0 ? `<span style="color: var(--text-secondary);">Total Chars: <strong style="color: var(--text-primary);">${totalChars.toLocaleString()}</strong></span>` : ''}
            ${readingSpeedHtml}
        `;
    }
    private setupListeners(root: HTMLElement) {
        root.querySelector('#btn-back-grid')?.addEventListener('click', this.onBack);
        root.querySelector('#media-next')?.addEventListener('click', this.onNext);
        root.querySelector('#media-prev')?.addEventListener('click', this.onPrev);
        root.querySelector('#media-select')?.addEventListener('change', (e) => this.onNavigate(Number.parseInt((e.target as HTMLSelectElement).value, 10)));

        root.querySelector('#media-cover-img')?.addEventListener('dblclick', async () => {
            try {
                const newPath = await getServices().pickAndUploadCover(this.state.media.id!);
                if (newPath) {
                    this.state.media.cover_image = newPath;
                    await this.loadImage();
                }
            } catch (e) {
                await customAlert("Error", "Failed to upload image: " + e);
            }
        });

        const copyBtn = root.querySelector('#btn-copy-title') as HTMLElement;
        if (copyBtn) setupCopyButton(copyBtn, this.state.media.title);

        root.querySelector('#btn-search-jiten')?.addEventListener('click', async () => {
            const jitenUrl = await showJitenSearchModal(this.state.media);
            if (jitenUrl) await this.performMetadataImport(jitenUrl);
        });

        const onSave = async (field: string, value: string, isExtra: boolean = false) => {
            if (isExtra) {
                const extraData = normalizeExtraData(JSON.parse(this.state.media.extra_data || "{}"));
                this.state.media.extra_data = JSON.stringify(upsertExtraDataValue(extraData, field, value));
            } else {
                (this.state.media as unknown as Record<string, unknown>)[field] = value;
            }
            await updateMedia(this.state.media);
            this.render();
        };

        const onRenameKey = async (oldKey: string, newKey: string) => {
            if (!newKey || newKey === oldKey) {
                this.render();
                return;
            }
            const extraData = normalizeExtraData(JSON.parse(this.state.media.extra_data || "{}"));
            this.state.media.extra_data = JSON.stringify(renameExtraDataKey(extraData, oldKey, newKey));
            await updateMedia(this.state.media);
            this.render();
        };

        const setupEditable = (el: HTMLElement, field: string, options: { isExtra?: boolean, isTextArea?: boolean, isRenameKey?: boolean } = {}) => {
            el.addEventListener('dblclick', () => {
                let currentVal: string | null;
                if (options.isRenameKey) {
                    currentVal = field;
                } else if (options.isExtra) {
                    currentVal = el.textContent === '-' ? '' : el.textContent;
                } else {
                    currentVal = (this.state.media[field as keyof Media] as string) || '';
                }
                const input = document.createElement(options.isTextArea ? 'textarea' : 'input');
                if (!options.isTextArea) (input as HTMLInputElement).type = 'text';
                input.className = 'edit-input';
                input.value = currentVal || '';
                input.style.width = '100%';
                if (options.isTextArea) {
                    input.style.height = '150px';
                    input.style.resize = 'vertical';
                }
                input.style.background = 'var(--bg-dark)';
                input.style.color = options.isRenameKey ? 'var(--text-secondary)' : 'var(--text-primary)';

                input.style.border = '1px solid var(--accent-green)';
                input.style.padding = '0.2rem 0.5rem';
                input.style.fontSize = options.isRenameKey ? '0.7rem' : 'inherit';
                if (options.isRenameKey) input.style.textTransform = 'none';

                const save = async () => {
                    const newVal = input.value.trim();
                    if (options.isRenameKey) {
                        await onRenameKey(field, newVal);
                    } else {
                        await onSave(field, newVal, !!options.isExtra);
                    }
                };

                input.addEventListener('blur', save);
                input.addEventListener('keydown', ((ev: KeyboardEvent) => {
                    if (ev.key === 'Enter' && !options.isTextArea) input.blur();
                    if (ev.key === 'Escape') {
                        input.removeEventListener('blur', save);
                        this.render();
                    }
                }) as EventListener);

                el.replaceWith(input);
                input.focus();
                if (!options.isTextArea) (input as HTMLInputElement).select();
            });
        };

        const titleEl = root.querySelector('#media-title') as HTMLElement;
        if (titleEl) setupEditable(titleEl, 'title');

        const descEl = root.querySelector('#media-description') as HTMLElement;
        if (descEl) setupEditable(descEl, 'description', { isTextArea: true });

        root.querySelector('#media-description-toggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.setState({ isDescriptionExpanded: !this.state.isDescriptionExpanded });
        });

        // Extra fields values
        root.querySelectorAll('.editable-extra').forEach(el => {
            const key = (el as HTMLElement).dataset.key;
            if (key) setupEditable(el as HTMLElement, key, { isExtra: true });
        });

        // Extra fields keys (renaming)
        root.querySelectorAll('.editable-extra-key').forEach(el => {
            const key = (el as HTMLElement).dataset.key;
            if (key) setupEditable(el as HTMLElement, key, { isRenameKey: true });
        });

        root.querySelector('#media-tracking-status')?.addEventListener('change', async (e) => {
            this.state.media.tracking_status = (e.target as HTMLSelectElement).value;
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelector('#media-type')?.addEventListener('change', async (e) => {
            this.state.media.media_type = (e.target as HTMLSelectElement).value;
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelector('#media-content-type')?.addEventListener('change', async (e) => {
            this.state.media.content_type = (e.target as HTMLSelectElement).value;
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelector('#status-toggle')?.addEventListener('change', async (e) => {
            const active = (e.target as HTMLInputElement).checked;
            this.state.media.status = active ? MEDIA_STATUS.ACTIVE : MEDIA_STATUS.ARCHIVED;
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelector('#btn-mark-complete')?.addEventListener('click', async () => {
            this.state.media.tracking_status = 'Complete';
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelector('#btn-media-overflow')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleOverflowMenu();
        });

        root.querySelector('#btn-delete-media-detail')?.addEventListener('click', async () => {
            this.closeOverflowMenu();
            const ok = await customConfirm("Delete Media", `Are you sure you want to permanently delete "${this.state.media.title}" and all its logs?`, "btn-danger", "Delete");
            if (ok) {
                await deleteMedia(this.state.media.id!);
                this.onDelete();
            }
        });

        root.querySelector('#btn-add-extra')?.addEventListener('click', async () => {
            const key = await customPrompt("Enter field name (e.g. 'Author', 'Artist'):");
            if (!key) return;
            const val = await customPrompt(`Enter value for "${key}":`);
            const extraData = normalizeExtraData(JSON.parse(this.state.media.extra_data || "{}"));
            this.state.media.extra_data = JSON.stringify(upsertExtraDataValue(extraData, key, val || ""));
            await updateMedia(this.state.media);
            this.render();
        });

        root.querySelectorAll('.delete-extra-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const key = (e.currentTarget as HTMLElement).dataset.key;
                if (!key) return;
                const extraData = normalizeExtraData(JSON.parse(this.state.media.extra_data || "{}"));
                this.state.media.extra_data = JSON.stringify(removeExtraDataKey(extraData, key));
                await updateMedia(this.state.media);
                this.render();
            });
        });

        root.querySelector('#btn-import-meta')?.addEventListener('click', async () => {
            const url = await customPrompt("Enter URL to fetch metadata from:");
            if (url) await this.performMetadataImport(url);
        });

        root.querySelector('#btn-clear-meta')?.addEventListener('click', async () => {
            if (await customConfirm("Clear Metadata", "This will delete all extra fields for this media. Continue?")) {
                this.state.media.extra_data = "{}";
                await updateMedia(this.state.media);
                this.render();
            }
        });

        root.querySelectorAll('.refresh-extra-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLElement;
                const url = target.dataset.url;
                if (url) await this.performMetadataImport(url);
            });
        });

        root.querySelector('#btn-add-milestone')?.addEventListener('click', async () => {
            const milestone = await showAddMilestoneModal(this.state.media.title);
            if (milestone) {
                try {
                    await addMilestone(milestone);
                    await this.loadMilestones();
                    this.render();
                } catch (e) {
                    await customAlert("Error", "Failed to add milestone: " + e);
                }
            }
        });

        root.querySelector('#btn-clear-milestones')?.addEventListener('click', async () => {
            if (this.state.milestones.length === 0) return;
            const ok = await customConfirm("Delete all milestones", `Are you sure you want to permanently delete all milestones for "${this.state.media.title}"?`, "btn-danger", "Delete All");
            if (ok) {
                try {
                    await clearMilestones(this.state.media.title);
                    await this.loadMilestones();
                    this.render();
                } catch (e) {
                    await customAlert("Error", "Failed to delete milestones: " + e);
                }
            }
        });

        root.querySelectorAll('.delete-milestone-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = Number.parseInt((e.currentTarget as HTMLElement).dataset.id || "0", 10);
                if (id && await customConfirm("Delete Milestone", "Are you sure you want to delete this milestone?")) {
                    try {
                        await deleteMilestone(id);
                        await this.loadMilestones();
                        this.render();
                    } catch (e) {
                        await customAlert("Error", "Failed to delete milestone: " + e);
                    }
                }
            });
        });

        root.querySelector('#btn-new-media-entry')?.addEventListener('click', async () => {
            const success = await showLogActivityModal(this.state.media.title);
            if (success) {
                const logs = await getLogsForMedia(this.state.media.id!);
                this.setState({ logs });
            }
        });
    }

    private async performMetadataImport(url: string) {
        try {
            const meta = await fetchMetadataForUrl(url, this.state.media.content_type || "Unknown");
            if (!meta) return;

            // Prepare scraped data
            const scrapedMeta = { ...meta };

            const currentExtraData = normalizeExtraData(JSON.parse(this.state.media.extra_data || "{}"));
            const merged = await showImportMergeModal(scrapedMeta, {
                description: this.state.media.description,
                coverImageUrl: this.state.imgSrc || "",
                extraData: currentExtraData,
                imagesIdentical: false // We show the diff so user can visually check
            });

            if (!merged) return;

            // Apply selected merges
            if (merged.description !== undefined) this.state.media.description = merged.description;

            // Handle extra data merges
            const finalExtraData = mergeExtraData(currentExtraData, merged.extraData);
            this.state.media.extra_data = JSON.stringify(finalExtraData);

            // Handle cover image merge
            if (merged.coverImageUrl && this.state.media.id) {
                try {
                    const newPath = await downloadAndSaveImage(this.state.media.id, merged.coverImageUrl);
                    this.state.media.cover_image = newPath;
                    await this.loadImage(); // Reload blob URL for the new image
                } catch (err) {
                    Logger.error("Failed to download new cover", err);
                }
            }

            // Title is still automatic if empty
            if (meta.title && !this.state.media.title) this.state.media.title = meta.title;

            // Automatically set content type if unknown
            if (this.state.media.content_type === "Unknown" && meta.contentType && meta.contentType !== "Unknown") {
                this.state.media.content_type = meta.contentType;
                const activityType = CONTENT_TYPE_TO_ACTIVITY_TYPE[meta.contentType];
                if (activityType) {
                    this.state.media.media_type = activityType;
                }
            }

            await updateMedia(this.state.media);
            this.render();
        } catch (e) {
            await customAlert("Import Failed", "Metadata import failed: " + e);
        }
    }
}

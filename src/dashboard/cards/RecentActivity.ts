import { Component } from '../../component';
import { escapeHTML } from '../../html';
import {
    deleteLog,
    getDashboardRecentLogs,
    type ActivitySummary,
    type DashboardRecentLog,
    type DashboardRecentPage,
} from '../../api';
import { customConfirm } from '../../modal_base';
import { showLogActivityModal } from '../../activity_modal';
import { setupCopyButton } from '../../clipboard';
import { formatLoggedDuration, formatLogDate } from '../../time';
import { Logger } from '../../logger';
import { VIEW_NAMES, EVENTS } from '../../constants';
import { measureSynchronous } from '../../performance';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardEmptyState, renderDashboardCardShell } from '../card_shell';

export const RECENT_ACTIVITY_CARD = {
    id: 'recent_activity',
    label: 'Recent Activity',
    spans: { wide: 12, medium: 6 },
    dataSources: ['recentLogs'],
} as const satisfies DashboardCardDescriptor;

const RECENT_LOGS_PER_PAGE = 15;

export interface RecentActivityHost {
    nextRequestId(): number;
    currentGeneration(): number;
    isCurrent(generation: number, requestId: number, responseId: number): boolean;
    reloadDashboard(): Promise<void>;
}

interface RecentActivityState {
    recentPage: DashboardRecentPage | null;
    currentPage: number;
    recentPageLoading: boolean;
}

export class RecentActivity extends Component<RecentActivityState> {
    private readonly host: RecentActivityHost;
    private activeRecentRequest = 0;
    private paginationContainer?: HTMLElement;
    private logsListContainer?: HTMLElement;

    constructor(container: HTMLElement, initialState: RecentActivityState, host: RecentActivityHost) {
        super(container, initialState);
        this.host = host;
    }

    public setState(newState: Partial<RecentActivityState>): void {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    render(): void {
        if (!this.paginationContainer || !this.logsListContainer) {
            this.clear();
            this.container.insertAdjacentHTML('beforeend', renderDashboardCardShell({
                title: 'Recent Activity',
                cardClasses: ['dashboard-recent-activity-card'],
                headerExtras: '<div id="pagination-container"></div>',
                body: `
                    <div id="recent-logs-list" style="display: flex; flex-direction: column; flex: 1; gap: 0.5rem;">
                        <p class="dashboard-stage-placeholder" style="color: var(--text-secondary);">Loading recent activity…</p>
                    </div>
                `,
            }));
            this.paginationContainer = this.container.querySelector<HTMLElement>('#pagination-container')!;
            this.logsListContainer = this.container.querySelector<HTMLElement>('#recent-logs-list')!;
        }

        this.updateRecentLogs();
    }

    private updateRecentLogs(): void {
        if (!this.paginationContainer || !this.logsListContainer || !this.state.recentPage) return;
        const totalPages = Math.max(1, Math.ceil(this.state.recentPage.total_count / RECENT_LOGS_PER_PAGE));
        const showPagination = this.state.recentPage.total_count > RECENT_LOGS_PER_PAGE;

        if (showPagination) {
            this.paginationContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <button class="btn btn-ghost single-char-btn" id="prev-page" ${this.state.currentPage > 1 && !this.state.recentPageLoading ? '' : 'disabled'} aria-label="Previous page">
                        <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;">
                        PAGE <span id="current-page-display" title="Double click to edit" style="cursor: pointer; color: var(--text-primary); font-weight: bold; border: 1px solid var(--border-color); padding: 0.1rem 0.5rem; border-radius: 4px; min-width: 2rem; text-align: center;">${this.state.currentPage}</span> OF ${totalPages}
                    </span>
                    <button class="btn btn-ghost single-char-btn" id="next-page" ${this.state.currentPage < totalPages && !this.state.recentPageLoading ? '' : 'disabled'} aria-label="Next page">
                        <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>`;
            this.setupPaginationListeners(totalPages);
        } else {
            this.paginationContainer.innerHTML = '';
        }

        if (this.state.recentPageLoading) {
            this.logsListContainer.innerHTML = '<p style="color: var(--text-secondary);">Loading page…</p>';
        } else {
            this.renderLogsList(this.logsListContainer, this.state.recentPage.items);
        }
    }

    private setupPaginationListeners(totalPages: number): void {
        this.paginationContainer?.querySelector('#prev-page')?.addEventListener('click', () => {
            this.requestRecentPage(Math.max(1, this.state.currentPage - 1));
        });
        this.paginationContainer?.querySelector('#next-page')?.addEventListener('click', () => {
            this.requestRecentPage(Math.min(totalPages, this.state.currentPage + 1));
        });
        const display = this.paginationContainer?.querySelector('#current-page-display') as HTMLElement | null;
        display?.addEventListener('dblclick', () => {
            const input = document.createElement('input');
            input.id = 'current-page-input';
            input.type = 'text';
            input.inputMode = 'numeric';
            input.value = this.state.currentPage.toString();
            input.style.cssText = 'width:3rem;text-align:center;background:var(--bg-dark);color:var(--text-primary);border:1px solid var(--accent-green);border-radius:4px;padding:0.1rem;';
            const save = () => {
                const parsed = Number.parseInt(input.value, 10);
                if (Number.isNaN(parsed)) return;
                this.requestRecentPage(Math.max(1, Math.min(totalPages, parsed)));
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') input.blur();
                if (event.key === 'Escape') {
                    input.removeEventListener('blur', save);
                    this.updateRecentLogs();
                }
            });
            display.replaceWith(input);
            input.focus();
            input.select();
        });
    }

    private requestRecentPage(page: number): void {
        if (page === this.state.currentPage || this.state.recentPageLoading) return;
        const generation = this.host.currentGeneration();
        const requestId = this.host.nextRequestId();
        this.activeRecentRequest = requestId;
        this.state = { ...this.state, currentPage: page, recentPageLoading: true };
        this.updateRecentLogs();

        getDashboardRecentLogs({
            request_id: requestId,
            offset: (page - 1) * RECENT_LOGS_PER_PAGE,
            limit: RECENT_LOGS_PER_PAGE,
        }).then(response => {
            if (requestId !== this.activeRecentRequest
                || !this.host.isCurrent(generation, requestId, response.request_id)
                || response.offset !== (page - 1) * RECENT_LOGS_PER_PAGE
                || response.limit !== RECENT_LOGS_PER_PAGE) return;
            this.state = { ...this.state, recentPage: response, currentPage: page, recentPageLoading: false };
            measureSynchronous('render', 'dashboard_recent_page', () => this.updateRecentLogs());
        }).catch(error => {
            if (requestId !== this.activeRecentRequest || !this.host.isCurrent(generation, requestId, requestId)) return;
            this.state = { ...this.state, recentPageLoading: false };
            this.updateRecentLogs();
            Logger.error('Failed to load recent activity page', error);
        });
    }

    private renderLogsList(list: HTMLElement, logs: DashboardRecentLog[]): void {
        if (logs.length === 0) {
            list.innerHTML = renderDashboardCardEmptyState('No activity logged yet.');
            return;
        }
        const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';
        list.innerHTML = logs.map(log => {
            let activityDescription = '';
            if (log.duration_minutes > 0 && log.characters > 0) {
                activityDescription = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes, true))}</span> <span style="color: var(--text-secondary);">and</span> <span>${escapeHTML(log.characters.toLocaleString())} characters</span>`;
            } else if (log.duration_minutes > 0) {
                activityDescription = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes, true))}</span>`;
            } else if (log.characters > 0) {
                activityDescription = `<span>${escapeHTML(log.characters.toLocaleString())} characters</span>`;
            }
            const variant = log.variant.trim();
            const variantHtml = variant
                ? `<span class="dashboard-activity-variant" style="color: var(--text-secondary); font-size: 0.8rem;">${escapeHTML(variant)}</span>`
                : '';
            return `
                <div class="dashboard-activity-item" data-activity-title="${escapeHTML(log.title)}" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-dark); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div class="dashboard-activity-main" style="display: flex; flex-wrap: wrap; gap: 0.25rem; min-width: 0;">
                        <div class="dashboard-activity-meta" style="display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; min-width: 0;">
                            <span style="color: var(--accent-green); font-weight: 500;">${escapeHTML(currentProfile)}</span>
                            <span style="color: var(--text-secondary);">logged</span>${activityDescription}
                            <span style="color: var(--text-secondary);">of ${escapeHTML(log.activity_type)}</span>
                        </div>
                        <div class="dashboard-activity-title-row" style="display: inline; align-items: center; gap: 0.35rem; min-width: 0;">
                            <a class="dashboard-media-link dashboard-activity-title" data-media-id="${log.media_id}" style="display: inline; color: var(--text-primary); font-weight: 600; cursor: pointer; text-decoration: underline; text-decoration-color: var(--accent-blue); min-width: 0;">${escapeHTML(log.title)}</a>
                            ${variantHtml}
                            <button class="copy-btn copy-activity-title" data-title="${escapeHTML(log.title)}" title="Copy Title" style="background: transparent; border: none; padding: 0; cursor: pointer; display: inline; align-items: center; justify-content: center; flex: 0 0 auto; white-space:nowrap;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="dashboard-activity-actions" style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">
                        <div class="dashboard-activity-date" style="color: var(--text-secondary); margin-right: 0.5rem;">${escapeHTML(formatLogDate(log))}</div>
                        <button class="btn btn-ghost btn-sm edit-log-btn" data-id="${log.id}" title="Edit Log" style="padding: 2px 6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                        <button class="btn btn-ghost btn-sm delete-log-btn" data-id="${log.id}" title="Delete Log" style="padding: 2px 6px; color: var(--accent-red);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </div>
                </div>`;
        }).join('');

        list.querySelectorAll<HTMLElement>('.copy-activity-title').forEach(button => {
            setupCopyButton(button, button.dataset.title || '');
        });
        list.querySelectorAll<HTMLButtonElement>('.edit-log-btn').forEach((button, index) => {
            button.addEventListener('click', async () => {
                const log = logs[index];
                const success = await showLogActivityModal(log.media_id, log as ActivitySummary);
                if (success) {
                    await this.host.reloadDashboard();
                    globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED));
                }
            });
        });
        list.querySelectorAll<HTMLButtonElement>('.delete-log-btn').forEach((button, index) => {
            button.addEventListener('click', () => {
                const log = logs[index];
                (async () => {
                    if (!await customConfirm('Delete Log', 'Are you sure you want to permanently delete this log entry?')) return;
                    await deleteLog(log.id);
                    await this.host.reloadDashboard();
                    globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED));
                })().catch(error => Logger.error('Failed to delete log', error));
            });
        });
        list.querySelectorAll<HTMLElement>('.dashboard-media-link').forEach(link => {
            link.addEventListener('click', event => {
                const mediaId = Number.parseInt((event.currentTarget as HTMLElement).dataset.mediaId || '', 10);
                globalThis.dispatchEvent(new CustomEvent(EVENTS.APP_NAVIGATE, {
                    detail: { view: VIEW_NAMES.MEDIA, focusMediaId: mediaId },
                }));
            });
        });
    }
}

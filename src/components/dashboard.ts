import { Component } from '../core/component';
import { html, escapeHTML } from '../core/html';
import { getLogs, getHeatmap, getAllMedia, ActivitySummary, DailyHeatmap, deleteLog, Media, getSetting, setSetting } from '../api';
import { customConfirm, showLogActivityModal } from '../modals';
import { StatsCard } from './dashboard/StatsCard';
import { HeatmapView } from './dashboard/HeatmapView';
import { ActivityCharts } from './dashboard/ActivityCharts';
import { QuickLog } from './dashboard/QuickLog';
import { setupCopyButton } from '../utils/clipboard';
import { formatLoggedDuration } from '../utils/time';
import { Logger } from '../core/logger';
import { VIEW_NAMES, EVENTS, SETTING_KEYS } from '../constants';

interface DashboardState {
    logs: ActivitySummary[];
    heatmapData: DailyHeatmap[];
    mediaList: Media[];
    currentHeatmapYear: number;
    chartParams: {
        timeRangeDays: number;
        timeRangeOffset: number;
        groupByMode: 'media_type' | 'log_name';
        chartType: 'bar' | 'line';
        metric: 'minutes' | 'characters';
    };
    isInitialized: boolean;
    currentPage: number;
}

export class Dashboard extends Component<DashboardState> {
    private activeChartsComponent: ActivityCharts | null = null;
    private heatmapComponent: HeatmapView | null = null;
    private statsComponent: StatsCard | null = null;
    private quickLogComponent: QuickLog | null = null;
    private isRefreshing: boolean = false;

    private readonly containers: {
        leftColumn?: HTMLElement;
        rightColumn?: HTMLElement;
        stats?: HTMLElement;
        quickLog?: HTMLElement;
        heatmap?: HTMLElement;
        charts?: HTMLElement;
        logs?: HTMLElement;
        pagination?: HTMLElement;
        logsList?: HTMLElement;
    } = {};

    constructor(container: HTMLElement) {
        super(container, {
            logs: [],
            heatmapData: [],
            mediaList: [],
            currentHeatmapYear: new Date().getFullYear(),
            chartParams: {
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'media_type',
                chartType: 'bar',
                metric: 'minutes'
            },
            isInitialized: false,
            currentPage: 1
        });
    }

    async loadData() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        try {
            const [logs, heatmapData, mediaList, savedChartType, savedGroupBy] = await Promise.all([
                getLogs(),
                getHeatmap(),
                getAllMedia(),
                getSetting(SETTING_KEYS.DASHBOARD_CHART_TYPE),
                getSetting(SETTING_KEYS.DASHBOARD_GROUP_BY)
            ]);

            const chartParams = { ...this.state.chartParams };
            if (savedChartType === 'bar' || savedChartType === 'line') {
                chartParams.chartType = savedChartType;
            }
            if (savedGroupBy === 'media_type' || savedGroupBy === 'log_name') {
                chartParams.groupByMode = savedGroupBy;
            }

            this.setState({ logs, heatmapData, mediaList, chartParams, isInitialized: true });
        } catch (error) {
            Logger.error("Failed to load dashboard data:", error);
        } finally {
            this.isRefreshing = false;
        }
    }

    public setState(newState: Partial<DashboardState>) {
        const oldState = { ...this.state };
        this.state = { ...this.state, ...newState };

        if (!oldState.isInitialized && this.state.isInitialized) {
            this.render();
            return;
        }

        if (!this.state.isInitialized) return;

        // Granular updates based on what changed
        if (newState.logs || newState.mediaList) {
            this.updateStats();
            this.updateQuickLog();
            this.updateRecentLogs();
        }

        if (newState.heatmapData || newState.currentHeatmapYear !== undefined) {
            this.updateHeatmap();
        }

        if (newState.chartParams || newState.logs) {
            this.updateCharts();
        }

        if (newState.currentPage !== undefined) {
            this.updateRecentLogs();
        }
    }

    render() {
        if (!this.state.isInitialized) {
            if (!this.isRefreshing) {
                this.loadData().catch(e => Logger.error('Failed to load dashboard data', e));
            }
            this.clear();
            this.container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">Loading...</div>';
            return;
        }

        if (this.container.querySelector('.dashboard-root')) {
            // Layout already exists, just update components
            this.updateStats();
            this.updateQuickLog();
            this.updateHeatmap();
            this.updateCharts();
            this.updateRecentLogs();
            return;
        }

        this.clear();
        this.statsComponent = null;
        this.heatmapComponent = null;
        this.quickLogComponent = null;

        const root = html`<div class="dashboard-root animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem;"></div>`;
        this.container.appendChild(root);

        // 1. Dashboard top layout
        const topRow = html`<div id="dashboard-top-row" style="display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 2rem; align-items: start;"></div>`;
        root.appendChild(topRow);

        this.containers.leftColumn = html`<div id="dashboard-left-column" style="display: flex; flex-direction: column; gap: 1.25rem; min-width: 0;"></div>`;
        topRow.appendChild(this.containers.leftColumn);

        this.containers.stats = html`<div id="stats-box-container" style="display: flex; flex-direction: column;"></div>`;
        this.containers.leftColumn.appendChild(this.containers.stats);

        this.containers.quickLog = html`<div id="quick-log-container" style="display: flex; flex-direction: column; min-height: 0;"></div>`;
        this.containers.leftColumn.appendChild(this.containers.quickLog);

        this.containers.rightColumn = html`<div id="dashboard-right-column" style="display: flex; flex-direction: column; gap: 2rem; min-width: 0;"></div>`;
        topRow.appendChild(this.containers.rightColumn);

        this.containers.heatmap = html`<div id="heatmap-container" style="min-width: 0;"></div>`;
        this.containers.rightColumn.appendChild(this.containers.heatmap);

        // 2. Charts block
        this.containers.charts = html`<div id="charts-container"></div>`;
        this.containers.rightColumn.appendChild(this.containers.charts);

        // 3. Recent Logs block
        const logsCard = html`
            <div class="card">
                <div id="logs-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="margin: 0;">Recent Activity</h3>
                    <div id="pagination-container"></div>
                </div>
                <div id="recent-logs-list" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
            </div>
        `;
        this.containers.logs = logsCard;
        this.containers.pagination = logsCard.querySelector('#pagination-container') as HTMLElement;
        this.containers.logsList = logsCard.querySelector('#recent-logs-list') as HTMLElement;
        this.containers.rightColumn.appendChild(logsCard);

        // Initial component mounting
        this.updateStats();
        this.updateQuickLog();
        this.updateHeatmap();
        this.updateCharts();
        this.updateRecentLogs();
    }

    private updateStats() {
        if (this.containers.stats) {
            if (this.statsComponent) {
                this.statsComponent.setState({ logs: this.state.logs, mediaList: this.state.mediaList });
            } else {
                this.statsComponent = new StatsCard(this.containers.stats, { logs: this.state.logs, mediaList: this.state.mediaList });
            }
            this.statsComponent.render();
        }
    }

    private updateQuickLog() {
        if (!this.containers.quickLog) return;

        if (this.quickLogComponent) {
            this.quickLogComponent.setState({ logs: this.state.logs, mediaList: this.state.mediaList });
        } else {
            this.quickLogComponent = new QuickLog(
                this.containers.quickLog,
                { logs: this.state.logs, mediaList: this.state.mediaList },
                {
                    onLogged: async () => {
                        await this.loadData();
                    }
                }
            );
        }

        this.quickLogComponent.render();
    }

    private updateHeatmap() {
        if (this.containers.heatmap) {
            if (this.heatmapComponent) {
                this.heatmapComponent.setState({
                    heatmapData: this.state.heatmapData,
                    year: this.state.currentHeatmapYear
                });
            } else {
                this.heatmapComponent = new HeatmapView(this.containers.heatmap, {
                    heatmapData: this.state.heatmapData,
                    year: this.state.currentHeatmapYear
                }, (dir) => {
                    this.setState({ currentHeatmapYear: this.state.currentHeatmapYear + dir });
                }, (dateStr) => {
                    this.focusChartsOnHeatmapDate(dateStr);
                });
            }
            this.heatmapComponent.render();
        }
    }

    private focusChartsOnHeatmapDate(dateStr: string) {
        this.setState({
            chartParams: {
                ...this.state.chartParams,
                timeRangeDays: 7,
                timeRangeOffset: this.getWeeklyOffsetForDate(dateStr)
            }
        });
    }

    private getWeeklyOffsetForDate(dateStr: string): number {
        const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
        const currentWeekStart = this.getUtcWeekStart(this.getLocalISODate(new Date()));
        const selectedWeekStart = this.getUtcWeekStart(dateStr);

        return Math.max(0, Math.round((currentWeekStart - selectedWeekStart) / millisecondsPerWeek));
    }

    private getLocalISODate(date: Date): string {
        const pad = (value: number) => value.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    private getUtcWeekStart(dateStr: string): number {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        const dayOfWeek = date.getUTCDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

        date.setUTCDate(date.getUTCDate() - diffToMonday);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    private updateCharts() {
        if (!this.containers.charts) return;
        if (this.activeChartsComponent) this.activeChartsComponent.destroy();
        this.activeChartsComponent = new ActivityCharts(
            this.containers.charts,
            { logs: this.state.logs, ...this.state.chartParams },
            (newParams) => {
                this.setState({ chartParams: { ...this.state.chartParams, ...newParams } });

                // Persist changes
                if (newParams.chartType) {
                    setSetting(SETTING_KEYS.DASHBOARD_CHART_TYPE, newParams.chartType)
                        .catch(e => Logger.error("Failed to save dashboard chart type setting", e));
                }
                if (newParams.groupByMode) {
                    setSetting(SETTING_KEYS.DASHBOARD_GROUP_BY, newParams.groupByMode)
                        .catch(e => Logger.error("Failed to save dashboard group by setting", e));
                }
            }
        );
        this.activeChartsComponent.render();
    }

    private updateRecentLogs() {
        if (!this.containers.pagination || !this.containers.logsList || !this.containers.logs) return;

        const { logs, currentPage } = this.state;
        const itemsPerPage = 15;
        const totalPages = Math.ceil(logs.length / itemsPerPage);
        const showPagination = logs.length > itemsPerPage;

        // Update Pagination
        if (showPagination) {
            const prevButtonHtml = currentPage > 1
                ? `<button class="btn btn-ghost" id="prev-page" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&lt;&lt;</button>`
                : '<div style="width: 3rem;"></div>';
            const nextButtonHtml = currentPage < totalPages
                ? `<button class="btn btn-ghost" id="next-page" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&gt;&gt;</button>`
                : '<div style="width: 3rem;"></div>';

            this.containers.pagination.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    ${prevButtonHtml}
                    <span style="font-size: 0.9rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;">
                        PAGE <span id="current-page-display" title="Double click to edit" style="cursor: pointer; color: var(--text-primary); font-weight: bold; border: 1px solid var(--border-color); padding: 0.1rem 0.5rem; border-radius: 4px; min-width: 2rem; text-align: center;">${currentPage}</span> OF ${totalPages}
                    </span>
                    ${nextButtonHtml}
                </div>
            `;

            this.containers.pagination.querySelector('#prev-page')?.addEventListener('click', () => {
                this.setState({ currentPage: Math.max(1, this.state.currentPage - 1) });
            });
            this.containers.pagination.querySelector('#next-page')?.addEventListener('click', () => {
                this.setState({ currentPage: Math.min(totalPages, this.state.currentPage + 1) });
            });

            const pageDisplay = this.containers.pagination.querySelector('#current-page-display') as HTMLElement;
            pageDisplay.addEventListener('dblclick', () => {
                const input = document.createElement('input');
                input.id = 'current-page-input';
                input.type = 'text';
                input.inputMode = 'numeric';
                input.value = this.state.currentPage.toString();
                input.style.width = '3rem';
                input.style.textAlign = 'center';
                input.style.background = 'var(--bg-dark)';
                input.style.color = 'var(--text-primary)';
                input.style.border = '1px solid var(--accent-green)';
                input.style.borderRadius = '4px';
                input.style.padding = '0.1rem';

                const savePage = () => {
                    const page = Number.parseInt(input.value, 10);
                    if (Number.isNaN(page)) return;
                    const newPage = Math.max(1, Math.min(totalPages, page));
                    this.setState({ currentPage: newPage });
                };

                input.addEventListener('blur', savePage);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') input.blur();
                    if (e.key === 'Escape') {
                        input.removeEventListener('blur', savePage);
                        this.updateRecentLogs();
                    }
                });

                pageDisplay.replaceWith(input);
                input.focus();
                input.select();
            });

            // Adjust layout for pagination
            (this.containers.logs.querySelector('#logs-header') as HTMLElement).style.display = 'grid';
            (this.containers.logs.querySelector('#logs-header') as HTMLElement).style.gridTemplateColumns = '1fr auto 1fr';
        } else {
            this.containers.pagination.innerHTML = '';
            (this.containers.logs.querySelector('#logs-header') as HTMLElement).style.display = 'flex';
            (this.containers.logs.querySelector('#logs-header') as HTMLElement).style.justifyContent = 'space-between';
        }

        this.renderLogsList(this.containers.logsList);
    }

    private renderLogsList(list: HTMLElement) {
        const { logs, currentPage } = this.state;
        const itemsPerPage = 15;
        const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';

        if (logs.length === 0) {
            list.innerHTML = '<p style="color: var(--text-secondary);">No activity logged yet.</p>';
            return;
        }

        const startIndex = (currentPage - 1) * itemsPerPage;
        const pagedLogs = logs.slice(startIndex, startIndex + itemsPerPage);

        list.innerHTML = pagedLogs.map(log => {
            const escapedProfile = escapeHTML(currentProfile);
            const escapedMediaType = escapeHTML(log.media_type);
            const escapedTitle = escapeHTML(log.title);
            const escapedDate = escapeHTML(log.date);

            let activityDesc = '';
            if (log.duration_minutes > 0 && log.characters > 0) {
                activityDesc = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes, true))}</span> <span style="color: var(--text-secondary);">and</span> <span>${escapeHTML(log.characters.toLocaleString())} characters</span>`;
            } else if (log.duration_minutes > 0) {
                activityDesc = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes, true))}</span>`;
            } else if (log.characters > 0) {
                activityDesc = `<span>${escapeHTML(log.characters.toLocaleString())} characters</span>`;
            }

            return `
                <div class="dashboard-activity-item" data-activity-title="${escapedTitle}" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-dark); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;">
                        <span style="color: var(--accent-green); font-weight: 500;">${escapedProfile}</span> 
                        <span style="color: var(--text-secondary);">logged</span> 
                        ${activityDesc} 
                        <span style="color: var(--text-secondary);">of ${escapedMediaType}</span> 
                        <a class="dashboard-media-link" data-media-id="${log.media_id}" style="color: var(--text-primary); font-weight: 600; cursor: pointer; text-decoration: underline; text-decoration-color: var(--accent-blue);">${escapedTitle}</a>
                        <button class="copy-btn copy-activity-title" data-title="${escapeHTML(String(log.title || ''))}" title="Copy Title" style="background: transparent; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <div style="color: var(--text-secondary); margin-right: 0.5rem;">${escapedDate}</div>
                        <button class="btn btn-ghost btn-sm edit-log-btn" data-id="${log.id}" title="Edit Log" style="padding: 2px 6px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn btn-ghost btn-sm delete-log-btn" data-id="${log.id}" title="Delete Log" style="padding: 2px 6px; color: var(--error);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.copy-activity-title').forEach(btn => {
            const title = (btn as HTMLElement).dataset.title || '';
            setupCopyButton(btn as HTMLElement, title);
        });

        list.querySelectorAll('.edit-log-btn').forEach((btn, idx) => {
            btn.addEventListener('click', async () => {
                const log = pagedLogs[idx];
                const success = await showLogActivityModal(log.title, log);
                if (success) {
                    await this.loadData();
                }
            });
        });

        list.querySelectorAll('.delete-log-btn').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                const log = pagedLogs[idx];
                (async () => {
                    const confirm = await customConfirm("Delete Log", "Are you sure you want to permanently delete this log entry?");
                    if (confirm) {
                        await deleteLog(log.id);
                        await this.loadData();
                    }
                })().catch(err => Logger.error("Failed to delete log", err));
            });
        });

        list.querySelectorAll('.dashboard-media-link').forEach(link => {
            link.addEventListener('click', (e) => {
                const mediaId = (e.currentTarget as HTMLElement).dataset.mediaId;
                globalThis.dispatchEvent(new CustomEvent(EVENTS.APP_NAVIGATE, { detail: { view: VIEW_NAMES.MEDIA, focusMediaId: Number.parseInt(mediaId!, 10) } }));
            });
        });
    }
}

import { Component } from '../core/component';
import { html, escapeHTML } from '../core/html';
import { getLogs, getHeatmap, getAllMedia, ActivitySummary, DailyHeatmap, deleteLog, Media, getSetting, setSetting } from '../api';
import { customConfirm } from '../modals';
import { StatsCard } from './dashboard/StatsCard';
import { HeatmapView } from './dashboard/HeatmapView';
import { ActivityCharts } from './dashboard/ActivityCharts';
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
    private isRefreshing: boolean = false;

    private readonly containers: {
        stats?: HTMLElement;
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

    protected onMount() {
        this.loadData().catch(e => Logger.error("Failed to load dashboard data", e));
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
            this.clear();
            this.container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">Loading...</div>';
            return;
        }

        if (this.container.querySelector('.dashboard-root')) {
            // Layout already exists, just update components
            this.updateStats();
            this.updateHeatmap();
            this.updateCharts();
            this.updateRecentLogs();
            return;
        }

        this.clear();
        this.statsComponent = null;
        this.heatmapComponent = null;
        
        const root = html`<div class="dashboard-root animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem;"></div>`;
        this.container.appendChild(root);

        // 1. Stats and Heatmap Row
        const topRow = html`<div id="dashboard-top-row" style="display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 2rem;"></div>`;
        root.appendChild(topRow);

        this.containers.stats = html`<div class="card" id="stats-box-container" style="display: flex; flex-direction: column;"></div>`;
        topRow.appendChild(this.containers.stats);

        this.containers.heatmap = html`<div id="heatmap-container" style="min-width: 0;"></div>`;
        topRow.appendChild(this.containers.heatmap);

        // 2. Charts Row
        this.containers.charts = html`<div id="charts-container"></div>`;
        root.appendChild(this.containers.charts);

        // 3. Recent Logs Row
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
        root.appendChild(logsCard);

        // Initial component mounting
        this.updateStats();
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
                });
            }
            this.heatmapComponent.render();
        }
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
                activityDesc = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes))}</span> <span style="color: var(--text-secondary);">and</span> <span>${log.characters.toLocaleString()} characters</span>`;
            } else if (log.duration_minutes > 0) {
                activityDesc = `<span>${escapeHTML(formatLoggedDuration(log.duration_minutes))}</span>`;
            } else if (log.characters > 0) {
                activityDesc = `<span>${log.characters.toLocaleString()} characters</span>`;
            }

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-dark); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
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
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="color: var(--text-secondary);">${escapedDate}</div>
                        <button class="btn btn-danger btn-sm delete-log-btn" data-id="${log.id}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; background-color: #ff4757 !important; color: #ffffff !important; border: none; cursor: pointer;">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.copy-activity-title').forEach(btn => {
            const title = (btn as HTMLElement).dataset.title || '';
            setupCopyButton(btn as HTMLElement, title);
        });

        list.querySelectorAll('.delete-log-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = Number.parseInt((e.target as HTMLElement).dataset.id!, 10);
                (async () => {
                    const confirm = await customConfirm("Delete Log", "Are you sure you want to permanently delete this log entry?");
                    if (confirm) {
                        await deleteLog(id);
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

import { Component } from '../core/component';
import { html } from '../core/html';
import { getLogs, getHeatmap, getAllMedia, ActivitySummary, DailyHeatmap, deleteLog } from '../api';
import { customConfirm } from '../modals';
import { StatsCard } from './dashboard/StatsCard';
import { HeatmapView } from './dashboard/HeatmapView';
import { ActivityCharts } from './dashboard/ActivityCharts';
import { setupCopyButton } from '../utils/clipboard';
import { formatLoggedDuration } from '../utils/time';

interface DashboardState {
    logs: ActivitySummary[];
    heatmapData: DailyHeatmap[];
    mediaList: any[];
    currentHeatmapYear: number;
    chartParams: {
        timeRangeDays: number;
        timeRangeOffset: number;
        groupByMode: 'media_type' | 'log_name';
        chartType: 'bar' | 'line';
    };
    isInitialized: boolean;
    currentPage: number;
}

export class Dashboard extends Component<DashboardState> {
    private activeChartsComponent: ActivityCharts | null = null;
    private isRefreshing: boolean = false;

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
                chartType: 'bar'
            },
            isInitialized: false,
            currentPage: 1
        });
    }

    async loadData() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        try {
            const [logs, heatmapData, mediaList] = await Promise.all([
                getLogs(),
                getHeatmap(),
                getAllMedia()
            ]);
            this.setState({ logs, heatmapData, mediaList, isInitialized: true });
        } catch (e) {
            console.error("Dashboard failed to load data", e);
        } finally {
            this.isRefreshing = false;
        }
    }

    async render() {
        if (!this.state.isInitialized && !this.isRefreshing) {
            await this.loadData();
            return;
        }

        this.clear();
        const root = html`<div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem;"></div>`;
        this.container.appendChild(root);

        // 1. Stats and Heatmap Row
        const topRow = html`<div style="display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 2rem;"></div>`;
        root.appendChild(topRow);

        const statsContainer = html`<div class="card" id="stats-box-container" style="display: flex; flex-direction: column;"></div>`;
        topRow.appendChild(statsContainer);
        new StatsCard(statsContainer, { logs: this.state.logs, mediaList: this.state.mediaList }).render();

        const heatmapContainer = html`<div id="heatmap-container" style="min-width: 0;"></div>`;
        topRow.appendChild(heatmapContainer);
        new HeatmapView(heatmapContainer, { heatmapData: this.state.heatmapData, year: this.state.currentHeatmapYear }, (dir) => {
            this.setState({ currentHeatmapYear: this.state.currentHeatmapYear + dir });
        }).render();

        // 2. Charts Row
        const chartsContainer = html`<div id="charts-container"></div>`;
        root.appendChild(chartsContainer);
        
        if (this.activeChartsComponent) this.activeChartsComponent.destroy();
        this.activeChartsComponent = new ActivityCharts(
            chartsContainer,
            { logs: this.state.logs, ...this.state.chartParams },
            (newParams) => {
                this.setState({ chartParams: { ...this.state.chartParams, ...newParams } });
            }
        );
        this.activeChartsComponent.render();

        // 3. Recent Logs Row
        const itemsPerPage = 15;
        const totalPages = Math.ceil(this.state.logs.length / itemsPerPage);
        const showPagination = this.state.logs.length > itemsPerPage;

        let paginationHtml = '';
        if (showPagination) {
            const prevButton = this.state.currentPage > 1 
                ? `<button class="btn btn-ghost" id="prev-page" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&lt;&lt;</button>` 
                : '<div style="width: 3rem;"></div>';
            const nextButton = this.state.currentPage < totalPages 
                ? `<button class="btn btn-ghost" id="next-page" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&gt;&gt;</button>` 
                : '<div style="width: 3rem;"></div>';

            paginationHtml = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    ${prevButton}
                    <span style="font-size: 0.9rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;">
                        PAGE <span id="current-page-display" title="Double click to edit" style="cursor: pointer; color: var(--text-primary); font-weight: bold; border: 1px solid var(--border-color); padding: 0.1rem 0.5rem; border-radius: 4px; min-width: 2rem; text-align: center;">${this.state.currentPage}</span> OF ${totalPages}
                    </span>
                    ${nextButton}
                </div>
            `;
        }

        const containerStyle = showPagination 
            ? 'display: grid; grid-template-columns: 1fr auto 1fr;' 
            : 'display: flex; justify-content: space-between;';

        const logsCard = html`
            <div class="card">
                <div style="${containerStyle} align-items: center; margin-bottom: 1rem;">
                    <h3 style="margin: 0;">Recent Activity</h3>
                    ${showPagination ? `
                        <div style="display: flex; justify-content: center;">
                            ${paginationHtml}
                        </div>
                        <div></div>
                    ` : ''}
                </div>
                <div id="recent-logs-list" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
            </div>
        `;
        root.appendChild(logsCard);
        
        if (showPagination) {
            logsCard.querySelector('#prev-page')?.addEventListener('click', () => {
                this.setState({ currentPage: Math.max(1, this.state.currentPage - 1) });
            });
            logsCard.querySelector('#next-page')?.addEventListener('click', () => {
                this.setState({ currentPage: Math.min(totalPages, this.state.currentPage + 1) });
            });

            const pageDisplay = logsCard.querySelector('#current-page-display') as HTMLElement;
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
                    let newPage = parseInt(input.value);
                    if (isNaN(newPage)) newPage = this.state.currentPage;
                    newPage = Math.max(1, Math.min(totalPages, newPage));
                    this.setState({ currentPage: newPage });
                };

                input.addEventListener('blur', savePage);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') input.blur();
                    if (e.key === 'Escape') {
                        input.removeEventListener('blur', savePage);
                        this.render();
                    }
                });

                pageDisplay.replaceWith(input);
                input.focus();
                input.select();
            });
        }

        this.renderLogs(logsCard.querySelector('#recent-logs-list') as HTMLElement);
    }

    private renderLogs(list: HTMLElement) {
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
            const durationStr = formatLoggedDuration(log.duration_minutes);

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-dark); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;">
                        <span style="color: var(--accent-green); font-weight: 500;">${currentProfile}</span> 
                        <span style="color: var(--text-secondary);">logged</span> 
                        <span>${durationStr}</span> 
                        <span style="color: var(--text-secondary);">of ${log.media_type}</span> 
                        <a class="dashboard-media-link" data-media-id="${log.media_id}" style="color: var(--text-primary); font-weight: 600; cursor: pointer; text-decoration: underline; text-decoration-color: var(--accent-blue);">${log.title}</a>
                        <button class="copy-btn copy-activity-title" data-title="${log.title.replace(/"/g, '&quot;')}" title="Copy Title" style="background: transparent; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="color: var(--text-secondary);">${log.date}</div>
                        <button class="btn btn-danger btn-sm delete-log-btn" data-id="${log.id}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; background-color: #ff4757 !important; color: #ffffff !important; border: none; cursor: pointer;">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.copy-activity-title').forEach(btn => {
            const title = (btn as HTMLElement).getAttribute('data-title') || '';
            setupCopyButton(btn as HTMLElement, title);
        });

        list.querySelectorAll('.delete-log-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = parseInt((e.target as HTMLElement).getAttribute('data-id')!);
                const confirm = await customConfirm("Delete Log", "Are you sure you want to permanently delete this log entry?");
                if (confirm) {
                    await deleteLog(id);
                    await this.loadData();
                }
            });
        });

        list.querySelectorAll('.dashboard-media-link').forEach(link => {
            link.addEventListener('click', (e) => {
                const mediaId = parseInt((e.target as HTMLElement).getAttribute('data-media-id')!);
                window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'media', focusMediaId: mediaId } }));
            });
        });
    }
}

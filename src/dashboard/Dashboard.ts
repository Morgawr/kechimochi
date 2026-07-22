import { Component } from '../component';
import { html, escapeHTML } from '../html';
import {
    deleteLog,
    getDashboardHeatmapYear,
    getDashboardRange,
    getDashboardRecentLogs,
    getDashboardSnapshot,
    setSetting,
    type ActivitySummary,
    type DashboardMedia,
    type DashboardRangeResponse,
    type DashboardWeekdayDistribution,
    type DashboardRecentLog,
    type DashboardRecentPage,
    type DashboardSummary,
} from '../api';
import type { DashboardBucket, DashboardGroupBy } from '../types';
import { customConfirm } from '../modal_base';
import { showLogActivityModal } from '../activity_modal';
import { StatsCard } from './StatsCard';
import { HeatmapView } from './HeatmapView';
import { ActivityCharts } from './ActivityCharts';
import { QuickLog } from './QuickLog';
import { ActivityTotals } from './ActivityTotals';
import { setupCopyButton } from '../clipboard';
import { formatLoggedDuration } from '../time';
import { Logger } from '../logger';
import { VIEW_NAMES, EVENTS, SETTING_KEYS } from '../constants';
import { getActivityRange } from './activity_ranges';
import { measureSynchronous } from '../performance';

const RECENT_LOGS_PER_PAGE = 15;

interface ChartParams {
    timeRangeDays: number;
    timeRangeOffset: number;
    groupByMode: DashboardGroupBy;
    chartType: 'bar' | 'line';
    metric: 'minutes' | 'characters';
    weekStartDay: number;
}

interface DashboardState {
    summary: DashboardSummary | null;
    heatmapData: Array<{ date: string; total_minutes: number; total_characters: number }>;
    quickLogMedia: DashboardMedia[];
    rangeData: DashboardRangeResponse | null;
    weekdayDistribution: DashboardWeekdayDistribution | null;
    recentPage: DashboardRecentPage | null;
    currentHeatmapYear: number;
    chartParams: ChartParams;
    isInitialized: boolean;
    currentPage: number;
}

export class Dashboard extends Component<DashboardState> {
    private activeChartsComponent: ActivityCharts | null = null;
    private heatmapComponent: HeatmapView | null = null;
    private statsComponent: StatsCard | null = null;
    private quickLogComponent: QuickLog | null = null;
    private totalsComponent: ActivityTotals | null = null;
    private requestSequence = 0;
    private dataGeneration = 0;
    private activeSnapshotRequest = 0;
    private activeRangeRequest = 0;
    private activeHeatmapRequest = 0;
    private activeRecentRequest = 0;
    private recentPageLoading = false;

    private readonly containers: {
        leftColumn?: HTMLElement;
        rightColumn?: HTMLElement;
        stats?: HTMLElement;
        quickLog?: HTMLElement;
        heatmap?: HTMLElement;
        charts?: HTMLElement;
        totals?: HTMLElement;
        logs?: HTMLElement;
        pagination?: HTMLElement;
        logsList?: HTMLElement;
    } = {};

    constructor(container: HTMLElement) {
        super(container, {
            summary: null,
            heatmapData: [],
            quickLogMedia: [],
            rangeData: null,
            weekdayDistribution: null,
            recentPage: null,
            currentHeatmapYear: new Date().getFullYear(),
            chartParams: {
                timeRangeDays: 7,
                timeRangeOffset: 0,
                groupByMode: 'activity_type',
                chartType: 'bar',
                metric: 'minutes',
                weekStartDay: 1,
            },
            isInitialized: false,
            currentPage: 1,
        });
    }

    /**
     * Refreshes one coherent, bounded snapshot. A newer refresh always wins;
     * responses from a database/profile that was active earlier are ignored.
     */
    async loadData(): Promise<void> {
        this.render();
        const generation = ++this.dataGeneration;
        const requestId = this.nextRequestId();
        this.activeSnapshotRequest = requestId;
        this.setRenderRequestMarker('dashboardRequestId', requestId);
        // Invalidate section requests issued against the previous snapshot.
        this.activeRangeRequest = requestId;
        this.activeHeatmapRequest = requestId;
        this.activeRecentRequest = requestId;

        try {
            const today = this.getLocalISODate(new Date());
            const heatmapYear = new Date().getFullYear();
            const snapshot = await getDashboardSnapshot({
                request_id: requestId,
                today,
                heatmap_year: heatmapYear,
                recent_offset: 0,
                recent_limit: RECENT_LOGS_PER_PAGE,
            });
            if (!this.isCurrentResponse(generation, requestId, this.activeSnapshotRequest, snapshot.request_id)) {
                return;
            }

            this.state = {
                ...this.state,
                summary: snapshot.summary,
                quickLogMedia: snapshot.quick_log_media,
                recentPage: snapshot.recent_logs,
                heatmapData: snapshot.heatmap.days,
                rangeData: snapshot.range,
                weekdayDistribution: snapshot.weekday_distribution,
                currentHeatmapYear: snapshot.heatmap.year,
                currentPage: 1,
                chartParams: {
                    ...this.state.chartParams,
                    chartType: snapshot.settings.chart_type,
                    groupByMode: snapshot.settings.group_by,
                    weekStartDay: snapshot.settings.week_start_day,
                    timeRangeDays: 7,
                    timeRangeOffset: 0,
                },
                isInitialized: true,
            };

            measureSynchronous('render', 'dashboard_primary_stage', () => {
                this.updateStats();
                this.updateQuickLog();
                this.updateRecentLogs();
            });
            this.setRenderRequestMarker('dashboardPrimaryRequestId', requestId);
            this.stageVisualizations(generation, requestId);

            if (snapshot.settings.migrate_legacy_group_by) {
                setSetting(SETTING_KEYS.DASHBOARD_GROUP_BY, 'activity_type').catch(error => {
                    Logger.error('Failed to migrate dashboard group by setting', error);
                });
            }
        } catch (error) {
            if (generation !== this.dataGeneration || requestId !== this.activeSnapshotRequest) return;
            Logger.error('Failed to load dashboard data:', error);
            this.renderLoadError();
        }
    }

    render(): void {
        if (this.container.querySelector('.dashboard-root')) return;

        measureSynchronous('render', 'dashboard_layout', () => {
            this.clear();
            const root = html`<div class="dashboard-root" style="display: flex; flex-direction: column; gap: 2rem;"></div>`;
            this.container.appendChild(root);

            const topRow = html`<div id="dashboard-top-row" style="display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 2rem; align-items: start;"></div>`;
            root.appendChild(topRow);

            this.containers.leftColumn = html`<div id="dashboard-left-column" style="display: flex; flex-direction: column; gap: 1.25rem; min-width: 0;"></div>`;
            topRow.appendChild(this.containers.leftColumn);
            this.containers.stats = this.createStageContainer('stats-box-container', 'Loading study stats…');
            this.containers.leftColumn.appendChild(this.containers.stats);
            this.containers.quickLog = this.createStageContainer('quick-log-container', 'Loading quick log…');
            this.containers.leftColumn.appendChild(this.containers.quickLog);

            this.containers.rightColumn = html`<div id="dashboard-right-column" style="display: flex; flex-direction: column; gap: 2rem; min-width: 0;"></div>`;
            topRow.appendChild(this.containers.rightColumn);
            this.containers.heatmap = this.createStageContainer('heatmap-container', 'Loading activity year…');
            this.containers.rightColumn.appendChild(this.containers.heatmap);
            this.containers.charts = this.createStageContainer('charts-container', 'Preparing charts…');
            this.containers.rightColumn.appendChild(this.containers.charts);
            this.containers.totals = this.createStageContainer('dashboard-totals-container', 'Loading range totals…');
            this.containers.rightColumn.appendChild(this.containers.totals);

            const logsCard = html`
                <div class="card">
                    <div id="logs-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap:wrap;">
                        <h3 class="dashboard-module-title" style="margin: 0;">Recent Activity</h3>
                        <div id="pagination-container" style="margin: 0 auto;"></div>
                    </div>
                    <div id="recent-logs-list" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <p class="dashboard-stage-placeholder" style="color: var(--text-secondary);">Loading recent activity…</p>
                    </div>
                </div>
            `;
            this.containers.logs = logsCard;
            this.containers.pagination = logsCard.querySelector('#pagination-container') as HTMLElement;
            this.containers.logsList = logsCard.querySelector('#recent-logs-list') as HTMLElement;
            this.containers.rightColumn.appendChild(logsCard);
        });
    }

    private createStageContainer(id: string, message: string): HTMLElement {
        return html`<div id="${id}" style="min-width: 0;"><div class="card dashboard-stage-placeholder" style="color: var(--text-secondary);">${message}</div></div>`;
    }

    private stageVisualizations(generation: number, snapshotRequestId: number): void {
        this.onNextFrame(() => {
            if (!this.isCurrentSnapshot(generation, snapshotRequestId)) return;
            measureSynchronous('render', 'dashboard_heatmap_stage', () => this.updateHeatmap());
            this.setRenderRequestMarker('dashboardHeatmapRequestId', snapshotRequestId);
            this.onNextFrame(() => {
                if (!this.isCurrentSnapshot(generation, snapshotRequestId)) return;
                measureSynchronous('render', 'dashboard_visualization_stage', () => {
                    this.updateCharts();
                    this.updateTotals();
                });
            });
        });
    }

    private onNextFrame(callback: () => void): void {
        if (typeof globalThis.requestAnimationFrame === 'function') {
            globalThis.requestAnimationFrame(() => callback());
        } else {
            globalThis.setTimeout(callback, 0);
        }
    }

    private updateStats(): void {
        if (!this.containers.stats || !this.state.summary) return;
        if (this.statsComponent) {
            this.statsComponent.setState({ summary: this.state.summary });
        } else {
            this.statsComponent = new StatsCard(this.containers.stats, { summary: this.state.summary });
            this.statsComponent.render();
        }
    }

    private updateQuickLog(): void {
        if (!this.containers.quickLog) return;
        const componentState = {
            mediaList: this.state.quickLogMedia,
            logs: [],
            preSorted: true,
        };
        if (this.quickLogComponent) {
            this.quickLogComponent.setState(componentState);
        } else {
            this.quickLogComponent = new QuickLog(this.containers.quickLog, componentState, {
                onLogged: async () => this.loadData(),
            });
            this.quickLogComponent.render();
        }
    }

    private updateHeatmap(): void {
        if (!this.containers.heatmap) return;
        const componentState = {
            heatmapData: this.state.heatmapData,
            year: this.state.currentHeatmapYear,
        };
        if (this.heatmapComponent) {
            this.heatmapComponent.setState(componentState);
        } else {
            this.heatmapComponent = new HeatmapView(
                this.containers.heatmap,
                componentState,
                direction => this.changeHeatmapYear(direction),
                date => this.focusChartsOnHeatmapDate(date),
            );
            this.heatmapComponent.render();
        }
    }

    private updateCharts(): void {
        if (!this.containers.charts || !this.state.rangeData) return;
        const componentState = {
            rangeData: this.state.rangeData,
            ...this.state.chartParams,
            snapshotRequestId: this.activeSnapshotRequest,
        };
        if (this.activeChartsComponent) {
            this.activeChartsComponent.setState(componentState);
            return;
        }

        this.activeChartsComponent = new ActivityCharts(
            this.containers.charts,
            componentState,
            params => this.handleChartParamChange(params),
        );
        this.activeChartsComponent.render();
    }

    private updateTotals(): void {
        if (!this.containers.totals || !this.state.rangeData) return;
        const componentState = {
            rangeData: this.state.rangeData,
            weekdayDistribution: this.state.weekdayDistribution ?? undefined,
            metric: this.state.chartParams.metric,
            timeRangeDays: this.state.chartParams.timeRangeDays,
            timeRangeOffset: this.state.chartParams.timeRangeOffset,
            weekStartDay: this.state.chartParams.weekStartDay,
        };
        if (this.totalsComponent) {
            this.totalsComponent.setState(componentState);
        } else {
            this.totalsComponent = new ActivityTotals(this.containers.totals, componentState);
            this.totalsComponent.render();
        }
    }

    private handleChartParamChange(params: Partial<ChartParams>): void {
        const previous = this.state.chartParams;
        const next = { ...previous, ...params };
        this.state = { ...this.state, chartParams: next };

        if (params.chartType) {
            setSetting(SETTING_KEYS.DASHBOARD_CHART_TYPE, params.chartType)
                .catch(error => Logger.error('Failed to save dashboard chart type setting', error));
        }
        if (params.groupByMode) {
            setSetting(SETTING_KEYS.DASHBOARD_GROUP_BY, params.groupByMode)
                .catch(error => Logger.error('Failed to save dashboard group by setting', error));
        }

        const needsRange = next.timeRangeDays !== previous.timeRangeDays
            || next.timeRangeOffset !== previous.timeRangeOffset
            || next.groupByMode !== previous.groupByMode
            || next.weekStartDay !== previous.weekStartDay;
        if (needsRange) {
            this.activeChartsComponent?.updatePendingParams(next);
            this.requestRange().catch(error => Logger.error('Unexpected dashboard range failure', error));
        } else {
            measureSynchronous('render', 'dashboard_chart_controls', () => {
                this.updateCharts();
                if (params.metric) this.updateTotals();
            });
        }
    }

    private async requestRange(): Promise<void> {
        const generation = this.dataGeneration;
        const requestId = this.nextRequestId();
        this.activeRangeRequest = requestId;
        const range = getActivityRange(
            this.state.chartParams.timeRangeDays,
            this.state.chartParams.timeRangeOffset,
            this.getAllTimeRangeSeeds(),
            this.state.chartParams.weekStartDay,
        );
        const bucket = this.getDashboardBucket(range.unit);
        this.containers.charts?.setAttribute('aria-busy', 'true');
        this.containers.totals?.setAttribute('aria-busy', 'true');

        try {
            const response = await getDashboardRange({
                request_id: requestId,
                start_date: range.validStart,
                end_date: range.validEnd,
                bucket,
                group_by: this.state.chartParams.groupByMode,
            });
            if (!this.isCurrentResponse(generation, requestId, this.activeRangeRequest, response.request_id)) {
                return;
            }
            // Besides the token, verify all query-defining fields. This makes a
            // malformed/cross-environment response impossible to apply silently.
            if (response.start_date !== range.validStart
                || response.end_date !== range.validEnd
                || response.bucket !== bucket
                || response.group_by !== this.state.chartParams.groupByMode) {
                Logger.warn('[kechimochi] Ignored mismatched dashboard range response.');
                return;
            }

            this.state = { ...this.state, rangeData: response };
            measureSynchronous('render', 'dashboard_range_response', () => {
                this.updateCharts();
                this.updateTotals();
            });
        } catch (error) {
            if (generation === this.dataGeneration && requestId === this.activeRangeRequest) {
                Logger.error('Failed to load dashboard range', error);
            }
        } finally {
            // An older request must never clear the loading state belonging to
            // a newer range/profile request.
            if (generation === this.dataGeneration && requestId === this.activeRangeRequest) {
                this.containers.charts?.removeAttribute('aria-busy');
                this.containers.totals?.removeAttribute('aria-busy');
            }
        }
    }

    private getAllTimeRangeSeeds(): ActivitySummary[] {
        const first = this.state.summary?.first_activity_date;
        const last = this.state.summary?.last_activity_date;
        if (!first || !last) return [];
        const firstYear = Number.parseInt(first.slice(0, 4), 10);
        const lastYear = Number.parseInt(last.slice(0, 4), 10);
        const seeds: ActivitySummary[] = [];
        for (let year = firstYear; year <= lastYear; year++) {
            seeds.push({
                id: year,
                media_id: 0,
                title: '',
                activity_type: '',
                duration_minutes: 0,
                characters: 0,
                date: `${year.toString().padStart(4, '0')}-01-01`,
                language: '',
                notes: '',
            });
        }
        return seeds;
    }

    private getDashboardBucket(unit: 'day' | 'week' | 'month' | 'year'): DashboardBucket {
        if (unit === 'day') return 'day';
        if (unit === 'month') return 'month';
        return 'year';
    }

    private changeHeatmapYear(direction: number): void {
        const year = this.state.currentHeatmapYear + direction;
        const generation = this.dataGeneration;
        const requestId = this.nextRequestId();
        this.activeHeatmapRequest = requestId;
        this.state = { ...this.state, currentHeatmapYear: year, heatmapData: [] };
        this.updateHeatmap();

        getDashboardHeatmapYear({ request_id: requestId, year }).then(response => {
            if (!this.isCurrentResponse(generation, requestId, this.activeHeatmapRequest, response.request_id)
                || response.year !== year) return;
            this.state = { ...this.state, currentHeatmapYear: response.year, heatmapData: response.days };
            measureSynchronous('render', 'dashboard_heatmap_response', () => this.updateHeatmap());
        }).catch(error => {
            if (generation === this.dataGeneration && requestId === this.activeHeatmapRequest) {
                Logger.error('Failed to load dashboard heatmap year', error);
            }
        });
    }

    private focusChartsOnHeatmapDate(date: string): void {
        this.handleChartParamChange({
            timeRangeDays: 7,
            timeRangeOffset: this.getWeeklyOffsetForDate(date),
        });
    }

    private getWeeklyOffsetForDate(date: string): number {
        const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
        const currentWeekStart = this.getUtcWeekStart(
            this.getLocalISODate(new Date()),
            this.state.chartParams.weekStartDay,
        );
        const selectedWeekStart = this.getUtcWeekStart(date, this.state.chartParams.weekStartDay);
        return Math.max(0, Math.round((currentWeekStart - selectedWeekStart) / millisecondsPerWeek));
    }

    private getUtcWeekStart(dateString: string, weekStartDay: number): number {
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        const normalizedStart = Number.isInteger(weekStartDay) && weekStartDay >= 0 && weekStartDay <= 6
            ? weekStartDay
            : 1;
        const diff = (date.getUTCDay() - normalizedStart + 7) % 7;
        date.setUTCDate(date.getUTCDate() - diff);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    private updateRecentLogs(): void {
        if (!this.containers.pagination || !this.containers.logsList || !this.state.recentPage) return;
        const totalPages = Math.max(1, Math.ceil(this.state.recentPage.total_count / RECENT_LOGS_PER_PAGE));
        const showPagination = this.state.recentPage.total_count > RECENT_LOGS_PER_PAGE;

        if (showPagination) {
            this.containers.pagination.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <button class="btn btn-ghost single-char-btn" id="prev-page" ${this.state.currentPage > 1 && !this.recentPageLoading ? '' : 'disabled'} aria-label="Previous page">
                        <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;">
                        PAGE <span id="current-page-display" title="Double click to edit" style="cursor: pointer; color: var(--text-primary); font-weight: bold; border: 1px solid var(--border-color); padding: 0.1rem 0.5rem; border-radius: 4px; min-width: 2rem; text-align: center;">${this.state.currentPage}</span> OF ${totalPages}
                    </span>
                    <button class="btn btn-ghost single-char-btn" id="next-page" ${this.state.currentPage < totalPages && !this.recentPageLoading ? '' : 'disabled'} aria-label="Next page">
                        <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>`;
            this.setupPaginationListeners(totalPages);
        } else {
            this.containers.pagination.innerHTML = '';
        }

        if (this.recentPageLoading) {
            this.containers.logsList.innerHTML = '<p style="color: var(--text-secondary);">Loading page…</p>';
        } else {
            this.renderLogsList(this.containers.logsList, this.state.recentPage.items);
        }
    }

    private setupPaginationListeners(totalPages: number): void {
        this.containers.pagination?.querySelector('#prev-page')?.addEventListener('click', () => {
            this.requestRecentPage(Math.max(1, this.state.currentPage - 1));
        });
        this.containers.pagination?.querySelector('#next-page')?.addEventListener('click', () => {
            this.requestRecentPage(Math.min(totalPages, this.state.currentPage + 1));
        });
        const display = this.containers.pagination?.querySelector('#current-page-display') as HTMLElement | null;
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
        if (page === this.state.currentPage || this.recentPageLoading) return;
        const generation = this.dataGeneration;
        const requestId = this.nextRequestId();
        this.activeRecentRequest = requestId;
        this.state = { ...this.state, currentPage: page };
        this.recentPageLoading = true;
        this.updateRecentLogs();

        getDashboardRecentLogs({
            request_id: requestId,
            offset: (page - 1) * RECENT_LOGS_PER_PAGE,
            limit: RECENT_LOGS_PER_PAGE,
        }).then(response => {
            if (!this.isCurrentResponse(generation, requestId, this.activeRecentRequest, response.request_id)
                || response.offset !== (page - 1) * RECENT_LOGS_PER_PAGE
                || response.limit !== RECENT_LOGS_PER_PAGE) return;
            this.state = { ...this.state, recentPage: response, currentPage: page };
            this.recentPageLoading = false;
            measureSynchronous('render', 'dashboard_recent_page', () => this.updateRecentLogs());
        }).catch(error => {
            if (generation !== this.dataGeneration || requestId !== this.activeRecentRequest) return;
            this.recentPageLoading = false;
            this.updateRecentLogs();
            Logger.error('Failed to load recent activity page', error);
        });
    }

    private renderLogsList(list: HTMLElement, logs: DashboardRecentLog[]): void {
        if (logs.length === 0) {
            list.innerHTML = '<p style="color: var(--text-secondary);">No activity logged yet.</p>';
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
                        <div class="dashboard-activity-date" style="color: var(--text-secondary); margin-right: 0.5rem;">${escapeHTML(log.date)}</div>
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
                    await this.loadData();
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
                    await this.loadData();
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

    private renderLoadError(): void {
        const message = '<div class="card" style="color: var(--accent-red);">Unable to load dashboard data.</div>';
        for (const container of [this.containers.stats, this.containers.quickLog, this.containers.heatmap, this.containers.charts, this.containers.totals]) {
            if (container?.querySelector('.dashboard-stage-placeholder')) container.innerHTML = message;
        }
        if (this.containers.logsList?.querySelector('.dashboard-stage-placeholder')) {
            this.containers.logsList.innerHTML = '<p style="color: var(--accent-red);">Unable to load recent activity.</p>';
        }
    }

    private nextRequestId(): number {
        this.requestSequence += 1;
        return this.requestSequence;
    }

    private isCurrentResponse(
        generation: number,
        expectedRequestId: number,
        activeRequestId: number,
        responseRequestId: number,
    ): boolean {
        return generation === this.dataGeneration
            && expectedRequestId === activeRequestId
            && responseRequestId === expectedRequestId;
    }

    private isCurrentSnapshot(generation: number, requestId: number): boolean {
        return generation === this.dataGeneration && requestId === this.activeSnapshotRequest;
    }

    private setRenderRequestMarker(
        marker: 'dashboardRequestId' | 'dashboardPrimaryRequestId' | 'dashboardHeatmapRequestId',
        requestId: number,
    ): void {
        const root = this.container.querySelector<HTMLElement>('.dashboard-root');
        if (root) root.dataset[marker] = requestId.toString();
    }

    private getLocalISODate(date: Date): string {
        const pad = (value: number) => value.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
}

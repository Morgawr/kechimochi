import { Component } from '../component';
import { html } from '../html';
import {
    getDashboardRange,
    getDashboardSnapshot,
    getSetting,
    setSetting,
    type DashboardMedia,
    type DashboardRangeResponse,
    type DashboardWeekdayDistribution,
    type DashboardRecentPage,
    type DashboardSummary,
} from '../api';
import type { DashboardGroupBy } from '../types';
import { StatsCard } from './StatsCard';
import { HeatmapView, type HeatmapViewHost } from './cards/HeatmapView';
import { ActivityCharts, type ActivityChartsHostId } from './cards/ActivityCharts';
import { DashboardControls } from './DashboardControls';
import { QuickLog } from './QuickLog';
import { ActivityTotals, type ActivityTotalsHostId } from './cards/ActivityTotals';
import { RecentActivity, type RecentActivityHost } from './cards/RecentActivity';
import { Logger } from '../logger';
import { SETTING_KEYS } from '../constants';
import {
    ACTIVITY_TIME_RANGES,
    buildAllTimeRangeSeeds,
    getActivityRange,
    getDashboardBucket,
    getLocalISODate,
    getOffsetForDate,
    type DatedActivityTotals,
} from './activity_ranges';
import { measureSynchronous } from '../performance';
import {
    DASHBOARD_CARD_ORDER,
    parseHiddenDashboardCards,
    serializeHiddenDashboardCards,
    type DashboardCardId,
} from './dashboard_cards';
import { reconcileDashboardCards, type DashboardCardDescriptor } from './dashboard_layout';

const RECENT_LOGS_PER_PAGE = 15;
const SIDE_PANEL_HIDE_LABEL = 'Hide side panel';
const SIDE_PANEL_SHOW_LABEL = 'Show side panel';

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
}

export class Dashboard extends Component<DashboardState> {
    private activeChartsComponent: ActivityCharts | null = null;
    private controlsComponent: DashboardControls | null = null;
    private controlsHost: HTMLElement | null = null;
    private heatmapComponent: HeatmapView | null = null;
    private statsComponent: StatsCard | null = null;
    private quickLogComponent: QuickLog | null = null;
    private totalsComponent: ActivityTotals | null = null;
    private recentActivityComponent: RecentActivity | null = null;
    private requestSequence = 0;
    private dataGeneration = 0;
    private activeSnapshotRequest = 0;
    private activeRangeRequest = 0;
    private sidePanelCollapsed = false;
    private readonly pendingSettingWriteCounts = new Map<string, number>();
    private readonly cardHosts = new Map<DashboardCardId, HTMLElement>();
    private readonly cardDescriptorsById = new Map<DashboardCardId, DashboardCardDescriptor>(
        DASHBOARD_CARD_ORDER.map((card): [DashboardCardId, DashboardCardDescriptor] => [card.id, card]),
    );
    private hiddenCards = new Set<DashboardCardId>();
    private visibilityRevision = 0;
    private hiddenCardsWriteInFlight = false;
    private queuedHiddenCardsWrite: string | null = null;

    private readonly containers: {
        leftColumn?: HTMLElement;
        cardGrid?: HTMLElement;
        stats?: HTMLElement;
        quickLog?: HTMLElement;
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
        this.activeRangeRequest = requestId;
        const hiddenCardsRevisionAtRead = this.visibilityRevision;

        try {
            const today = getLocalISODate(new Date());
            const heatmapYear = new Date().getFullYear();
            const [snapshot, hiddenCardsSetting] = await Promise.all([
                getDashboardSnapshot({
                    request_id: requestId,
                    today,
                    heatmap_year: heatmapYear,
                    recent_offset: 0,
                    recent_limit: RECENT_LOGS_PER_PAGE,
                }),
                this.readHiddenCardsSetting(),
            ]);
            if (!this.isCurrentResponse(generation, requestId, this.activeSnapshotRequest, snapshot.request_id)) {
                return;
            }

            if (this.visibilityRevision === hiddenCardsRevisionAtRead) {
                this.hiddenCards = parseHiddenDashboardCards(hiddenCardsSetting);
            }
            this.controlsComponent?.refreshCardsSummary();

            this.state = {
                ...this.state,
                rangeData: null,
                summary: snapshot.summary,
                quickLogMedia: snapshot.quick_log_media,
                recentPage: snapshot.recent_logs,
                heatmapData: snapshot.heatmap.days,
                weekdayDistribution: snapshot.weekday_distribution,
                currentHeatmapYear: snapshot.heatmap.year,
                chartParams: {
                    ...this.state.chartParams,
                    chartType: snapshot.settings.chart_type,
                    groupByMode: snapshot.settings.group_by,
                    weekStartDay: snapshot.settings.week_start_day,
                    timeRangeDays: this.hasPendingSettingWrite(SETTING_KEYS.DASHBOARD_TIME_RANGE_DAYS)
                        ? this.state.chartParams.timeRangeDays
                        : snapshot.settings.time_range_days,
                    metric: this.hasPendingSettingWrite(SETTING_KEYS.DASHBOARD_METRIC)
                        ? this.state.chartParams.metric
                        : snapshot.settings.metric,
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

            const dashboardColumns = html`<div id="dashboard-columns"></div>`;
            root.appendChild(dashboardColumns);

            this.containers.leftColumn = html`<div id="dashboard-left-column"></div>`;
            dashboardColumns.appendChild(this.containers.leftColumn);
            this.containers.stats = this.createStageContainer('stats-box-container', 'Loading study stats…');
            this.containers.leftColumn.appendChild(this.containers.stats);
            this.containers.quickLog = this.createStageContainer('quick-log-container', 'Loading quick log…');
            this.containers.leftColumn.appendChild(this.containers.quickLog);

            this.containers.cardGrid = html`<div id="dashboard-card-grid"></div>`;
            dashboardColumns.appendChild(this.containers.cardGrid);

            this.controlsHost = html`<div class="dashboard-card-host" data-dashboard-card="controls"></div>`;
            this.containers.cardGrid.appendChild(this.controlsHost);
            const { timeRangeDays, timeRangeOffset, groupByMode, chartType, metric } = this.state.chartParams;
            this.controlsComponent = new DashboardControls(
                this.controlsHost,
                { timeRangeDays, timeRangeOffset, groupByMode, chartType, metric },
                params => this.handleChartParamChange(params),
                DASHBOARD_CARD_ORDER,
                () => this.hiddenCards,
                (id, isVisible) => this.toggleCardVisibility(id, isVisible),
                () => this.createSidePanelToggle(),
            );
            this.controlsComponent.render();

            for (const descriptor of DASHBOARD_CARD_ORDER) {
                const host = this.createCardHost(descriptor.id, descriptor.label);
                this.containers.cardGrid.appendChild(host);
                this.cardHosts.set(descriptor.id, host);
            }
        });
    }

    private createCardHost(id: DashboardCardId, label: string): HTMLElement {
        const host = html`<div class="dashboard-card-host" data-dashboard-card="${id}" hidden></div>`;
        if (id === 'heatmap') host.id = 'heatmap-container';
        host.appendChild(this.createStagePlaceholder(`Loading ${label}…`));
        return host;
    }

    private createStageContainer(id: string, message: string): HTMLElement {
        const container = html`<div id="${id}" style="min-width: 0;"></div>`;
        container.appendChild(this.createStagePlaceholder(message));
        return container;
    }

    private createStagePlaceholder(message: string): HTMLElement {
        return html`<div class="card dashboard-stage-placeholder" style="color: var(--text-secondary);">${message}</div>`;
    }

    private createSidePanelToggle(): HTMLElement {
        const label = this.sidePanelCollapsed ? SIDE_PANEL_SHOW_LABEL : SIDE_PANEL_HIDE_LABEL;
        const toggle = html`
            <button type="button" id="dashboard-side-panel-toggle"
                class="dashboard-side-panel-toggle"
                aria-controls="dashboard-left-column"
                aria-expanded="${(!this.sidePanelCollapsed).toString()}"
                aria-label="${label}"
                title="${label}">
                <svg class="dashboard-side-panel-chevron" width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        `;
        toggle.addEventListener('click', () => this.toggleSidePanel());
        return toggle;
    }

    private toggleSidePanel(): void {
        this.sidePanelCollapsed = !this.sidePanelCollapsed;
        const dashboardColumns = this.container.querySelector<HTMLElement>('#dashboard-columns');
        const toggle = this.container.querySelector<HTMLElement>('#dashboard-side-panel-toggle');
        if (!dashboardColumns || !toggle) return;

        dashboardColumns.classList.toggle('is-side-panel-collapsed', this.sidePanelCollapsed);
        const label = this.sidePanelCollapsed ? SIDE_PANEL_SHOW_LABEL : SIDE_PANEL_HIDE_LABEL;
        toggle.setAttribute('aria-expanded', (!this.sidePanelCollapsed).toString());
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('title', label);
    }

    private stageVisualizations(generation: number, snapshotRequestId: number): void {
        this.onNextFrame(() => {
            if (!this.isCurrentSnapshot(generation, snapshotRequestId)) return;
            measureSynchronous('render', 'dashboard_heatmap_stage', () => this.updateHeatmap());
            this.setRenderRequestMarker('dashboardHeatmapRequestId', snapshotRequestId);
            measureSynchronous('render', 'dashboard_snapshot_totals_stage', () => this.updateTotals());
            this.onNextFrame(() => {
                if (!this.isCurrentSnapshot(generation, snapshotRequestId)) return;
                this.controlsComponent?.syncControlState(this.state.chartParams);
                this.updateRangeLabel();
                this.activeChartsComponent?.updatePendingParams(this.state.chartParams);
                if (this.isRangeRequired()) {
                    this.requestRange().catch(error => Logger.error('Unexpected dashboard range failure', error));
                } else {
                    this.publishControlsRequestId(this.activeSnapshotRequest);
                }
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

    private reconcileCards(): void {
        if (!this.containers.cardGrid) return;
        reconcileDashboardCards(this.containers.cardGrid, this.cardDescriptorsById, this.hiddenCards);
    }

    private toggleCardVisibility(id: DashboardCardId, isVisible: boolean): void {
        if (isVisible) this.hiddenCards.delete(id); else this.hiddenCards.add(id);
        this.visibilityRevision++;
        this.reconcileCards();
        this.controlsComponent?.refreshCardsSummary();
        this.activeChartsComponent?.updateHiddenCards(new Set(this.hiddenCards));
        if (!this.state.rangeData && this.isRangeRequired()) {
            this.requestRange().catch(error => Logger.error('Unexpected dashboard range failure', error));
        }
        this.persistHiddenCards();
    }

    public closeCardsMenu(): void {
        this.controlsComponent?.closeCardsPanel();
    }

    private async readHiddenCardsSetting(): Promise<string | null> {
        try {
            return await getSetting(SETTING_KEYS.DASHBOARD_HIDDEN_CARDS);
        } catch {
            return null;
        }
    }

    private persistHiddenCards(): void {
        this.queuedHiddenCardsWrite = serializeHiddenDashboardCards(this.hiddenCards);
        if (!this.hiddenCardsWriteInFlight) this.flushHiddenCardsWrite();
    }

    private flushHiddenCardsWrite(): void {
        const value = this.queuedHiddenCardsWrite;
        if (value === null) return;
        this.queuedHiddenCardsWrite = null;
        this.hiddenCardsWriteInFlight = true;
        this.beginPendingSettingWrite(SETTING_KEYS.DASHBOARD_HIDDEN_CARDS);
        setSetting(SETTING_KEYS.DASHBOARD_HIDDEN_CARDS, value)
            .then(() => {
                if (this.queuedHiddenCardsWrite === value) this.queuedHiddenCardsWrite = null;
            })
            .catch(error => {
                Logger.error('Failed to save dashboard hidden cards setting', error);
                this.queuedHiddenCardsWrite = null;
            })
            .finally(() => {
                this.hiddenCardsWriteInFlight = false;
                this.endPendingSettingWrite(SETTING_KEYS.DASHBOARD_HIDDEN_CARDS);
                this.flushHiddenCardsWrite();
            });
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
        const host = this.cardHosts.get('heatmap');
        if (!host) return;
        const componentState = {
            heatmapData: this.state.heatmapData,
            year: this.state.currentHeatmapYear,
        };
        if (this.heatmapComponent) {
            this.heatmapComponent.setState(componentState);
        } else {
            this.heatmapComponent = new HeatmapView(
                host,
                componentState,
                this.createCardRequestHost(),
                date => this.focusChartsOnHeatmapDate(date),
            );
            this.heatmapComponent.render();
        }
        this.reconcileCards();
    }

    private updateCharts(): void {
        const cardGrid = this.containers.cardGrid;
        const breakdownHost = this.cardHosts.get('activity_breakdown');
        const visualizationHost = this.cardHosts.get('activity_visualization');
        if (!this.state.rangeData || !cardGrid || !breakdownHost || !visualizationHost) return;
        const componentState = {
            rangeData: this.state.rangeData,
            ...this.state.chartParams,
            snapshotRequestId: this.activeSnapshotRequest,
            hiddenCards: new Set(this.hiddenCards),
        };
        if (this.activeChartsComponent) {
            this.activeChartsComponent.setState(componentState);
        } else {
            const hosts = new Map<ActivityChartsHostId, HTMLElement>([
                ['activity_breakdown', breakdownHost],
                ['activity_visualization', visualizationHost],
            ]);
            this.activeChartsComponent = new ActivityCharts(
                cardGrid,
                hosts,
                componentState,
                () => this.reconcileCards(),
                requestId => this.publishControlsRequestId(requestId),
            );
            this.activeChartsComponent.render();
        }
        this.reconcileCards();
    }

    private updateTotals(): void {
        const cardGrid = this.containers.cardGrid;
        const weekdayHost = this.cardHosts.get('weekday_distribution');
        const statsHost = this.cardHosts.get('period_stats');
        const categoriesHost = this.cardHosts.get('categories');
        const highlightsHost = this.cardHosts.get('highlights');
        if (!cardGrid || !weekdayHost || !statsHost || !categoriesHost || !highlightsHost) return;
        const componentState = {
            rangeData: this.state.rangeData ?? undefined,
            weekdayDistribution: this.state.weekdayDistribution ?? undefined,
            metric: this.state.chartParams.metric,
            timeRangeDays: this.state.chartParams.timeRangeDays,
            timeRangeOffset: this.state.chartParams.timeRangeOffset,
            weekStartDay: this.state.chartParams.weekStartDay,
        };
        if (this.totalsComponent) {
            this.totalsComponent.setState(componentState);
        } else {
            const hosts = new Map<ActivityTotalsHostId, HTMLElement>([
                ['weekday_distribution', weekdayHost],
                ['period_stats', statsHost],
                ['categories', categoriesHost],
                ['highlights', highlightsHost],
            ]);
            this.totalsComponent = new ActivityTotals(
                cardGrid,
                hosts,
                componentState,
                () => this.reconcileCards(),
            );
            this.totalsComponent.render();
        }
        this.reconcileCards();
    }

    private handleChartParamChange(params: Partial<ChartParams>): void {
        const previous = this.state.chartParams;
        const next = { ...previous, ...params };
        this.state = { ...this.state, chartParams: next };
        this.controlsComponent?.syncControlState(next);
        this.updateRangeLabel();

        if (params.chartType) {
            setSetting(SETTING_KEYS.DASHBOARD_CHART_TYPE, params.chartType)
                .catch(error => Logger.error('Failed to save dashboard chart type setting', error));
        }
        if (params.groupByMode) {
            setSetting(SETTING_KEYS.DASHBOARD_GROUP_BY, params.groupByMode)
                .catch(error => Logger.error('Failed to save dashboard group by setting', error));
        }
        if (params.timeRangeDays !== undefined) {
            this.beginPendingSettingWrite(SETTING_KEYS.DASHBOARD_TIME_RANGE_DAYS);
            setSetting(SETTING_KEYS.DASHBOARD_TIME_RANGE_DAYS, params.timeRangeDays.toString())
                .catch(error => Logger.error('Failed to save dashboard time range setting', error))
                .finally(() => this.endPendingSettingWrite(SETTING_KEYS.DASHBOARD_TIME_RANGE_DAYS));
        }
        if (params.metric) {
            this.beginPendingSettingWrite(SETTING_KEYS.DASHBOARD_METRIC);
            setSetting(SETTING_KEYS.DASHBOARD_METRIC, params.metric)
                .catch(error => Logger.error('Failed to save dashboard metric setting', error))
                .finally(() => this.endPendingSettingWrite(SETTING_KEYS.DASHBOARD_METRIC));
        }

        const needsRange = next.timeRangeDays !== previous.timeRangeDays
            || next.timeRangeOffset !== previous.timeRangeOffset
            || next.groupByMode !== previous.groupByMode
            || next.weekStartDay !== previous.weekStartDay;
        if (needsRange) {
            this.activeChartsComponent?.updatePendingParams(next);
            if (this.isRangeRequired()) {
                this.requestRange().catch(error => Logger.error('Unexpected dashboard range failure', error));
            }
        } else {
            measureSynchronous('render', 'dashboard_chart_controls', () => {
                this.updateCharts();
                if (params.metric) this.updateTotals();
            });
        }
    }

    private updateRangeLabel(): void {
        if (!this.controlsComponent) return;
        this.controlsComponent.setRangeLabel(getActivityRange(
            this.state.chartParams.timeRangeDays,
            this.state.chartParams.timeRangeOffset,
            this.getAllTimeRangeSeeds(),
            this.state.chartParams.weekStartDay,
        ));
    }

    private rangeDependentCardHosts(): HTMLElement[] {
        const hosts: HTMLElement[] = [];
        for (const [id, descriptor] of this.cardDescriptorsById) {
            if (!descriptor.dataSources.includes('range')) continue;
            const host = this.cardHosts.get(id);
            if (host) hosts.push(host);
        }
        return hosts;
    }

    private isRangeRequired(): boolean {
        for (const [id, descriptor] of this.cardDescriptorsById) {
            if (this.hiddenCards.has(id)) continue;
            if (descriptor.dataSources.includes('range')) return true;
        }
        return false;
    }

    private hasMountedChartCard(): boolean {
        const breakdownHost = this.cardHosts.get('activity_breakdown');
        const visualizationHost = this.cardHosts.get('activity_visualization');
        return Boolean(breakdownHost?.querySelector('.card') || visualizationHost?.querySelector('.card'));
    }

    private publishControlsRequestId(requestId: number): void {
        if (this.controlsHost) this.controlsHost.dataset.dashboardRequestId = requestId.toString();
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
        if (this.controlsHost) {
            this.controlsHost.dataset.rangeStart = range.validStart;
            this.controlsHost.dataset.rangeEnd = range.validEnd;
        }
        const bucket = getDashboardBucket(range.unit);
        const rangeHosts = this.rangeDependentCardHosts();
        for (const host of rangeHosts) host.setAttribute('aria-busy', 'true');

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
            if (!this.hasMountedChartCard()) {
                this.publishControlsRequestId(this.activeSnapshotRequest);
            }
        } catch (error) {
            if (generation === this.dataGeneration && requestId === this.activeRangeRequest) {
                Logger.error('Failed to load dashboard range', error);
                if (!this.state.rangeData) this.renderRangeLoadError();
            }
        } finally {
            if (generation === this.dataGeneration && requestId === this.activeRangeRequest) {
                for (const host of rangeHosts) host.removeAttribute('aria-busy');
            }
        }
    }

    private getAllTimeRangeSeeds(): DatedActivityTotals[] {
        return buildAllTimeRangeSeeds(
            this.state.summary?.first_activity_date ?? null,
            this.state.summary?.last_activity_date ?? null,
        );
    }

    private focusChartsOnHeatmapDate(date: string): void {
        const { timeRangeDays, weekStartDay } = this.state.chartParams;
        if (timeRangeDays === ACTIVITY_TIME_RANGES.ALL_TIME) return;
        this.handleChartParamChange({
            timeRangeOffset: getOffsetForDate(date, timeRangeDays, weekStartDay),
        });
    }

    private updateRecentLogs(): void {
        const host = this.cardHosts.get('recent_activity');
        if (!host || !this.state.recentPage) return;
        const componentState = {
            recentPage: this.state.recentPage,
            currentPage: 1,
            recentPageLoading: false,
        };
        if (this.recentActivityComponent) {
            this.recentActivityComponent.setState(componentState);
        } else {
            this.recentActivityComponent = new RecentActivity(host, componentState, this.createRecentActivityHost());
            this.recentActivityComponent.render();
        }
        this.reconcileCards();
    }

    private createCardRequestHost(): HeatmapViewHost {
        return {
            nextRequestId: () => this.nextRequestId(),
            currentGeneration: () => this.dataGeneration,
            isCurrent: (generation, requestId, responseId) => generation === this.dataGeneration && requestId === responseId,
        };
    }

    private createRecentActivityHost(): RecentActivityHost {
        return {
            ...this.createCardRequestHost(),
            reloadDashboard: () => this.loadData(),
        };
    }

    private renderLoadError(): void {
        const message = '<div class="card" style="color: var(--accent-red);">Unable to load dashboard data.</div>';
        const containers = [this.containers.stats, this.containers.quickLog, ...this.cardHosts.values()];
        for (const container of containers) {
            if (container?.querySelector('.dashboard-stage-placeholder')) container.innerHTML = message;
        }
    }

    private beginPendingSettingWrite(key: string): void {
        this.pendingSettingWriteCounts.set(key, (this.pendingSettingWriteCounts.get(key) ?? 0) + 1);
    }

    private endPendingSettingWrite(key: string): void {
        const count = this.pendingSettingWriteCounts.get(key) ?? 0;
        if (count <= 1) {
            this.pendingSettingWriteCounts.delete(key);
        } else {
            this.pendingSettingWriteCounts.set(key, count - 1);
        }
    }

    private hasPendingSettingWrite(key: string): boolean {
        return this.pendingSettingWriteCounts.has(key);
    }

    private renderRangeLoadError(): void {
        const message = '<div class="card" style="color: var(--accent-red);">Unable to load chart data.</div>';
        for (const host of this.rangeDependentCardHosts()) {
            if (host.querySelector('.dashboard-stage-placeholder')) host.innerHTML = message;
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

}

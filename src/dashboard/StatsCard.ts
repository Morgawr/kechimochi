import { Component } from '../component';
import { html, rawHtml } from '../html';
import { ActivitySummary, DashboardSummary, getAllMedia, getLogs, getProfilePicture, Media, saveLocalSettingValues } from '../api';
import { canonicalAnchor, formatReducedDate, formatStatsDuration } from '../time';
import { formatReadingSpeed } from '../counts';
import { formatContentTypeLabel } from '../media/content_type';
import { getServices } from '../services';
import { Logger } from '../logger';
import { STORAGE_KEYS, DEFAULTS, SETTING_KEYS } from '../constants';
import {
    DEFAULT_READING_REPORT_METRIC,
    READING_CONTENT_TYPES,
    readingReportWindow,
    type ReadingContentType,
    type ReadingReportMetric,
} from '../stats/reading_speed';
import { getReadingReportService, type ReadingReportResult } from '../stats/reading_report_service';
import {
    formatReadingReportDuration,
    interpolateReadingReportValue,
    isReadingReportMotionOff,
    rankReadingContentTypes,
    READING_REPORT_ANIMATION_MS,
} from './reading_report_display';
import { renderBusinessCardButton, wireBusinessCardButton, type ReportCardData } from './reportcard/report_card_controls';

interface StatsCardState {
    summary?: DashboardSummary;
    logs?: ActivitySummary[];
    mediaList?: Media[];
    readingReportMetric?: ReadingReportMetric;
}

function readingSpeedRowSelector(contentType: ReadingContentType): string {
    return `[data-content-type="${contentType}"]`;
}

function formatReadingReportValue(metric: ReadingReportMetric, value: number): string {
    return metric === 'speed' ? formatReadingSpeed(value) : formatReadingReportDuration(value);
}

function activeReadingReportValue(metric: ReadingReportMetric, target: { speed: number; minutes: number }): number {
    return metric === 'speed' ? target.speed : target.minutes;
}

function readingReportRowTitle(metric: ReadingReportMetric, target: { speed: number; minutes: number }): string {
    return metric === 'speed'
        ? `from ${formatStatsDuration(target.minutes)} read`
        : `${formatReadingSpeed(target.speed)} chars per hour`;
}

async function fetchBusinessCardData(): Promise<ReportCardData> {
    const [profilePicture, logs, mediaList] = await Promise.all([
        getProfilePicture().catch(() => null),
        getLogs(),
        getAllMedia(),
    ]);
    return {
        profileName: localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE) || DEFAULTS.PROFILE,
        profilePicture,
        logs,
        mediaList,
    };
}

export class StatsCard extends Component<StatsCardState> {
    private readingReportUnsubscribe: (() => void) | null = null;
    private readingReportMetric: ReadingReportMetric = DEFAULT_READING_REPORT_METRIC;
    private readonly readingReportTargets = new Map<ReadingContentType, { speed: number; minutes: number }>();
    private readonly readingReportDisplayed = new Map<ReadingContentType, number>();
    private readingReportRenderedOrder: ReadingContentType[] = [];
    private readingReportPanelElement: HTMLElement | null = null;
    private readingReportAnimationHandle: number | null = null;

    constructor(container: HTMLElement, initialState: StatsCardState) {
        super(container, initialState);
        this.readingReportMetric = initialState.readingReportMetric ?? DEFAULT_READING_REPORT_METRIC;
    }

    protected onMount(): void {
        this.readingReportUnsubscribe = getReadingReportService().subscribe(result => this.handleReadingReportResult(result));
    }

    public destroy(): void {
        this.readingReportUnsubscribe?.();
        this.cancelReadingReportAnimation();
    }

    render() {
        this.cancelReadingReportAnimation();
        this.clear();
        const logs = this.state.logs ?? [];
        const mediaList = this.state.mediaList ?? [];
        const summary = this.state.summary;
        const totalLogs = summary?.total_logs ?? logs.length;
        const totalMedia = summary?.total_media ?? mediaList.length;

        const uniqueDates = summary
            ? []
            : Array.from(new Set(logs.map(l => l.date))).sort((a, b) => a.localeCompare(b));
        const sinceKey = summary?.first_activity_date ?? uniqueDates[0] ?? null;
        const sinceDate = sinceKey ? formatReducedDate(sinceKey) : 'N/A';
        const loggedDaysCount = Math.max(1, summary?.logged_days ?? uniqueDates.length);

        const legacyStreaks = summary ? null : this.calculateStreaks(uniqueDates);
        const maxStreak = summary?.max_streak ?? legacyStreaks?.maxStreak ?? 0;
        const currentStreak = summary?.current_streak ?? legacyStreaks?.currentStreak ?? 0;
        const legacyBreakdown = summary ? null : this.calculateBreakdown(logs, loggedDaysCount);
        const mediaBreakdown = summary
            ? new Map(summary.activity_totals.map(total => [total.label, {
                mins: total.total_minutes,
                chars: total.total_characters,
                dayScopedMins: total.day_scoped_total_minutes,
            }]))
            : legacyBreakdown!.mediaBreakdown;
        const totalMins = summary?.total_minutes ?? legacyBreakdown!.totalMins;
        const totalChars = summary?.total_characters ?? legacyBreakdown!.totalChars;
        // Coarse-scoped time counts toward every Total tile and toward no daily average.
        const totalAvgFormat = summary
            ? formatStatsDuration(summary.day_scoped_total_minutes / loggedDaysCount)
            : legacyBreakdown!.totalAvgFormat;
        const avgCharsFormat = summary
            ? `${Math.round(summary.day_scoped_total_characters / loggedDaysCount).toLocaleString()} chars`
            : legacyBreakdown!.avgCharsFormat;
        const breakdownHtml = this.renderBreakdown(mediaBreakdown, loggedDaysCount);

        const content = html`
            <div id="study-stats-root" class="card" style="display: flex; flex-direction: column; height: 100%;">
                <div style="text-align: center; margin-bottom: 1rem;">
                    <h3 class="dashboard-card-title">Study Stats</h3>
                    <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7; margin-top: 0.2rem;">Since: ${sinceDate}</div>
                </div>
                <div id="study-stats-content" style="display: flex; flex-direction: column; gap: 0.75rem; flex: 1;">
                    <div id="study-stats-top" style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
                        <div id="study-stats-primary-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%; text-align: center;">
                        <div class="study-stats-metric" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-total-logs" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalLogs}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">logs</div>
                        </div>
                        <div class="study-stats-metric" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-total-media" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalMedia}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">media items</div>
                        </div>
                        <div class="study-stats-metric" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-max-streak" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${maxStreak}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">max streak</div>
                        </div>
                        <div class="study-stats-metric" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-current-streak" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${currentStreak}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">day streak</div>
                        </div>
                        ${totalChars > 0 ? html`
                        <div class="study-stats-metric study-stats-metric-total-chars" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-total-chars" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalChars.toLocaleString()}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">total characters</div>
                        </div>
                        ` : ''}
                        <div class="study-stats-metric study-stats-metric-total-hours" style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); ${totalChars > 0 ? '' : 'grid-column: span 2;'}">
                            <div id="stat-total-hours" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${formatStatsDuration(totalMins)}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">total hours</div>
                        </div>
                        </div>
                    <div id="study-stats-averages" style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
                        <div id="stat-total-avg" style="background: var(--accent-purple); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center; color: var(--accent-text); font-weight: 600; font-size: 0.85rem;">
                            Avg Time: ${totalAvgFormat} / day
                        </div>
                        ${totalChars > 0 ? html`
                        <div id="stat-avg-chars" style="background: var(--accent-purple); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center; color: var(--accent-text); font-weight: 600; font-size: 0.85rem;">
                            Avg Chars: ${avgCharsFormat} / day
                        </div>
                        ` : ''}
                    </div>
                    </div>
                    <div style="width: 100%; height: 1px; background: var(--border-color); margin: 0.2rem 0;"></div>
                    <div id="study-stats-breakdown" style="width: 100%; display: flex; flex-direction: column; gap: 0.4rem;">
                        ${rawHtml(breakdownHtml)}
                        ${this.renderReadingSpeedPanel(summary)}
                    </div>
                    ${getServices().supportsReportCardExport() ? renderBusinessCardButton(totalMins > 0) : ''}
                </div>
            </div>
        `;
        this.container.appendChild(content);
        this.mountReadingReportSection(content);
        wireBusinessCardButton(content, fetchBusinessCardData);
    }

    private rankedReadingContentTypes(): ReadingContentType[] {
        return rankReadingContentTypes(
            contentType => activeReadingReportValue(this.readingReportMetric, this.readingReportTargets.get(contentType) ?? { speed: 0, minutes: 0 }),
            contentType => this.readingReportTargets.get(contentType)?.speed ?? 0,
        );
    }

    private renderReadingSpeedPanel(summary?: DashboardSummary): HTMLElement | '' {
        this.readingReportRenderedOrder = [];
        const result = getReadingReportService().getLastResult();
        if (!result) return '';

        for (const contentType of READING_CONTENT_TYPES) {
            this.readingReportTargets.set(contentType, {
                speed: result.speeds[contentType],
                minutes: result.minutes[contentType],
            });
        }

        const visibleContentTypes = this.rankedReadingContentTypes();
        if (visibleContentTypes.length === 0) return '';
        this.readingReportRenderedOrder = visibleContentTypes;

        const reportWindow = readingReportWindow(new Date());
        const windowText = summary?.first_activity_date && canonicalAnchor(summary.first_activity_date, 'day') >= reportWindow.cutoff
            ? `Since ${summary.first_activity_date}`
            : 'last 12 months';
        const unitText = this.readingReportMetric === 'speed' ? 'chars per hour' : 'hours read';

        const rows = visibleContentTypes.map((contentType, rank) => {
            const target = this.readingReportTargets.get(contentType)!;
            const activeValue = activeReadingReportValue(this.readingReportMetric, target);
            const displayText = formatReadingReportValue(this.readingReportMetric, activeValue);
            this.readingReportDisplayed.set(contentType, activeValue);
            return html`
                <div class="dashboard-reading-speed-row ${rank === 0 ? 'is-top' : ''}" data-content-type="${contentType}" title="${readingReportRowTitle(this.readingReportMetric, target)}">
                    <span class="dashboard-reading-speed-row-label">${formatContentTypeLabel(contentType)}</span>
                    <span class="dashboard-reading-speed-row-value">${displayText}</span>
                </div>
            `;
        });

        const isSpeed = this.readingReportMetric === 'speed';
        return html`
            <div id="dashboard-reading-speed" class="dashboard-reading-speed-panel">
                <div class="dashboard-reading-speed-tabs" role="tablist" aria-label="Reading Speed metric">
                    <button type="button" role="tab" class="dashboard-reading-speed-tab ${isSpeed ? 'is-active' : ''}" id="reading-speed-toggle-speed" aria-selected="${isSpeed.toString()}"><span class="dashboard-reading-speed-tab-label">Speed</span></button>
                    <button type="button" role="tab" class="dashboard-reading-speed-tab ${isSpeed ? '' : 'is-active'}" id="reading-speed-toggle-time" aria-selected="${(!isSpeed).toString()}"><span class="dashboard-reading-speed-tab-label">Time</span></button>
                </div>
                <div class="dashboard-reading-speed-rows" role="tabpanel">
                    ${rows}
                    <div class="dashboard-reading-speed-caption">
                        <span>${windowText}</span>
                        <span>${unitText}</span>
                    </div>
                </div>
            </div>
        `;
    }

    private mountReadingReportSection(root: HTMLElement): void {
        this.readingReportPanelElement = root.querySelector<HTMLElement>('#dashboard-reading-speed');
        const speedOption = root.querySelector<HTMLButtonElement>('#reading-speed-toggle-speed');
        const timeOption = root.querySelector<HTMLButtonElement>('#reading-speed-toggle-time');
        speedOption?.addEventListener('click', () => this.setReadingReportMetric('speed'));
        timeOption?.addEventListener('click', () => this.setReadingReportMetric('time'));
    }

    private refreshReadingReportRowTitles(): void {
        for (const contentType of this.readingReportRenderedOrder) {
            const row = this.readingReportPanelElement?.querySelector<HTMLElement>(readingSpeedRowSelector(contentType));
            const target = this.readingReportTargets.get(contentType);
            if (row && target) row.title = readingReportRowTitle(this.readingReportMetric, target);
        }
    }

    private setReadingReportMetric(metric: ReadingReportMetric): void {
        if (this.readingReportMetric === metric) return;
        this.cancelReadingReportAnimation();
        this.readingReportMetric = metric;
        this.render();
        saveLocalSettingValues({ values: { [SETTING_KEYS.DASHBOARD_READING_REPORT_METRIC]: metric } })
            .catch(error => Logger.error('[reading-speed] failed to save metric toggle', error));
    }

    private isReadingReportCardVisible(): boolean {
        if (document.visibilityState !== 'visible') return false;
        const root = this.container.querySelector<HTMLElement>('#dashboard-reading-speed');
        return root !== null && root.offsetParent !== null;
    }

    private handleReadingReportResult(result: ReadingReportResult): void {
        this.cancelReadingReportAnimation();

        const previousOrder = this.readingReportRenderedOrder;
        const startValues = new Map<ReadingContentType, number>();
        for (const contentType of READING_CONTENT_TYPES) {
            const hadRow = previousOrder.includes(contentType);
            startValues.set(contentType, hadRow ? this.readingReportDisplayed.get(contentType) ?? 0 : 0);
            this.readingReportTargets.set(contentType, { speed: result.speeds[contentType], minutes: result.minutes[contentType] });
        }

        const nextOrder = this.rankedReadingContentTypes();
        const orderChanged = nextOrder.length !== previousOrder.length
            || nextOrder.some((contentType, index) => contentType !== previousOrder[index]);
        if (orderChanged || !this.readingReportPanelElement) this.render();
        else this.refreshReadingReportRowTitles();

        const animations = new Map<ReadingContentType, { start: number; target: number }>();
        for (const contentType of READING_CONTENT_TYPES) {
            if (result.speeds[contentType] <= 0) continue;
            const target = activeReadingReportValue(this.readingReportMetric, this.readingReportTargets.get(contentType)!);
            const start = startValues.get(contentType) ?? 0;
            if (Math.round(start) === Math.round(target)) continue;
            animations.set(contentType, { start, target });
        }

        if (animations.size === 0) return;

        if (!this.isReadingReportCardVisible() || isReadingReportMotionOff()) {
            for (const [contentType, entry] of animations) this.writeReadingReportRow(contentType, entry.target);
            return;
        }

        for (const [contentType, entry] of animations) this.writeReadingReportRow(contentType, entry.start);
        this.startReadingReportAnimation(animations);
    }

    private writeReadingReportRow(contentType: ReadingContentType, value: number): void {
        const row = this.readingReportPanelElement?.querySelector<HTMLElement>(`${readingSpeedRowSelector(contentType)} .dashboard-reading-speed-row-value`);
        if (!row) return;
        row.textContent = formatReadingReportValue(this.readingReportMetric, value);
        this.readingReportDisplayed.set(contentType, value);
    }

    private cancelReadingReportAnimation(): void {
        if (this.readingReportAnimationHandle !== null) {
            cancelAnimationFrame(this.readingReportAnimationHandle);
            this.readingReportAnimationHandle = null;
        }
    }

    private startReadingReportAnimation(entries: Map<ReadingContentType, { start: number; target: number }>): void {
        this.cancelReadingReportAnimation();
        if (entries.size === 0) return;

        let startTimestamp: number | null = null;
        const step = (timestamp: number) => {
            startTimestamp ??= timestamp;
            if (isReadingReportMotionOff() || !this.isReadingReportCardVisible()) {
                for (const [contentType, entry] of entries) this.writeReadingReportRow(contentType, entry.target);
                this.readingReportAnimationHandle = null;
                return;
            }

            const elapsedMs = timestamp - startTimestamp;
            for (const [contentType, entry] of entries) {
                const value = interpolateReadingReportValue(entry.start, entry.target, elapsedMs, READING_REPORT_ANIMATION_MS);
                this.writeReadingReportRow(contentType, value);
            }

            if (elapsedMs >= READING_REPORT_ANIMATION_MS) {
                this.readingReportAnimationHandle = null;
                return;
            }
            this.readingReportAnimationHandle = requestAnimationFrame(step);
        };
        this.readingReportAnimationHandle = requestAnimationFrame(step);
    }

    private calculateStreaks(uniqueDates: string[]) {
        if (uniqueDates.length === 0) return { maxStreak: 0, currentStreak: 0 };

        let maxStreak = 1;
        let streakCount = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
            const d1 = new Date(uniqueDates[i - 1]);
            const d2 = new Date(uniqueDates[i]);
            const diffInDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
            if (diffInDays === 1) {
                streakCount++;
                if (streakCount > maxStreak) maxStreak = streakCount;
            } else {
                streakCount = 1;
            }
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const lastLogD = new Date(uniqueDates[uniqueDates.length - 1]);
        const todayD = new Date(todayStr);
        const diffToday = Math.round((todayD.getTime() - lastLogD.getTime()) / (1000 * 3600 * 24));

        let currentStreak = 0;
        if (diffToday <= 1) {
            currentStreak = 1;
            for (let i = uniqueDates.length - 1; i >= 1; i--) {
                const currD = new Date(uniqueDates[i]);
                const prevD = new Date(uniqueDates[i - 1]);
                const diffInDays = Math.round((currD.getTime() - prevD.getTime()) / (1000 * 3600 * 24));
                if (diffInDays === 1) currentStreak++;
                else break;
            }
        }

        return { maxStreak, currentStreak };
    }

    private calculateBreakdown(logs: ActivitySummary[], loggedDaysCount: number) {
        const mediaBreakdown = new Map<string, { mins: number, chars: number, dayScopedMins: number }>();
        for (const log of logs) {
            const current = mediaBreakdown.get(log.activity_type) || { mins: 0, chars: 0, dayScopedMins: 0 };
            mediaBreakdown.set(log.activity_type, {
                mins: current.mins + log.duration_minutes,
                chars: current.chars + (log.characters || 0),
                dayScopedMins: current.dayScopedMins + log.duration_minutes,
            });
        }
        
        let totalMins = 0;
        let totalChars = 0;
        mediaBreakdown.forEach(v => { 
            totalMins += v.mins;
            totalChars += v.chars;
        });
        const totalAvgMins = totalMins / loggedDaysCount;
        const avgChars = totalChars / loggedDaysCount;
        
        return { 
            mediaBreakdown, 
            totalAvgFormat: formatStatsDuration(totalAvgMins),
            totalMins,
            totalChars,
            avgCharsFormat: `${Math.round(avgChars).toLocaleString()} chars`
        };
    }

    private renderBreakdown(mediaBreakdown: Map<string, { mins: number, chars: number, dayScopedMins: number }>, loggedDaysCount: number): string {
        const sortedBreakdown = Array.from(mediaBreakdown.entries()).sort((a, b) => b[1].mins - a[1].mins);
        return sortedBreakdown.map(([mtype, data]) => {
            const totalFormat = formatStatsDuration(data.mins);
            const avgFormat = formatStatsDuration(data.dayScopedMins / loggedDaysCount);
            const charStr = data.chars > 0 ? `<div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8;">
                        <span>Total Characters:</span>
                        <span>${data.chars.toLocaleString()}</span>
                    </div>` : '';

            return `
                <div class="study-stats-breakdown-item" style="display: flex; flex-direction: column; gap: 0.2rem; background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span style="color: var(--text-secondary);">${mtype}</span>
                        <span style="font-weight: bold; color: var(--text-primary);">${totalFormat}</span>
                    </div>
                    ${charStr}
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8;">
                        <span>Daily Avg:</span>
                        <span>${avgFormat}</span>
                    </div>
                </div>
            `;
        }).join('');
    }
}

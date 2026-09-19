import { Component } from '../../component';
import { ActivitySummary, DashboardMedia, DashboardRangeResponse, DashboardWeekdayDistribution, DashboardWeekdayStats, Media } from '../../api';
import { escapeHTML } from '../../html';
import { formatCount, formatOptionalCount } from '../../count_formatting';
import { formatOptionalStatsDuration, formatStatsDuration } from '../../time';
import { getActivityRange, getLocalISODate, getPreviousBucketKey, normalizeWeekStartDay, resolveRangeLogs, type ActivityPeriod, type ActivityRange } from '../activity_ranges';
import { MediaCoverLoader } from '../../media/cover_loader';
import { Logger } from '../../logger';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataEmptyState } from '../card_shell';

export const WEEKDAY_DISTRIBUTION_CARD = {
    id: 'weekday_distribution',
    label: 'Weekday Rhythm',
    spans: { wide: 4, medium: 6 },
    dataSources: ['weekdayDistribution'],
} as const satisfies DashboardCardDescriptor;

export const PERIOD_STATS_CARD = {
    id: 'period_stats',
    label: 'Period Stats',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

export const CATEGORIES_CARD = {
    id: 'categories',
    label: 'Categories',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

export const HIGHLIGHTS_CARD = {
    id: 'highlights',
    label: 'Highlights',
    spans: { wide: 8, medium: 12 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

export type ActivityTotalsHostId = 'weekday_distribution' | 'period_stats' | 'categories' | 'highlights';

const MOBILE_HIGHLIGHT_LAYOUT_QUERY = '(max-width: 1024px)';
const DESKTOP_HIGHLIGHTS_PER_PAGE = 3;

interface ActivityTotalsState {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    timeRangeDays: number;
    timeRangeOffset: number;
    weekStartDay: number;
    metric?: 'minutes' | 'characters';
    selectedBucketIndex?: number;
    weekdayDistribution?: DashboardWeekdayDistribution;
}

interface Totals {
    minutes: number;
    characters: number;
}

interface BucketRow {
    key: string;
    label: string;
    subject: string;
    dayOfMonth?: string;
    weekday?: string;
    startsWeek?: boolean;
    totals: Totals;
    isCurrent: boolean;
    isSelected: boolean;
    selectable: boolean;
    spansLabel?: boolean;
}

interface TotalsColumns {
    showCharacters: boolean;
    showHours: boolean;
}

type MediaTotalsEntry = {
    media: Media;
    totals: Totals & { sessions: number; dates: Set<string> };
};

interface HighlightCard {
    key: string;
    title: string;
    label: string;
    value: string;
    detail: string;
    media?: Media | DashboardMedia;
    tone: 'time' | 'chars' | 'sessions' | 'day' | 'streak' | 'category';
}

export class ActivityTotals extends Component<ActivityTotalsState> {
    private readonly attemptedCoverIds = new Set<number>();
    private readonly coverUrls: Record<number, string> = {};
    private highlightPage = 0;
    private highlightsPerPage = 2;
    private mobileLayoutQuery: MediaQueryList | null = null;
    private lastIsMobile: boolean = false;
    private readonly hosts: ReadonlyMap<ActivityTotalsHostId, HTMLElement>;
    private readonly onCardsRendered: () => void;

    constructor(
        container: HTMLElement,
        hosts: ReadonlyMap<ActivityTotalsHostId, HTMLElement>,
        initialState: ActivityTotalsState,
        onCardsRendered: () => void = () => {},
    ) {
        super(container, initialState);
        this.hosts = hosts;
        this.onCardsRendered = onCardsRendered;
    }

    protected override clear(): void {
        for (const host of this.hosts.values()) {
            host.replaceChildren();
        }
    }

    protected override onMount() {
        this.lastIsMobile = this.isMobileHighlightLayout();
        this.mobileLayoutQuery = globalThis.matchMedia?.(MOBILE_HIGHLIGHT_LAYOUT_QUERY) ?? null;
        this.mobileLayoutQuery?.addEventListener('change', this.handleMobileLayoutChange);
    }

    private readonly handleMobileLayoutChange = (event: MediaQueryListEvent): void => {
        if (event.matches === this.lastIsMobile) return;
        this.lastIsMobile = event.matches;
        // Reset pagination when layout mode changes
        this.highlightPage = 0;
        this.render();
    };

    public override destroy(): void {
        this.mobileLayoutQuery?.removeEventListener('change', this.handleMobileLayoutChange);
        super.destroy();
    }

    public setState(newState: Partial<ActivityTotalsState>) {
        const timeframeChanged = newState.timeRangeDays !== undefined && newState.timeRangeDays !== this.state.timeRangeDays
            || newState.timeRangeOffset !== undefined && newState.timeRangeOffset !== this.state.timeRangeOffset
            || newState.weekStartDay !== undefined && newState.weekStartDay !== this.state.weekStartDay;

        this.state = {
            ...this.state,
            ...newState,
            selectedBucketIndex: timeframeChanged ? undefined : newState.selectedBucketIndex ?? this.state.selectedBucketIndex,
        };
        if (timeframeChanged) this.highlightPage = 0;
        this.render();
    }

    render() {
        this.clear();
        this.renderSectionInto('weekday_distribution', this.renderWeekdayDistributionPanel());
        if (this.state.rangeData === undefined && this.state.logs === undefined) {
            this.onCardsRendered();
            return;
        }

        const rangeLogs = resolveRangeLogs(this.state.logs, this.state.rangeData);
        const range = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay);
        const unbucketedRowLabel = this.getUnbucketedRowLabel(range.period);
        const { totals: bucketTotals, unbucketedTotals } = this.getBucketTotals(
            range.labels.length,
            range.getBucketIndex,
            unbucketedRowLabel !== null,
        );
        const currentIndex = this.getCurrentBucketIndex(range.getBucketIndex, bucketTotals.length);
        const selectedIndex = this.state.selectedBucketIndex ?? currentIndex;
        const categoryTotals = this.getCategoryTotals(range.validStart, range.validEnd);
        const weekStartDay = normalizeWeekStartDay(this.state.weekStartDay);
        const bucketRows: BucketRow[] = bucketTotals.map((totals, index) => {
            const meta = this.getBucketMeta(range.labels[index], index, range.unit, range.validStart);
            return {
                key: String(index),
                label: meta.label,
                subject: meta.subject,
                dayOfMonth: meta.dayOfMonth,
                weekday: meta.weekday,
                startsWeek: range.period === 'month'
                    && index > 0
                    && new Date(range.labels[index] + 'T00:00:00').getDay() === weekStartDay,
                totals,
                isCurrent: index === currentIndex,
                isSelected: index === selectedIndex,
                selectable: true,
            };
        });
        const statsTableRows: BucketRow[] = unbucketedRowLabel ? [...bucketRows, {
            key: 'unbucketed',
            label: unbucketedRowLabel,
            subject: unbucketedRowLabel,
            totals: unbucketedTotals,
            isCurrent: false,
            isSelected: false,
            selectable: false,
            spansLabel: true,
        }] : bucketRows;
        const categoryRows: BucketRow[] = categoryTotals.map(([category, totals]) => ({
            key: category,
            label: category,
            subject: category,
            totals,
            isCurrent: false,
            isSelected: false,
            selectable: false,
        }));
        const selectedSubject = bucketRows[selectedIndex]?.subject || this.getCurrentSubjectLabel(range.unit);
        const highlights = this.getHighlights(range.validStart, range.validEnd, categoryTotals);
        const today = getLocalISODate(new Date());
        const isTodayInRange = today >= range.validStart && today <= range.validEnd;

        this.renderSectionInto('period_stats', this.renderStatsPanel(range, bucketTotals, statsTableRows, selectedIndex, currentIndex, selectedSubject, isTodayInRange));
        this.renderSectionInto('categories', this.renderCategoriesPanel(categoryRows, isTodayInRange));
        this.renderSectionInto('highlights', this.renderHighlightsPanel(highlights, isTodayInRange));

        this.setupListeners(this.container);
        this.setupHighlights(this.container, highlights);
        this.onCardsRendered();
    }

    private renderSectionInto(hostId: ActivityTotalsHostId, sectionHtml: string): void {
        const host = this.hosts.get(hostId);
        if (!host || !sectionHtml) return;
        host.insertAdjacentHTML('beforeend', sectionHtml);
    }

    private setupListeners(root: HTMLElement) {
        root.querySelectorAll<HTMLButtonElement>('[data-dashboard-total-index]').forEach(button => {
            button.addEventListener('click', () => {
                const selectedBucketIndex = Number.parseInt(button.dataset.dashboardTotalIndex || '', 10);
                if (Number.isFinite(selectedBucketIndex)) {
                    this.setState({ selectedBucketIndex });
                }
            });
        });
    }

    private setupHighlights(root: HTMLElement, highlights: HighlightCard[]) {
        const card = root.querySelector<HTMLElement>('.dashboard-highlights-card');

        if (!card) return;

        root.querySelector<HTMLButtonElement>('[data-highlights-dir="prev"]')?.addEventListener('click', () => {
            this.highlightPage = Math.max(0, this.highlightPage - 1);
            this.render();
        });
        root.querySelector<HTMLButtonElement>('[data-highlights-dir="next"]')?.addEventListener('click', () => {
            this.highlightPage = Math.min(this.getHighlightMaxPage(highlights.length), this.highlightPage + 1);
            this.render();
        });

        this.ensureHighlightCovers(highlights).catch(error => {
            Logger.error('Failed to load dashboard highlight covers', error);
        });
    }

    private renderStatsPanel(
        range: ActivityRange,
        bucketTotals: Totals[],
        rows: BucketRow[],
        selectedIndex: number,
        currentIndex: number,
        selectedSubject: string,
        isTodayInRange: boolean,
    ): string {
        const columns = this.getTotalsColumns(rows);
        const body = this.hasVisibleTotals(columns) ? `
            ${this.renderTotalsTable(this.getUnitHeader(range.unit), rows, columns, range.unit === 'day')}
            ${this.renderSelectedSummary(
            range,
            bucketTotals,
            selectedIndex,
            range.unit,
            this.state.timeRangeOffset === 0 && selectedIndex === currentIndex,
            selectedSubject,
            columns,
        )}
        ` : renderNoPeriodDataEmptyState(isTodayInRange);

        return renderDashboardCardShell({ title: `${this.getTitle(range.period)} Stats`, body });
    }

    private renderCategoriesPanel(categoryRows: BucketRow[], isTodayInRange: boolean): string {
        const columns = this.getTotalsColumns(categoryRows);
        const body = this.hasVisibleTotals(columns)
            ? this.renderTotalsTable('Title', categoryRows, columns)
            : renderNoPeriodDataEmptyState(isTodayInRange);

        return renderDashboardCardShell({ title: CATEGORIES_CARD.label, body });
    }

    private renderHighlightsPanel(highlights: HighlightCard[], isTodayInRange: boolean): string {
        if (highlights.length === 0) {
            return renderDashboardCardShell({
                title: HIGHLIGHTS_CARD.label,
                body: renderNoPeriodDataEmptyState(isTodayInRange),
                cardClasses: ['dashboard-highlights-card'],
            });
        }

        const isMobile = this.isMobileHighlightLayout();
        const pageSize = isMobile ? highlights.length : DESKTOP_HIGHLIGHTS_PER_PAGE;
        this.highlightsPerPage = pageSize;
        const maxPage = this.getHighlightMaxPage(highlights.length);
        this.highlightPage = Math.min(this.highlightPage, maxPage);
        const start = this.highlightPage * pageSize;
        const visibleHighlights = highlights.slice(start, start + pageSize);
        const needsPagination = !isMobile && highlights.length > pageSize;
        const headerExtras = needsPagination
            ? `<span class="dashboard-highlights-page-count">${this.highlightPage + 1}/${maxPage + 1}</span>`
            : '';

        return renderDashboardCardShell({
            title: HIGHLIGHTS_CARD.label,
            body: this.renderHighlightsBody(visibleHighlights, needsPagination, maxPage),
            headerExtras,
            cardClasses: ['dashboard-highlights-card'],
        });
    }

    private renderHighlightsBody(visibleHighlights: HighlightCard[], needsPagination: boolean, maxPage: number): string {
        const grid = `
            <div class="dashboard-highlights-viewport">
                <div class="dashboard-highlights-grid">
                    ${visibleHighlights.map(highlight => this.renderHighlightCard(highlight)).join('')}
                </div>
            </div>
        `;
        if (!needsPagination) return grid;

        const disableLeftPageArrow = this.highlightPage === 0 ? 'disabled' : '';
        const disableRightPageArrow = this.highlightPage >= maxPage ? 'disabled' : '';
        return `
            <div class="dashboard-highlights-shell">
                <button type="button" class="dashboard-highlights-nav" data-highlights-dir="prev" ${disableLeftPageArrow} aria-label="Previous highlights">
                    <svg width="12" height="28" viewBox="0 0 12 28" fill="none">
                        <path d="M8 4L3 14L8 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                ${grid}
                <button type="button" class="dashboard-highlights-nav" data-highlights-dir="next" ${disableRightPageArrow} aria-label="Next highlights">
                    <svg width="12" height="28" viewBox="0 0 12 28" fill="none">
                        <path d="M4 4L9 14L4 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        `;
    }

    private renderWeekdayDistributionPanel(): string {
        const distribution = this.state.weekdayDistribution;
        const metric = this.state.metric ?? 'minutes';
        const emptyMetricLabel = metric === 'minutes' ? 'timed' : 'character';
        const emptyBody = `
            <div class="dashboard-weekday-empty">
                <span aria-hidden="true">◇</span>
                <p>No ${emptyMetricLabel} activity in the last 6 months.</p>
            </div>
        `;

        if (!distribution) {
            return renderDashboardCardShell({
                title: WEEKDAY_DISTRIBUTION_CARD.label,
                body: emptyBody,
                cardClasses: ['dashboard-weekday-card'],
                attributes: { 'data-metric': metric },
            });
        }

        const daysByWeekday = new Map(distribution.days.map(day => [day.weekday, day]));
        const orderedDays = Array.from({ length: 7 }, (_, index) => {
            const weekday = (this.state.weekStartDay + index) % 7;
            return daysByWeekday.get(weekday) ?? {
                weekday,
                average_minutes: 0,
                median_minutes: 0,
                average_characters: 0,
                median_characters: 0,
                sample_days: 0,
            };
        });
        const hasActivity = orderedDays.some(day => this.getRadarAverage(day, metric) > 0);
        const body = hasActivity ? this.renderWeekdayRadar(orderedDays, metric) : emptyBody;

        return renderDashboardCardShell({
            title: WEEKDAY_DISTRIBUTION_CARD.label,
            body,
            cardClasses: ['dashboard-weekday-card'],
            attributes: {
                'data-range-start': distribution.start_date,
                'data-range-end': distribution.end_date,
                'data-metric': metric,
            },
        });
    }

    private renderWeekdayRadar(days: DashboardWeekdayStats[], metric: 'minutes' | 'characters'): string {
        const centerX = 160;
        const centerY = 148;
        const radius = 126;
        const averages = days.map(day => this.getRadarAverage(day, metric));
        const medians = days.map(day => this.getRadarMedian(day, metric));
        const scaleStep = metric === 'minutes' ? 60 : 10_000;
        const roundedLimit = Math.max(Math.ceil(Math.max(...averages) / scaleStep) * scaleStep, scaleStep);
        const chartLimit = metric === 'minutes' ? Math.min(roundedLimit, 24 * 60) : roundedLimit;
        const labelRadius = radius + 20;
        const pointAt = (index: number, distance: number) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / days.length;
            return {
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
            };
        };
        const polygon = (values: number[]) => values
            .map((value, index) => {
                const normalized = Math.min(Math.max(value, 0), chartLimit) / chartLimit;
                const point = pointAt(index, radius * normalized);
                return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
            })
            .join(' ');
        const ringPoints = (scale: number) => Array.from({ length: days.length }, (_, index) => {
            const point = pointAt(index, radius * scale);
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        }).join(' ');
        const averagePoints = polygon(averages);
        const medianPoints = polygon(medians);
        const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const accessibleSummary = days.map(day => {
            const label = weekdayLabels[day.weekday] ?? '';
            return `${label}: average ${this.formatRadarValue(this.getRadarAverage(day, metric), metric)}, median ${this.formatRadarValue(this.getRadarMedian(day, metric), metric)}`;
        }).join('; ');

        return `
            <figure class="dashboard-weekday-figure">
                <svg class="dashboard-weekday-radar" viewBox="0 0 320 306" role="img" data-metric="${metric}"
                    aria-label="Weekday activity distribution. ${escapeHTML(accessibleSummary)}">
                    <g class="dashboard-weekday-grid" aria-hidden="true">
                        ${[0.25, 0.5, 0.75, 1].map(scale => `<polygon points="${ringPoints(scale)}"></polygon>`).join('')}
                        ${days.map((_, index) => {
                            const point = pointAt(index, radius);
                            return `<line x1="${centerX}" y1="${centerY}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}"></line>`;
                        }).join('')}
                    </g>
                    <g class="dashboard-weekday-scale" aria-hidden="true">
                        ${[0.25, 0.5, 0.75, 1].map(scale => `<text x="${centerX + 4}" y="${(centerY - radius * scale + 3).toFixed(2)}">${this.formatRadarScaleValue(chartLimit * scale, metric)}</text>`).join('')}
                    </g>
                    <polygon class="dashboard-weekday-average" points="${averagePoints}"></polygon>
                    <polygon class="dashboard-weekday-median" points="${medianPoints}"></polygon>
                    ${days.map((day, index) => {
                        const average = this.getRadarAverage(day, metric);
                        const median = this.getRadarMedian(day, metric);
                        const point = pointAt(index, radius * Math.min(average, chartLimit) / chartLimit);
                        const label = weekdayLabels[day.weekday] ?? '';
                        const title = `${label}: avg ${this.formatRadarValue(average, metric)}, median ${this.formatRadarValue(median, metric)}`;
                        return `<circle class="dashboard-weekday-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5"
                            data-weekday="${day.weekday}" data-average="${average}" data-median="${median}"><title>${escapeHTML(title)}</title></circle>`;
                    }).join('')}
                    ${days.map((day, index) => {
                        const point = pointAt(index, labelRadius);
                        let anchor = 'middle';
                        if (point.x < centerX - 8) anchor = 'end';
                        if (point.x > centerX + 8) anchor = 'start';
                        return `<text class="dashboard-weekday-label" x="${point.x.toFixed(2)}" y="${(point.y + 4).toFixed(2)}" text-anchor="${anchor}">${weekdayLabels[day.weekday] ?? ''}</text>`;
                    }).join('')}
                </svg>
                <figcaption class="dashboard-weekday-legend">
                    <span><i class="is-average"></i>Average</span>
                    <span><i class="is-median"></i>Median</span>
                </figcaption>
            </figure>
        `;
    }

    private getRadarAverage(day: DashboardWeekdayStats, metric: 'minutes' | 'characters'): number {
        return metric === 'minutes' ? day.average_minutes : day.average_characters;
    }

    private getRadarMedian(day: DashboardWeekdayStats, metric: 'minutes' | 'characters'): number {
        return metric === 'minutes' ? day.median_minutes : day.median_characters;
    }

    private formatRadarScaleValue(value: number, metric: 'minutes' | 'characters'): string {
        if (metric === 'characters') return Math.round(value).toLocaleString();
        return this.formatRadarValue(value, metric);
    }

    private formatRadarValue(value: number, metric: 'minutes' | 'characters'): string {
        if (metric === 'characters') return `${Math.round(value).toLocaleString()} characters`;
        if (value <= 0) return '0m';
        return formatStatsDuration(Math.round(value));
    }

    private getTotalsColumns(rows: Array<{ totals: Totals }>): TotalsColumns {
        return {
            showCharacters: rows.some(row => row.totals.characters > 0),
            showHours: rows.some(row => row.totals.minutes > 0),
        };
    }

    private hasVisibleTotals(columns: TotalsColumns): boolean {
        return columns.showCharacters || columns.showHours;
    }

    private getBucketTotals(length: number, getBucketIndex: (dateStr: string) => number, collectUnbucketed: boolean): { totals: Totals[]; unbucketedTotals: Totals } {
        const totals = Array.from({ length }, () => ({ minutes: 0, characters: 0 }));
        const unbucketedTotals: Totals = { minutes: 0, characters: 0 };
        const bucketTotals = this.state.rangeData?.bucket_totals;
        if (bucketTotals) {
            this.accumulateBackendBuckets(bucketTotals, totals, unbucketedTotals, getBucketIndex, collectUnbucketed);
        } else {
            this.accumulateLogBuckets(totals, unbucketedTotals, getBucketIndex, collectUnbucketed);
        }
        return { totals, unbucketedTotals };
    }

    private accumulateBackendBuckets(
        bucketTotals: DashboardRangeResponse['bucket_totals'],
        totals: Totals[],
        unbucketedTotals: Totals,
        getBucketIndex: (dateStr: string) => number,
        collectUnbucketed: boolean,
    ): void {
        for (const bucket of bucketTotals) {
            if (bucket.bucket === null) {
                if (!collectUnbucketed) continue;
                unbucketedTotals.minutes += bucket.total_minutes;
                unbucketedTotals.characters += bucket.total_characters;
                continue;
            }
            const index = getBucketIndex(bucket.bucket);
            if (index === -1) continue;
            totals[index].minutes += bucket.total_minutes;
            totals[index].characters += bucket.total_characters;
        }
    }

    private accumulateLogBuckets(
        totals: Totals[],
        unbucketedTotals: Totals,
        getBucketIndex: (dateStr: string) => number,
        collectUnbucketed: boolean,
    ): void {
        for (const log of this.state.logs ?? []) {
            const index = getBucketIndex(log.date);
            if (index === -1) continue;
            if (log.date_precision !== 'day') {
                if (!collectUnbucketed) continue;
                unbucketedTotals.minutes += log.duration_minutes;
                unbucketedTotals.characters += log.characters || 0;
                continue;
            }
            totals[index].minutes += log.duration_minutes;
            totals[index].characters += log.characters || 0;
        }
    }

    private getUnbucketedRowLabel(period: ActivityPeriod): string | null {
        switch (period) {
            case 'month': return 'Month-scoped';
            case 'year': return 'Year-scoped';
            default: return null;
        }
    }

    private getCategoryTotals(validStart: string, validEnd: string): Array<[string, Totals]> {
        if (this.state.rangeData) {
            return this.state.rangeData.category_totals.map(total => [total.label, {
                minutes: total.total_minutes,
                characters: total.total_characters,
            }]);
        }

        const mediaById = new Map((this.state.mediaList ?? []).filter(media => media.id !== undefined).map(media => [media.id, media]));
        const totalsByCategory = new Map<string, Totals>();

        for (const log of this.state.logs ?? []) {
            if (log.date < validStart || log.date > validEnd) continue;
            const media = mediaById.get(log.media_id);
            const category = media?.content_type || media?.default_activity_type || log.activity_type || 'Unknown';
            const current = totalsByCategory.get(category) || { minutes: 0, characters: 0 };
            totalsByCategory.set(category, {
                minutes: current.minutes + log.duration_minutes,
                characters: current.characters + (log.characters || 0),
            });
        }

        return Array.from(totalsByCategory.entries())
            .sort((a, b) => b[1].minutes - a[1].minutes || b[1].characters - a[1].characters);
    }

    private getHighlights(
        validStart: string,
        validEnd: string,
        categoryTotals: ReadonlyArray<[string, Totals]>,
    ): HighlightCard[] {
        const highlights = this.state.rangeData
            ? this.state.rangeData.highlights
                .map(highlight => this.toHighlightCard(highlight))
                .filter((highlight): highlight is HighlightCard => highlight !== null)
            : this.getLegacyHighlights(validStart, validEnd);

        const topCategory = this.getTopCategoryHighlight(categoryTotals);
        return topCategory === null ? highlights : [...highlights, topCategory];
    }

    private getLegacyHighlights(validStart: string, validEnd: string): HighlightCard[] {
        const mediaById = new Map((this.state.mediaList ?? []).filter(media => media.id !== undefined).map(media => [media.id!, media]));
        const mediaTotals = new Map<number, Totals & { sessions: number; dates: Set<string> }>();
        const dayTotals = new Map<string, Totals>();

        for (const log of this.state.logs ?? []) {
            if (log.date < validStart || log.date > validEnd) continue;
            const media = mediaById.get(log.media_id);
            if (!media) continue;

            const mediaCurrent = mediaTotals.get(log.media_id) ?? { minutes: 0, characters: 0, sessions: 0, dates: new Set<string>() };
            mediaCurrent.minutes += log.duration_minutes;
            mediaCurrent.characters += log.characters || 0;
            mediaCurrent.sessions += 1;
            mediaCurrent.dates.add(log.date);
            mediaTotals.set(log.media_id, mediaCurrent);

            const dayCurrent = dayTotals.get(log.date) || { minutes: 0, characters: 0 };
            dayTotals.set(log.date, {
                minutes: dayCurrent.minutes + log.duration_minutes,
                characters: dayCurrent.characters + (log.characters || 0),
            });
        }

        const byMedia: MediaTotalsEntry[] = Array.from(mediaTotals.entries())
            .map(([mediaId, totals]) => ({ media: mediaById.get(mediaId)!, totals }))
            .filter(entry => entry.media);

        const mostTime = this.getTopMediaEntry(byMedia, (a, b) => b.totals.minutes - a.totals.minutes);
        const mostChars = this.getTopMediaEntry(byMedia, (a, b) => b.totals.characters - a.totals.characters);
        const mostSessions = this.getTopMediaEntry(byMedia, (a, b) => b.totals.sessions - a.totals.sessions);
        const biggestStreak = byMedia
            .map(entry => ({ ...entry, streak: this.getLongestStreak(Array.from(entry.totals.dates)) }))
            .sort((a, b) => b.streak - a.streak || b.totals.minutes - a.totals.minutes)[0];
        const biggestDay = Array.from(dayTotals.entries())
            .sort((a, b) => b[1].minutes - a[1].minutes || b[1].characters - a[1].characters)[0];

        const highlights: Array<HighlightCard | undefined> = [
            mostTime && mostTime.totals.minutes > 0 ? {
                key: 'most-time',
                title: 'Most Time Spent',
                label: mostTime.media.title,
                value: formatStatsDuration(mostTime.totals.minutes),
                detail: formatOptionalCount(mostTime.totals.characters, 'char'),
                media: mostTime.media,
                tone: 'time' as const,
            } : undefined,
            mostChars && mostChars.totals.characters > 0 ? {
                key: 'most-chars',
                title: 'Most Characters Read',
                label: mostChars.media.title,
                value: formatCount(mostChars.totals.characters, 'char'),
                detail: formatOptionalStatsDuration(mostChars.totals.minutes),
                media: mostChars.media,
                tone: 'chars' as const,
            } : undefined,
            mostSessions && mostSessions.totals.sessions > 0 ? {
                key: 'most-sessions',
                title: 'Most Sessions',
                label: mostSessions.media.title,
                value: formatCount(mostSessions.totals.sessions, 'session'),
                detail: formatOptionalStatsDuration(mostSessions.totals.minutes),
                media: mostSessions.media,
                tone: 'sessions' as const,
            } : undefined,
            biggestDay && biggestDay[1].minutes > 0 ? {
                key: 'biggest-day',
                title: 'Biggest Day',
                label: this.formatFullDate(biggestDay[0]),
                value: formatStatsDuration(biggestDay[1].minutes),
                detail: formatOptionalCount(biggestDay[1].characters, 'char'),
                tone: 'day' as const,
            } : undefined,
            biggestStreak && biggestStreak.streak > 0 ? {
                key: 'biggest-streak',
                title: 'Biggest Streak',
                label: biggestStreak.media.title,
                value: formatCount(biggestStreak.streak, 'day'),
                detail: formatOptionalCount(biggestStreak.totals.sessions, 'session'),
                media: biggestStreak.media,
                tone: 'streak' as const,
            } : undefined,
        ];

        return highlights.filter((highlight): highlight is HighlightCard => Boolean(highlight));
    }

    private toHighlightCard(
        highlight: DashboardRangeResponse['highlights'][number],
    ): HighlightCard | null {
        const media = highlight.media ?? undefined;
        switch (highlight.kind) {
            case 'most_time':
                return this.toMostTimeHighlight(highlight, media);
            case 'most_characters':
                return this.toMostCharactersHighlight(highlight, media);
            case 'most_sessions':
                return this.toMostSessionsHighlight(highlight, media);
            case 'biggest_day':
                return this.toBiggestDayHighlight(highlight);
            case 'biggest_streak':
                return this.toBiggestStreakHighlight(highlight, media);
        }
    }

    private toMostTimeHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
        media: DashboardMedia | undefined,
    ): HighlightCard | null {
        if (!media || highlight.total_minutes <= 0) return null;
        return {
            key: 'most-time', title: 'Most Time Spent', label: media.title,
            value: formatStatsDuration(highlight.total_minutes),
            detail: formatOptionalCount(highlight.total_characters, 'char'),
            media, tone: 'time',
        };
    }

    private toMostCharactersHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
        media: DashboardMedia | undefined,
    ): HighlightCard | null {
        if (!media || highlight.total_characters <= 0) return null;
        return {
            key: 'most-chars', title: 'Most Characters Read', label: media.title,
            value: formatCount(highlight.total_characters, 'char'),
            detail: formatOptionalStatsDuration(highlight.total_minutes),
            media, tone: 'chars',
        };
    }

    private toMostSessionsHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
        media: DashboardMedia | undefined,
    ): HighlightCard | null {
        if (!media || highlight.sessions <= 0) return null;
        return {
            key: 'most-sessions', title: 'Most Sessions', label: media.title,
            value: formatCount(highlight.sessions, 'session'),
            detail: formatOptionalStatsDuration(highlight.total_minutes),
            media, tone: 'sessions',
        };
    }

    private toBiggestDayHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
    ): HighlightCard | null {
        if (!highlight.date || highlight.total_minutes <= 0) return null;
        return {
            key: 'biggest-day', title: 'Biggest Day', label: this.formatFullDate(highlight.date),
            value: formatStatsDuration(highlight.total_minutes),
            detail: formatOptionalCount(highlight.total_characters, 'char'),
            tone: 'day',
        };
    }

    private toBiggestStreakHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
        media: DashboardMedia | undefined,
    ): HighlightCard | null {
        if (!media || highlight.streak_days <= 0) return null;
        return {
            key: 'biggest-streak', title: 'Biggest Streak', label: media.title,
            value: formatCount(highlight.streak_days, 'day'),
            detail: formatOptionalCount(highlight.sessions, 'session'),
            media, tone: 'streak',
        };
    }

    private getTopMediaEntry(entries: MediaTotalsEntry[], compare: (a: MediaTotalsEntry, b: MediaTotalsEntry) => number): MediaTotalsEntry | undefined {
        return [...entries].sort(compare)[0];
    }

    private getCurrentBucketIndex(getBucketIndex: (dateStr: string) => number, length: number): number {
        const todayIndex = getBucketIndex(getLocalISODate(new Date()));
        if (todayIndex !== -1) return todayIndex;
        return Math.max(0, length - 1);
    }

    private renderSelectedSummary(
        range: ActivityRange,
        totals: Totals[],
        selectedIndex: number,
        unit: string,
        isCurrentSelection: boolean,
        selectedSubject: string,
        columns: TotalsColumns,
    ): string {
        const selected = totals[selectedIndex] || { minutes: 0, characters: 0 };
        const previous = selectedIndex === 0
            ? this.getPrecedingPeriodTotals(range)
            : totals[selectedIndex - 1] || { minutes: 0, characters: 0 };
        const subject = isCurrentSelection ? this.getCurrentSubjectLabel(unit) : selectedSubject;
        const comparisonLabel = isCurrentSelection ? this.getCurrentComparisonLabel(unit) : `previous ${this.getComparisonUnitLabel(unit)}`;
        const metrics = [
            columns.showHours ? this.renderSelectedMetric('Time', formatStatsDuration(selected.minutes), this.renderDiff(selected.minutes - previous.minutes, comparisonLabel, 'minutes')) : '',
            columns.showCharacters ? this.renderSelectedMetric('Chars', selected.characters.toLocaleString(), this.renderDiff(selected.characters - previous.characters, comparisonLabel, 'characters')) : '',
        ].filter(Boolean);

        return `
            <div class="dashboard-selected-summary">
                <div class="dashboard-selected-context">Data for ${escapeHTML(subject)}</div>
                <div class="dashboard-selected-metrics" style="grid-template-columns: repeat(${metrics.length}, minmax(0, 1fr));">
                    ${metrics.join('')}
                </div>
            </div>
        `;
    }

    private getPrecedingPeriodTotals(range: ActivityRange): Totals {
        const previousBucketTotals = this.state.rangeData?.previous_bucket_totals;
        if (previousBucketTotals?.bucket === getPreviousBucketKey(range)) {
            return { minutes: previousBucketTotals.total_minutes, characters: previousBucketTotals.total_characters };
        }

        return { minutes: 0, characters: 0 };
    }

    private renderSelectedMetric(label: string, value: string, diff: string): string {
        return `
            <div class="dashboard-selected-metric">
                <div class="dashboard-selected-pill">
                    <span>${escapeHTML(label)}:</span>
                    <strong>${escapeHTML(value)}</strong>
                </div>
                ${diff}
            </div>
        `;
    }

    private renderDiff(diff: number, comparisonLabel: string, metric: 'minutes' | 'characters'): string {
        const abs = Math.abs(diff);
        const value = metric === 'minutes' ? formatStatsDuration(abs) : abs.toLocaleString();
        const direction = diff >= 0 ? 'more' : 'less';
        const tone = diff >= 0 ? 'positive' : 'negative';

        return `<div class="dashboard-selected-diff dashboard-selected-diff-${tone}">${escapeHTML(value)} ${direction} than ${escapeHTML(comparisonLabel)}</div>`;
    }

    private renderTotalsTable(
        headerLabel: string,
        rows: BucketRow[],
        columns: TotalsColumns,
        splitDayLabel = false,
    ): string {
        if (rows.length === 0 || !this.hasVisibleTotals(columns)) return '';

        const gridTemplateColumns = this.getTotalsGridTemplate(columns, splitDayLabel);
        const tableClasses = [
            'dashboard-stats-table',
            splitDayLabel ? 'dashboard-stats-table-days' : '',
        ].filter(Boolean).join(' ');

        return `
            <div class="${tableClasses}">
                <div class="dashboard-stats-row dashboard-stats-row-header" style="grid-template-columns: ${gridTemplateColumns};">
                    ${splitDayLabel
                ? '<span>Day</span><span>Weekday</span>'
                : `<span>${escapeHTML(headerLabel)}</span>`}
                    ${columns.showCharacters ? '<span class="dashboard-stats-row-value">Chars</span>' : ''}
                    ${columns.showHours ? '<span class="dashboard-stats-row-value">Hours</span>' : ''}
                </div>
                <div class="dashboard-stats-rows">
                    ${rows.map((row, index) => this.renderTotalsRow(row, row.selectable ? index : null, columns, gridTemplateColumns, splitDayLabel)).join('')}
                </div>
                <div class="dashboard-stats-row dashboard-stats-row-total" style="grid-template-columns: ${gridTemplateColumns};">
                    <span class="${splitDayLabel ? 'dashboard-stats-row-total-label' : ''}">Total</span>
                    ${columns.showCharacters ? `<span class="dashboard-stats-row-value">${escapeHTML(this.getRowsTotal(rows, 'characters'))}</span>` : ''}
                    ${columns.showHours ? `<span class="dashboard-stats-row-value">${escapeHTML(this.getRowsTotal(rows, 'hours'))}</span>` : ''}
                </div>
            </div>
        `;
    }

    private renderTotalsRow(
        row: BucketRow,
        index: number | null,
        columns: TotalsColumns,
        gridTemplateColumns: string,
        splitDayLabel: boolean,
    ): string {
        const classes = [
            'dashboard-stats-row',
            row.isCurrent ? 'is-current' : '',
            row.isSelected ? 'is-selected' : '',
            index === null ? '' : 'is-selectable',
            row.startsWeek ? 'is-week-start' : '',
        ].filter(Boolean).join(' ');
        const useSplitLabel = splitDayLabel && !row.spansLabel;
        const spanningLabelClass = splitDayLabel ? ' dashboard-stats-row-total-label' : '';
        const rowContent = `
            ${useSplitLabel
                ? `<span class="dashboard-stats-row-label dashboard-stats-row-day">${escapeHTML(row.dayOfMonth ?? '')}</span>
                   <span class="dashboard-stats-row-label dashboard-stats-row-weekday">${escapeHTML(row.weekday ?? '')}</span>`
                : `<span class="dashboard-stats-row-label${spanningLabelClass}">${escapeHTML(row.label)}</span>`}
            ${columns.showCharacters ? `<span class="dashboard-stats-row-value">${escapeHTML(row.totals.characters.toLocaleString())}</span>` : ''}
            ${columns.showHours ? `<span class="dashboard-stats-row-value">${escapeHTML(formatStatsDuration(row.totals.minutes))}</span>` : ''}
        `;

        if (index === null) {
            const unbucketedAttribute = row.spansLabel ? ' data-dashboard-unbucketed-row' : '';
            return `<div class="${classes}"${unbucketedAttribute} style="grid-template-columns: ${gridTemplateColumns};">${rowContent}</div>`;
        }

        return `<button type="button" class="${classes}" style="grid-template-columns: ${gridTemplateColumns};" data-dashboard-total-index="${index}">${rowContent}</button>`;
    }

    private getTotalsGridTemplate(columns: TotalsColumns, splitDayLabel: boolean): string {
        const characterColumn = splitDayLabel ? 'minmax(3.75rem, max-content)' : 'minmax(5rem, max-content)';
        const hourColumn = splitDayLabel ? 'minmax(3.75rem, max-content)' : 'minmax(4.25rem, max-content)';
        const metricColumns = [
            columns.showCharacters ? characterColumn : '',
            columns.showHours ? hourColumn : '',
        ].filter(Boolean);
        const labelColumns = splitDayLabel
            ? ['1.75rem', 'minmax(0, 1fr)']
            : ['minmax(0, 1fr)'];

        return [...labelColumns, ...metricColumns].join(' ');
    }

    private getRowsTotal(rows: Array<{ totals: Totals }>, metric: 'characters' | 'hours'): string {
        const totals = rows.reduce<Totals>((acc, row) => ({
            minutes: acc.minutes + row.totals.minutes,
            characters: acc.characters + row.totals.characters,
        }), { minutes: 0, characters: 0 });

        return metric === 'characters' ? totals.characters.toLocaleString() : formatStatsDuration(totals.minutes);
    }

    private getTitle(period: ActivityPeriod): string {
        switch (period) {
            case 'week': return 'Weekly';
            case 'month': return 'Monthly';
            case 'year': return 'Yearly';
            case 'all-time': return 'All Time';
            default: return 'Totals';
        }
    }

    private getUnitHeader(unit: string): string {
        switch (unit) {
            case 'day': return 'Day';
            case 'week': return 'Week';
            case 'month': return 'Month';
            case 'year': return 'Year';
            default: return 'Period';
        }
    }

    private getBucketMeta(
        label: string,
        index: number,
        unit: string,
        validStart: string,
    ): { label: string; subject: string; dayOfMonth?: string; weekday?: string } {
        if (unit === 'day') {
            const date = new Date(label + 'T00:00:00');
            const weekday = date.toLocaleDateString("en-US", { weekday: 'short' }).toUpperCase();
            return {
                label: this.formatWeekdayDate(date, false),
                subject: this.formatWeekdayDate(date, true),
                dayOfMonth: date.getDate().toString().padStart(2, '0'),
                weekday,
            };
        }

        if (unit === 'month') {
            const year = validStart.slice(0, 4);
            const monthDate = new Date(Number.parseInt(year, 10), index, 1);
            const month = monthDate.toLocaleDateString("en-US", { month: 'long' });
            return {
                label: month,
                subject: `${month} ${year}`,
            };
        }

        return { label, subject: label };
    }

    private getComparisonUnitLabel(unit: string): string {
        switch (unit) {
            case 'day': return 'day';
            case 'week': return 'week';
            case 'month': return 'month';
            case 'year': return 'year';
            default: return 'period';
        }
    }

    private getCurrentSubjectLabel(unit: string): string {
        switch (unit) {
            case 'day': return 'today';
            case 'week': return 'this week';
            case 'month': return 'this month';
            case 'year': return 'this year';
            default: return 'current period';
        }
    }

    private getCurrentComparisonLabel(unit: string): string {
        switch (unit) {
            case 'day': return 'yesterday';
            case 'week': return 'last week';
            case 'month': return 'last month';
            case 'year': return 'last year';
            default: return 'previous period';
        }
    }

    private formatWeekdayDate(date: Date, includeYear: boolean): string {
        const weekday = date.toLocaleDateString("en-US", { weekday: 'long' });
        const fullYear = date.getFullYear();
        const yearSuffix = includeYear ? `/${fullYear}` : '';
        return `${weekday} ${this.formatShortDate(date)}${yearSuffix}`;
    }

    private formatShortDate(date: Date): string {
        return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }

    private getLongestStreak(dates: string[]): number {
        const uniqueDates = Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
        if (uniqueDates.length === 0) return 0;

        let best = 1;
        let current = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
            const previousDate = new Date(uniqueDates[i - 1] + 'T00:00:00');
            const currentDate = new Date(uniqueDates[i] + 'T00:00:00');
            const diffDays = Math.round((currentDate.getTime() - previousDate.getTime()) / (24 * 60 * 60 * 1000));
            if (diffDays === 1) {
                current += 1;
                best = Math.max(best, current);
            }
        }
        return best;
    }

    private isMobileHighlightLayout(): boolean {
        return globalThis.window !== undefined && globalThis.matchMedia?.(MOBILE_HIGHLIGHT_LAYOUT_QUERY).matches;
    }

    private renderHighlightCard(highlight: HighlightCard): string {
        const mediaId = highlight.media?.id;
        const coverUrl = mediaId ? this.coverUrls[mediaId] : '';
        const coverStyle = coverUrl ? ` style="--highlight-cover: url('${escapeHTML(coverUrl)}');"` : '';
        const detail = highlight.detail ? `<span class="dashboard-highlight-detail">${escapeHTML(highlight.detail)}</span>` : '';

        return `
            <article class="dashboard-highlight-card dashboard-highlight-card-${highlight.tone}"${coverStyle}>
                <div class="dashboard-highlight-icon">${this.getHighlightIcon(highlight.tone)}</div>
                <div class="dashboard-highlight-copy">
                    <span class="dashboard-highlight-title">${escapeHTML(highlight.title)}</span>
                    <strong>${escapeHTML(highlight.label)}</strong>
                    <span class="dashboard-highlight-value">${escapeHTML(highlight.value)}</span>
                    ${detail}
                </div>
            </article>
        `;
    }

    private getHighlightMaxPage(length: number): number {
        return Math.max(0, Math.ceil(length / this.highlightsPerPage) - 1);
    }

    private async ensureHighlightCovers(highlights: HighlightCard[]): Promise<void> {
        let loadedAny = false;
        await Promise.all(highlights.map(async highlight => {
            const media = highlight.media;
            if (!media?.id || !media.cover_image || this.coverUrls[media.id] || this.attemptedCoverIds.has(media.id)) return;

            this.attemptedCoverIds.add(media.id);
            const src = await MediaCoverLoader.load(media.cover_image);
            if (!src) return;
            this.coverUrls[media.id] = src;
            loadedAny = true;
        }));

        if (loadedAny) {
            this.render();
        }
    }

    private getHighlightIcon(tone: HighlightCard['tone']): string {
        switch (tone) {
            case 'time': return 'T';
            case 'chars': return 'C';
            case 'sessions': return 'S';
            case 'day': return 'D';
            case 'streak': return 'St';
            case 'category': return 'Ca';
        }
    }

    private getTopCategoryHighlight(categoryTotals: ReadonlyArray<[string, Totals]>): HighlightCard | null {
        const top = categoryTotals.reduce<[string, Totals] | null>(
            (best, entry) => (best === null || entry[1].minutes > best[1].minutes ? entry : best),
            null,
        );
        if (top === null) return null;

        const [label, totals] = top;
        if (totals.minutes <= 0) return null;

        return {
            key: 'top-category',
            title: 'Top Category',
            label,
            value: formatStatsDuration(totals.minutes),
            detail: formatOptionalCount(totals.characters, 'char'),
            tone: 'category',
        };
    }

    private formatFullDate(dateStr: string): string {
        const date = new Date(dateStr + 'T00:00:00');
        return this.formatWeekdayDate(date, true);
    }
}

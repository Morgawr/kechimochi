import { Component } from '../../component';
import { ActivitySummary, DashboardRangeResponse } from '../../api';
import { escapeHTML } from '../../html';
import { formatStatsDuration, formatWeekdayDate } from '../../time';
import { getLocalISODate, getPreviousBucketKey, normalizeWeekStartDay, type ActivityPeriod, type ActivityRange } from '../activity_ranges';
import type { Totals } from '../range_context';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataEmptyState } from '../card_shell';
import { getTotalsColumns, hasVisibleTotals, renderTotalsTable, type BucketRow, type TotalsColumns } from '../totals_table';

export const PERIOD_STATS_CARD = {
    id: 'period_stats',
    label: 'Period Stats',
    spans: { wide: 4, medium: 6 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

interface PeriodStatsState {
    range: ActivityRange;
    isTodayInRange: boolean;
    rangeData?: DashboardRangeResponse;
    logs?: ActivitySummary[];
    timeRangeDays: number;
    timeRangeOffset: number;
    weekStartDay: number;
    selectedBucketIndex?: number;
}

export class PeriodStats extends Component<PeriodStatsState> {
    public setState(newState: Partial<PeriodStatsState>): void {
        const periodChanged = newState.timeRangeDays !== undefined && newState.timeRangeDays !== this.state.timeRangeDays;
        const timeframeChanged = periodChanged
            || newState.timeRangeOffset !== undefined && newState.timeRangeOffset !== this.state.timeRangeOffset
            || newState.weekStartDay !== undefined && newState.weekStartDay !== this.state.weekStartDay;
        if (periodChanged) {
            const scroller = this.getRowsScroller();
            if (scroller) scroller.scrollTop = 0;
        }
        this.state = {
            ...this.state,
            ...newState,
            selectedBucketIndex: timeframeChanged ? undefined : newState.selectedBucketIndex ?? this.state.selectedBucketIndex,
        };
        this.render();
    }

    render(): void {
        const scrollTop = this.getRowsScroller()?.scrollTop ?? 0;
        this.clear();
        const { range } = this.state;
        const unbucketedRowLabel = this.getUnbucketedRowLabel(range.period);
        const { totals: bucketTotals, unbucketedTotals } = this.getBucketTotals(
            range.labels.length,
            range.getBucketIndex,
            unbucketedRowLabel !== null,
        );
        const currentIndex = this.getCurrentBucketIndex(range.getBucketIndex, bucketTotals.length);
        const selectedIndex = this.state.selectedBucketIndex ?? currentIndex;
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
        const selectedSubject = bucketRows[selectedIndex]?.subject || this.getCurrentSubjectLabel(range.unit);

        this.container.insertAdjacentHTML('beforeend', this.renderStatsPanel(
            range,
            bucketTotals,
            statsTableRows,
            selectedIndex,
            currentIndex,
            selectedSubject,
            this.state.isTodayInRange,
        ));
        this.setupListeners();
        const scroller = this.getRowsScroller();
        if (scroller) scroller.scrollTop = scrollTop;
    }

    private getRowsScroller(): HTMLElement | null {
        return this.container.querySelector<HTMLElement>('.dashboard-stats-rows');
    }

    private setupListeners(): void {
        this.container.querySelectorAll<HTMLButtonElement>('[data-dashboard-total-index]').forEach(button => {
            button.addEventListener('click', () => {
                const selectedBucketIndex = Number.parseInt(button.dataset.dashboardTotalIndex || '', 10);
                if (Number.isFinite(selectedBucketIndex)) {
                    this.setState({ selectedBucketIndex });
                }
            });
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
        const columns = getTotalsColumns(rows);
        const body = hasVisibleTotals(columns) ? `
            ${renderTotalsTable(this.getUnitHeader(range.unit), rows, columns, range.unit === 'day')}
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
                label: formatWeekdayDate(date, false),
                subject: formatWeekdayDate(date, true),
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

}

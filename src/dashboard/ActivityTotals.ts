import { Component } from '../component';
import { ActivitySummary, DashboardMedia, DashboardRangeResponse, Media } from '../api';
import { escapeHTML, html, rawHtml } from '../html';
import { formatStatsDuration } from '../time';
import { getActivityRange, getLocalISODate, type ActivityPeriod, type ActivityRange } from './activity_ranges';
import { MediaCoverLoader } from '../media/cover_loader';
import { Logger } from '../logger';

interface ActivityTotalsState {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    timeRangeDays: number;
    timeRangeOffset: number;
    weekStartDay: number;
    selectedBucketIndex?: number;
}

interface Totals {
    minutes: number;
    characters: number;
}

interface BucketRow {
    key: string;
    label: string;
    subject: string;
    totals: Totals;
    isCurrent: boolean;
    isSelected: boolean;
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
    tone: 'time' | 'chars' | 'sessions' | 'day' | 'streak';
}

export class ActivityTotals extends Component<ActivityTotalsState> {
    private readonly attemptedCoverIds = new Set<number>();
    private readonly coverUrls: Record<number, string> = {};
    private highlightPage = 0;
    private highlightsPerPage = 2;
    private resizeObserver: ResizeObserver | null = null;
    private lastIsMobile: boolean = false;

    constructor(container: HTMLElement, initialState: ActivityTotalsState) {
        super(container, initialState);
    }

    protected override onMount() {
        this.lastIsMobile = this.isMobileHighlightLayout();
        this.resizeObserver = new ResizeObserver(() => {
            const isMobile = this.isMobileHighlightLayout();
            if (isMobile !== this.lastIsMobile) {
                this.lastIsMobile = isMobile;
                // Reset pagination when layout mode changes
                this.highlightPage = 0;
                this.render();
            }
        });
        this.resizeObserver.observe(this.container);
    }

    public override destroy(): void {
        this.resizeObserver?.disconnect();
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

        const rangeLogs = this.state.logs ?? this.state.rangeData?.bucket_totals.map((bucket, index) => ({
            id: index,
            media_id: 0,
            title: '',
            activity_type: '',
            duration_minutes: bucket.total_minutes,
            characters: bucket.total_characters,
            date: bucket.bucket,
            language: '',
            notes: '',
        })) ?? [];
        const range = getActivityRange(this.state.timeRangeDays, this.state.timeRangeOffset, rangeLogs, this.state.weekStartDay);
        const bucketTotals = this.getBucketTotals(range.labels.length, range.getBucketIndex);
        const currentIndex = this.getCurrentBucketIndex(range.getBucketIndex, bucketTotals.length);
        const selectedIndex = this.state.selectedBucketIndex ?? currentIndex;
        const categoryTotals = this.getCategoryTotals(range.validStart, range.validEnd);
        const bucketRows = bucketTotals.map((totals, index) => {
            const meta = this.getBucketMeta(range.labels[index], index, range.unit, range.validStart);
            return {
                key: String(index),
                label: meta.label,
                subject: meta.subject,
                totals,
                isCurrent: index === currentIndex,
                isSelected: index === selectedIndex,
            };
        });
        const categoryRows = categoryTotals.map(([category, totals]) => ({
            key: category,
            label: category,
            subject: category,
            totals,
            isCurrent: false,
            isSelected: false,
        }));
        const selectedSubject = bucketRows[selectedIndex]?.subject || this.getCurrentSubjectLabel(range.unit);
        const highlights = this.getHighlights(range.validStart, range.validEnd);
        const sections = [
            this.renderStatsPanel(range, bucketTotals, bucketRows, selectedIndex, currentIndex, selectedSubject),
            this.renderCategoriesPanel(range, categoryRows),
            this.renderHighlightsPanel(highlights),
        ].filter(Boolean).join('');

        const content = html`
            <div class="dashboard-totals-grid">
                ${rawHtml(sections)}
            </div>
        `;

        this.container.appendChild(content);
        this.setupListeners(content);
        this.setupHighlights(content, highlights);
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
        bucketRows: BucketRow[],
        selectedIndex: number,
        currentIndex: number,
        selectedSubject: string,
    ): string {
        const columns = this.getTotalsColumns(bucketRows);
        if (!this.hasVisibleTotals(columns)) return '';

        return `
            <section class="card dashboard-totals-card">
                <div class="dashboard-stats-header">
                    <h3 class="dashboard-module-title dashboard-totals-title">${this.getTitle(range.period)} Stats</h3>
                    <span class="dashboard-stats-range-label">${this.getRangeLabel(range.validStart, range.validEnd, range.period)}</span>
                </div>
                ${this.renderTotalsTable(this.getUnitHeader(range.unit), bucketRows, true, columns)}
                ${this.renderSelectedSummary(
            bucketTotals,
            selectedIndex,
            range.unit,
            this.state.timeRangeOffset === 0 && selectedIndex === currentIndex,
            selectedSubject,
            columns,
        )}
            </section>
        `;
    }

    private renderCategoriesPanel(range: ActivityRange, categoryRows: BucketRow[]): string {
        const columns = this.getTotalsColumns(categoryRows);
        if (!this.hasVisibleTotals(columns)) return '';

        return `
            <section class="card dashboard-totals-card">
                <div class="dashboard-stats-header">
                    <h3 class="dashboard-module-title dashboard-totals-title">Categories</h3>
                    <span class="dashboard-stats-range-label">${this.getRangeLabel(range.validStart, range.validEnd, range.period)}</span>
                </div>
                ${this.renderTotalsTable('Title', categoryRows, false, columns)}
            </section>
        `;
    }

    private renderHighlightsPanel(highlights: HighlightCard[]): string {
        if (highlights.length === 0) return '';

        return `
            <section class="card dashboard-totals-card dashboard-highlights-card">
                ${this.renderHighlights(highlights)}
            </section>
        `;
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

    private getBucketTotals(length: number, getBucketIndex: (dateStr: string) => number): Totals[] {
        const totals = Array.from({ length }, () => ({ minutes: 0, characters: 0 }));

        if (this.state.rangeData) {
            for (const bucket of this.state.rangeData.bucket_totals) {
                const index = getBucketIndex(bucket.bucket);
                if (index !== -1) {
                    totals[index].minutes += bucket.total_minutes;
                    totals[index].characters += bucket.total_characters;
                }
            }
            return totals;
        }

        for (const log of this.state.logs ?? []) {
            const index = getBucketIndex(log.date);
            if (index !== -1) {
                totals[index].minutes += log.duration_minutes;
                totals[index].characters += log.characters || 0;
            }
        }

        return totals;
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

    private getHighlights(validStart: string, validEnd: string): HighlightCard[] {
        if (this.state.rangeData) {
            return this.state.rangeData.highlights
                .map(highlight => this.toHighlightCard(highlight))
                .filter((highlight): highlight is HighlightCard => highlight !== null);
        }

        return this.getLegacyHighlights(validStart, validEnd);
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
                value: formatStatsDuration(mostTime.totals.minutes, true),
                detail: this.formatOptionalCount(mostTime.totals.characters, 'char'),
                media: mostTime.media,
                tone: 'time' as const,
            } : undefined,
            mostChars && mostChars.totals.characters > 0 ? {
                key: 'most-chars',
                title: 'Most Characters Read',
                label: mostChars.media.title,
                value: this.formatCount(mostChars.totals.characters, 'char'),
                detail: this.formatOptionalDuration(mostChars.totals.minutes),
                media: mostChars.media,
                tone: 'chars' as const,
            } : undefined,
            mostSessions && mostSessions.totals.sessions > 0 ? {
                key: 'most-sessions',
                title: 'Most Sessions',
                label: mostSessions.media.title,
                value: this.formatCount(mostSessions.totals.sessions, 'session'),
                detail: this.formatOptionalDuration(mostSessions.totals.minutes),
                media: mostSessions.media,
                tone: 'sessions' as const,
            } : undefined,
            biggestDay && biggestDay[1].minutes > 0 ? {
                key: 'biggest-day',
                title: 'Biggest Day',
                label: this.formatFullDate(biggestDay[0]),
                value: formatStatsDuration(biggestDay[1].minutes, true),
                detail: this.formatOptionalCount(biggestDay[1].characters, 'char'),
                tone: 'day' as const,
            } : undefined,
            biggestStreak && biggestStreak.streak > 0 ? {
                key: 'biggest-streak',
                title: 'Biggest Streak',
                label: biggestStreak.media.title,
                value: this.formatCount(biggestStreak.streak, 'day'),
                detail: this.formatOptionalCount(biggestStreak.totals.sessions, 'session'),
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
            value: formatStatsDuration(highlight.total_minutes, true),
            detail: this.formatOptionalCount(highlight.total_characters, 'char'),
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
            value: this.formatCount(highlight.total_characters, 'char'),
            detail: this.formatOptionalDuration(highlight.total_minutes),
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
            value: this.formatCount(highlight.sessions, 'session'),
            detail: this.formatOptionalDuration(highlight.total_minutes),
            media, tone: 'sessions',
        };
    }

    private toBiggestDayHighlight(
        highlight: DashboardRangeResponse['highlights'][number],
    ): HighlightCard | null {
        if (!highlight.date || highlight.total_minutes <= 0) return null;
        return {
            key: 'biggest-day', title: 'Biggest Day', label: this.formatFullDate(highlight.date),
            value: formatStatsDuration(highlight.total_minutes, true),
            detail: this.formatOptionalCount(highlight.total_characters, 'char'),
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
            value: this.formatCount(highlight.streak_days, 'day'),
            detail: this.formatOptionalCount(highlight.sessions, 'session'),
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
        totals: Totals[],
        selectedIndex: number,
        unit: string,
        isCurrentSelection: boolean,
        selectedSubject: string,
        columns: TotalsColumns,
    ): string {
        const selected = totals[selectedIndex] || { minutes: 0, characters: 0 };
        const previous = totals[selectedIndex - 1] || { minutes: 0, characters: 0 };
        const subject = isCurrentSelection ? this.getCurrentSubjectLabel(unit) : selectedSubject;
        const comparisonLabel = isCurrentSelection ? this.getCurrentComparisonLabel(unit) : `previous ${this.getComparisonUnitLabel(unit)}`;
        const metrics = [
            columns.showHours ? this.renderSelectedMetric('Time', formatStatsDuration(selected.minutes, true), this.renderDiff(selected.minutes - previous.minutes, comparisonLabel, 'minutes')) : '',
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
        const value = metric === 'minutes' ? formatStatsDuration(abs, true) : abs.toLocaleString();
        const direction = diff >= 0 ? 'more' : 'less';
        const tone = diff >= 0 ? 'positive' : 'negative';

        return `<div class="dashboard-selected-diff dashboard-selected-diff-${tone}">${escapeHTML(value)} ${direction} than ${escapeHTML(comparisonLabel)}</div>`;
    }

    private renderTotalsTable(headerLabel: string, rows: BucketRow[], selectable: boolean, columns: TotalsColumns): string {
        if (rows.length === 0 || !this.hasVisibleTotals(columns)) return '';

        const gridTemplateColumns = this.getTotalsGridTemplate(columns);

        return `
            <div class="dashboard-stats-table">
                <div class="dashboard-stats-row dashboard-stats-row-header" style="grid-template-columns: ${gridTemplateColumns};">
                    <span>${escapeHTML(headerLabel)}</span>
                    ${columns.showCharacters ? '<span>Chars</span>' : ''}
                    ${columns.showHours ? '<span>Hours</span>' : ''}
                </div>
                ${rows.map((row, index) => this.renderTotalsRow(row, selectable ? index : null, columns, gridTemplateColumns)).join('')}
                <div class="dashboard-stats-row dashboard-stats-row-total" style="grid-template-columns: ${gridTemplateColumns};">
                    <span>Total</span>
                    ${columns.showCharacters ? `<span>${escapeHTML(this.getRowsTotal(rows, 'characters'))}</span>` : ''}
                    ${columns.showHours ? `<span>${escapeHTML(this.getRowsTotal(rows, 'hours'))}</span>` : ''}
                </div>
            </div>
        `;
    }

    private renderTotalsRow(row: BucketRow, index: number | null, columns: TotalsColumns, gridTemplateColumns: string): string {
        const classes = [
            'dashboard-stats-row',
            row.isCurrent ? 'is-current' : '',
            row.isSelected ? 'is-selected' : '',
            index === null ? '' : 'is-selectable',
        ].filter(Boolean).join(' ');
        const rowContent = `
            <span class="dashboard-stats-row-label">${escapeHTML(row.label)}</span>
            ${columns.showCharacters ? `<span>${escapeHTML(row.totals.characters.toLocaleString())}</span>` : ''}
            ${columns.showHours ? `<span>${escapeHTML(this.formatHours(row.totals.minutes))}</span>` : ''}
        `;

        if (index === null) {
            return `<div class="${classes}" style="grid-template-columns: ${gridTemplateColumns};">${rowContent}</div>`;
        }

        return `<button type="button" class="${classes}" style="grid-template-columns: ${gridTemplateColumns};" data-dashboard-total-index="${index}">${rowContent}</button>`;
    }

    private getTotalsGridTemplate(columns: TotalsColumns): string {
        const metricColumns = [
            columns.showCharacters ? 'minmax(5rem, max-content)' : '',
            columns.showHours ? 'minmax(4.25rem, max-content)' : '',
        ].filter(Boolean);

        return ['minmax(0, 1fr)', ...metricColumns].join(' ');
    }

    private getRowsTotal(rows: Array<{ totals: Totals }>, metric: 'characters' | 'hours'): string {
        const totals = rows.reduce<Totals>((acc, row) => ({
            minutes: acc.minutes + row.totals.minutes,
            characters: acc.characters + row.totals.characters,
        }), { minutes: 0, characters: 0 });

        return metric === 'characters' ? totals.characters.toLocaleString() : this.formatHours(totals.minutes);
    }

    private formatHours(minutes: number): string {
        return formatStatsDuration(minutes, true);
    }

    private formatCount(value: number, singular: string): string {
        const label = value === 1 ? singular : `${singular}s`;
        return `${value.toLocaleString()} ${label}`;
    }

    private formatOptionalCount(value: number, singular: string): string {
        return value > 0 ? this.formatCount(value, singular) : '';
    }

    private formatOptionalDuration(minutes: number): string {
        return minutes > 0 ? formatStatsDuration(minutes, true) : '';
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

    private getBucketMeta(label: string, index: number, unit: string, validStart: string): { label: string; subject: string } {
        if (unit === 'day') {
            const date = new Date(label + 'T00:00:00');
            return {
                label: this.formatWeekdayDate(date, false),
                subject: this.formatWeekdayDate(date, true),
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

    private getRangeLabel(validStart: string, validEnd: string, period: ActivityPeriod): string {
        if (period === 'year') return validStart.slice(0, 4);
        if (period === 'month') return validStart.slice(0, 7);
        if (period === 'all-time') return 'All Time';
        return `${validStart.slice(5)} to ${validEnd.slice(5)}`;
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
        return globalThis.window !== undefined && globalThis.matchMedia?.('(max-width: 1024px)').matches;
    }

    private renderHighlights(highlights: HighlightCard[]): string {
        const isMobile = this.isMobileHighlightLayout();
        const pageSize = isMobile ? highlights.length : 3;
        this.highlightsPerPage = pageSize;
        const maxPage = this.getHighlightMaxPage(highlights.length);
        this.highlightPage = Math.min(this.highlightPage, maxPage);
        const start = this.highlightPage * pageSize;
        const visibleHighlights = highlights.slice(start, start + pageSize);
        const needsPagination = !isMobile && highlights.length > pageSize;
        const disableLeftPageArrow = this.highlightPage === 0 ? 'disabled' : '';
        const disableRightPageArrow = this.highlightPage >= maxPage ? 'disabled' : '';

        if (highlights.length === 0) {
            return `
                <div class="dashboard-highlights-section">
                    <div class="dashboard-stats-header">
                        <h3 class="dashboard-module-title dashboard-totals-title">Highlights</h3>
                        <span class="dashboard-stats-range-label"></span>
                    </div>
                    <p class="dashboard-totals-empty">No activity for this timeframe.</p>
                </div>
            `;
        }

        return `
            <div class="dashboard-highlights-section">
                <div class="dashboard-stats-header">
                    <h3 class="dashboard-module-title dashboard-totals-title">Highlights</h3>
                    <span class="dashboard-stats-range-label">${needsPagination ? `${this.highlightPage + 1}/${maxPage + 1}` : ''}</span>
                </div>
                ${needsPagination ? `
                    <div class="dashboard-highlights-shell">
                        <button type="button" class="dashboard-highlights-nav" data-highlights-dir="prev" ${disableLeftPageArrow} aria-label="Previous highlights">
                            <svg width="12" height="28" viewBox="0 0 12 28" fill="none">
                                <path d="M8 4L3 14L8 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <div class="dashboard-highlights-viewport">
                            <div class="dashboard-highlights-grid">
                                ${visibleHighlights.map(highlight => this.renderHighlightCard(highlight)).join('')}
                            </div>
                        </div>
                        <button type="button" class="dashboard-highlights-nav" data-highlights-dir="next" ${disableRightPageArrow} aria-label="Next highlights">
                            <svg width="12" height="28" viewBox="0 0 12 28" fill="none">
                                <path d="M4 4L9 14L4 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                ` : `
                    <div class="dashboard-highlights-viewport">
                        <div class="dashboard-highlights-grid">
                            ${highlights.map(highlight => this.renderHighlightCard(highlight)).join('')}
                        </div>
                    </div>
                `}
            </div>
        `;
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
        }
    }

    private formatFullDate(dateStr: string): string {
        const date = new Date(dateStr + 'T00:00:00');
        return this.formatWeekdayDate(date, true);
    }
}

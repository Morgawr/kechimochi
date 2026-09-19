import { Component } from '../../component';
import { ActivitySummary, DashboardMedia, DashboardRangeResponse, Media } from '../../api';
import { escapeHTML } from '../../html';
import { formatCount, formatOptionalCount } from '../../count_formatting';
import { formatOptionalStatsDuration, formatStatsDuration } from '../../time';
import type { Totals } from '../range_context';
import { MediaCoverLoader } from '../../media/cover_loader';
import { Logger } from '../../logger';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell, renderNoPeriodDataEmptyState } from '../card_shell';

export const HIGHLIGHTS_CARD = {
    id: 'highlights',
    label: 'Highlights',
    spans: { wide: 8, medium: 12 },
    dataSources: ['range'],
} as const satisfies DashboardCardDescriptor;

const MOBILE_HIGHLIGHT_LAYOUT_QUERY = '(max-width: 1024px)';
const DESKTOP_HIGHLIGHTS_PER_PAGE = 3;

interface HighlightsState {
    logs?: ActivitySummary[];
    mediaList?: Media[];
    rangeData?: DashboardRangeResponse;
    categoryTotals: ReadonlyArray<[string, Totals]>;
    validStart: string;
    validEnd: string;
    isTodayInRange: boolean;
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

export class Highlights extends Component<HighlightsState> {
    private readonly attemptedCoverIds = new Set<number>();
    private readonly coverUrls: Record<number, string> = {};
    private highlightPage = 0;
    private highlightsPerPage = 2;
    private mobileLayoutQuery: MediaQueryList | null = null;
    private lastIsMobile: boolean = false;
    private readonly onCardsRendered: () => void;

    constructor(
        container: HTMLElement,
        initialState: HighlightsState,
        onCardsRendered: () => void = () => {},
    ) {
        super(container, initialState);
        this.onCardsRendered = onCardsRendered;
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

    public setState(newState: Partial<HighlightsState>) {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    render() {
        this.clear();
        const highlights = this.getHighlights(this.state.validStart, this.state.validEnd, this.state.categoryTotals);
        this.container.insertAdjacentHTML('beforeend', this.renderHighlightsPanel(highlights, this.state.isTodayInRange));
        this.setupHighlights(highlights);
        this.onCardsRendered();
    }

    private setupHighlights(highlights: HighlightCard[]) {
        const card = this.container.querySelector<HTMLElement>('.dashboard-highlights-card');

        if (!card) return;

        this.container.querySelector<HTMLButtonElement>('[data-highlights-dir="prev"]')?.addEventListener('click', () => {
            this.highlightPage = Math.max(0, this.highlightPage - 1);
            this.render();
        });
        this.container.querySelector<HTMLButtonElement>('[data-highlights-dir="next"]')?.addEventListener('click', () => {
            this.highlightPage = Math.min(this.getHighlightMaxPage(highlights.length), this.highlightPage + 1);
            this.render();
        });

        this.ensureHighlightCovers(highlights).catch(error => {
            Logger.error('Failed to load dashboard highlight covers', error);
        });
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
}

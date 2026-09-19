import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Highlights } from '../../../src/dashboard/cards/Highlights';
import { computeRangeContext } from '../../../src/dashboard/range_context';
import { ActivitySummary, Media } from '../../../src/api';
import { MediaCoverLoader } from '../../../src/media/cover_loader';
import { Logger } from '../../../src/logger';

vi.mock('../../../src/media/cover_loader', () => ({
    MediaCoverLoader: {
        load: vi.fn(),
    },
}));

function makeMedia(overrides: Partial<Media> & { id: number; title: string }): Media {
    return {
        id: overrides.id,
        title: overrides.title,
        default_activity_type: overrides.default_activity_type ?? 'Reading',
        status: overrides.status ?? 'In Progress',
        language: overrides.language ?? 'Japanese',
        description: overrides.description ?? '',
        cover_image: overrides.cover_image ?? '',
        extra_data: overrides.extra_data ?? '',
        content_type: overrides.content_type ?? '',
        tracking_status: overrides.tracking_status ?? 'active',
        uid: overrides.uid,
    };
}

function makeLog(overrides: Partial<ActivitySummary> & { id: number; media_id: number; date: string }): ActivitySummary {
    return {
        id: overrides.id,
        media_id: overrides.media_id,
        title: overrides.title ?? `Media ${overrides.media_id}`,
        activity_type: overrides.activity_type ?? 'Reading',
        duration_minutes: overrides.duration_minutes ?? 0,
        characters: overrides.characters ?? 0,
        date: overrides.date,
        date_precision: overrides.date_precision ?? 'day',
        language: overrides.language ?? 'Japanese',
        notes: overrides.notes ?? '',
    };
}

function textContent(container: HTMLElement): string {
    return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function weeklyMedia(): Media[] {
    return [
        makeMedia({ id: 1, title: 'Novel A', default_activity_type: 'Reading', content_type: 'Novel', cover_image: 'novel-a.jpg' }),
        makeMedia({ id: 2, title: 'Anime B', default_activity_type: 'Watching', content_type: 'Anime' }),
        makeMedia({ id: 3, title: 'Manga C', default_activity_type: 'Reading', content_type: 'Manga' }),
        makeMedia({ id: 4, title: 'Game D', default_activity_type: 'Playing', content_type: 'Game' }),
        makeMedia({ id: 5, title: 'Audio E', default_activity_type: 'Listening', content_type: 'Audio' }),
    ];
}

function weeklyLogs(): ActivitySummary[] {
    return [
        makeLog({ id: 1, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-08', duration_minutes: 60, characters: 1000 }),
        makeLog({ id: 2, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-09', duration_minutes: 30, characters: 2000 }),
        makeLog({ id: 3, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-10', duration_minutes: 120, characters: 0 }),
        makeLog({ id: 4, media_id: 3, title: 'Manga C', activity_type: 'Reading', date: '2026-06-11', duration_minutes: 20, characters: 5000 }),
        makeLog({ id: 5, media_id: 4, title: 'Game D', activity_type: 'Playing', date: '2026-06-12', duration_minutes: 15, characters: 0 }),
        makeLog({ id: 6, media_id: 99, title: 'Mystery', activity_type: 'Mystery', date: '2026-06-12', duration_minutes: 10, characters: 0 }),
        makeLog({ id: 7, media_id: 5, title: 'Audio E', activity_type: 'Listening', date: '2026-06-13', duration_minutes: 5, characters: 0 }),
        makeLog({ id: 8, media_id: 1, title: 'Novel A', activity_type: 'Reading', date: '2026-06-01', duration_minutes: 999, characters: 9999 }),
    ];
}

function weeklyHighlightsState(logs: ActivitySummary[], mediaList: Media[]) {
    const { categoryTotals, isTodayInRange, range } = computeRangeContext({
        logs,
        mediaList,
        timeRangeDays: 7,
        timeRangeOffset: 0,
        weekStartDay: 1,
    });
    return {
        logs,
        mediaList,
        categoryTotals,
        isTodayInRange,
        validStart: range.validStart,
        validEnd: range.validEnd,
    };
}

describe('Highlights', () => {
    let container: HTMLElement;
    let isMobileLayout: boolean;
    let mobileLayoutListener: ((event: MediaQueryListEvent) => void) | undefined;
    let addQueryListenerSpy: ReturnType<typeof vi.fn>;
    let removeQueryListenerSpy: ReturnType<typeof vi.fn>;

    function setMobileLayout(matches: boolean): void {
        isMobileLayout = matches;
        mobileLayoutListener?.({ matches } as MediaQueryListEvent);
    }

    beforeEach(() => {
        container = document.createElement('div');
        isMobileLayout = false;
        mobileLayoutListener = undefined;
        addQueryListenerSpy = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
            mobileLayoutListener = listener;
        });
        removeQueryListenerSpy = vi.fn(() => { mobileLayoutListener = undefined; });
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        vi.mocked(MediaCoverLoader.load).mockResolvedValue('blob:loaded-cover');
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: isMobileLayout,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: addQueryListenerSpy,
            removeEventListener: removeQueryListenerSpy,
            dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders an empty state instead of vanishing when there are no highlights', () => {
        const component = new Highlights(container, {
            categoryTotals: [],
            isTodayInRange: true,
            validStart: '2026-06-08',
            validEnd: '2026-06-14',
        });

        component.render();

        expect(container.querySelector('.card')).not.toBeNull();
        expect(container.querySelector('.dashboard-card-empty')).not.toBeNull();
    });

    it('renders bounded backend totals and highlights without raw logs or a media library', () => {
        const component = new Highlights(container, {
            rangeData: {
                request_id: 1,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [],
                bucket_totals: [{ bucket: '2026-06-10', total_minutes: 90, total_characters: 2500 }],
                previous_bucket_totals: { bucket: null, total_minutes: 0, total_characters: 0 },
                category_totals: [{ key: 'category:Novel', label: 'Novel', total_minutes: 90, total_characters: 2500 }],
                highlights: [{
                    kind: 'most_time',
                    media: {
                        id: 1,
                        title: 'Novel A',
                        variant: '',
                        default_activity_type: 'Reading',
                        status: 'Active',
                        cover_image: '',
                        content_type: 'Novel',
                        tracking_status: 'Ongoing',
                    },
                    date: null,
                    total_minutes: 90,
                    total_characters: 2500,
                    sessions: 2,
                    streak_days: 0,
                }],
            },
            categoryTotals: [],
            isTodayInRange: true,
            validStart: '2026-06-08',
            validEnd: '2026-06-14',
        });

        component.render();
        const text = textContent(container);
        expect(text).toContain('Most Time Spent');
        expect(text).toContain('Novel A');
    });

    it('renders weekly highlights, cover images, and pages through them', async () => {
        const component = new Highlights(container, weeklyHighlightsState(weeklyLogs(), weeklyMedia()));

        component.render();
        await flushPromises();

        const text = textContent(container);
        expect(text).toContain('Most Time Spent');
        expect(text).toContain('Anime B');
        expect(text).toContain('Most Characters Read');
        expect(text).toContain('Manga C');
        expect(text).toContain('Most Sessions');
        expect(text).toContain('Novel A');
        expect(text).toContain('1/2');
        expect(MediaCoverLoader.load).toHaveBeenCalledWith('novel-a.jpg');
        expect(container.innerHTML).toContain("--highlight-cover: url('blob:loaded-cover')");

        container.querySelector<HTMLButtonElement>('[data-highlights-dir="next"]')?.click();
        const secondPageText = textContent(container);
        expect(secondPageText).toContain('2/2');
        expect(secondPageText).toContain('Biggest Day');
        expect(secondPageText).toContain('Wednesday 10/06/2026');
        expect(secondPageText).toContain('Biggest Streak');
        expect(secondPageText).toContain('2 days');

        container.querySelector<HTMLButtonElement>('[data-highlights-dir="prev"]')?.click();
        expect(textContent(container)).toContain('1/2');
    });

    it('renders mobile highlights without pagination and responds to viewport breakpoint changes', async () => {
        const component = new Highlights(container, weeklyHighlightsState(weeklyLogs(), weeklyMedia()));
        const renderSpy = vi.spyOn(component, 'render');

        component.render();
        await flushPromises();
        await flushPromises();

        expect(addQueryListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
        container.querySelector<HTMLButtonElement>('[data-highlights-dir="next"]')?.click();
        expect(textContent(container)).toContain('2/2');

        setMobileLayout(false);
        expect(textContent(container)).toContain('2/2');

        setMobileLayout(true);
        const resizedText = textContent(container);
        expect(renderSpy).toHaveBeenCalled();
        expect(container.querySelector('[data-highlights-dir="next"]')).toBeNull();
        expect(resizedText).toContain('Most Time Spent');
        expect(resizedText).toContain('Biggest Day');
        expect(resizedText).toContain('Biggest Streak');

        component.destroy();
        expect(removeQueryListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('logs cover loading failures without breaking highlight rendering', async () => {
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
        vi.mocked(MediaCoverLoader.load).mockRejectedValueOnce(new Error('cover failed'));
        const component = new Highlights(container, weeklyHighlightsState(weeklyLogs(), weeklyMedia()));

        component.render();
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith('Failed to load dashboard highlight covers', expect.any(Error));
        expect(textContent(container)).toContain('Most Time Spent');
    });
});

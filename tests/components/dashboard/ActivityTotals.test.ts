import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTotals } from '../../../src/dashboard/ActivityTotals';
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
        language: overrides.language ?? 'Japanese',
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

describe('ActivityTotals', () => {
    let container: HTMLElement;
    let isMobileLayout: boolean;
    let resizeCallback: (() => void) | undefined;
    let observeSpy: ReturnType<typeof vi.fn>;
    let disconnectSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        isMobileLayout = false;
        resizeCallback = undefined;
        observeSpy = vi.fn();
        disconnectSpy = vi.fn();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
        vi.mocked(MediaCoverLoader.load).mockResolvedValue('blob:loaded-cover');
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
            matches: isMobileLayout,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) {
                resizeCallback = () => callback([], this as unknown as ResizeObserver);
            }

            observe = observeSpy;
            disconnect = disconnectSpy;
            unobserve = vi.fn();
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders no totals cards when there are no visible totals', () => {
        const component = new ActivityTotals(container, {
            logs: [],
            mediaList: [],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();

        expect(container.querySelector('.dashboard-totals-grid')).not.toBeNull();
        expect(container.querySelector('.dashboard-totals-card')).toBeNull();

        const internals = component as unknown as {
            renderHighlights: (highlights: unknown[]) => string;
        };
        expect(internals.renderHighlights([])).toContain('No activity for this timeframe.');
    });

    it('renders bounded backend totals and highlights without raw logs or a media library', () => {
        const component = new ActivityTotals(container, {
            rangeData: {
                request_id: 1,
                start_date: '2026-06-08',
                end_date: '2026-06-14',
                bucket: 'day',
                group_by: 'activity_type',
                series: [],
                bucket_totals: [{ bucket: '2026-06-10', total_minutes: 90, total_characters: 2500 }],
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
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();
        const text = textContent(container);
        expect(text).toContain('Weekly Stats');
        expect(text).toContain('Novel');
        expect(text).toContain('Most Time Spent');
        expect(text).toContain('Novel A');
    });

    it('renders a six-month weekday radar in configured week order with accessible statistics', () => {
        const component = new ActivityTotals(container, {
            logs: weeklyLogs(),
            mediaList: weeklyMedia(),
            weekdayDistribution: {
                start_date: '2025-12-10',
                end_date: '2026-06-10',
                days: Array.from({ length: 7 }, (_, weekday) => ({
                    weekday,
                    average_minutes: (weekday + 1) * 30,
                    median_minutes: weekday * 20,
                    average_characters: (weekday + 1) * 5_000,
                    median_characters: weekday * 3_000,
                    sample_days: 26,
                })),
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
            metric: 'minutes',
        });

        component.render();

        const cards = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-totals-card'));
        const radar = container.querySelector<SVGElement>('.dashboard-weekday-radar');
        const labels = Array.from(container.querySelectorAll('.dashboard-weekday-label')).map(label => label.textContent);
        const mondayPoint = container.querySelector<SVGCircleElement>('[data-weekday="1"]');

        expect(cards.map(card => card.querySelector('h3')?.textContent)).toEqual([
            undefined,
            'Weekly Stats',
            'Categories',
            'Highlights',
        ]);
        expect(container.querySelector('.dashboard-highlights-card')).toBe(cards[3]);
        expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(radar?.getAttribute('aria-label')).toContain('Mon: average 1h');
        expect(radar?.querySelectorAll('.dashboard-weekday-grid polygon')).toHaveLength(4);
        expect(radar?.dataset.metric).toBe('minutes');
        expect(Array.from(radar?.querySelectorAll('.dashboard-weekday-scale text') ?? []).at(-1)?.textContent).toBe('4h');
        expect(mondayPoint?.dataset.average).toBe('60');
        expect(mondayPoint?.querySelector('title')?.textContent).toBe('Mon: avg 1h, median 20m');
        expect(container.textContent).not.toContain('Min–max');

        component.setState({ metric: 'characters' });
        const characterRadar = container.querySelector<SVGElement>('.dashboard-weekday-radar');
        const characterMonday = container.querySelector<SVGCircleElement>('[data-weekday="1"]');
        expect(container.querySelector<HTMLElement>('.dashboard-weekday-card')?.dataset.metric).toBe('characters');
        expect(characterRadar?.dataset.metric).toBe('characters');
        expect(Array.from(characterRadar?.querySelectorAll('.dashboard-weekday-scale text') ?? []).at(-1)?.textContent).toBe('40,000');
        expect(characterMonday?.dataset.average).toBe('10000');
        expect(characterMonday?.querySelector('title')?.textContent).toBe('Mon: avg 10,000 characters, median 3,000 characters');
    });

    it('renders a compact empty state when the weekday window has no timed activity', () => {
        const component = new ActivityTotals(container, {
            logs: [],
            mediaList: [],
            weekdayDistribution: {
                start_date: '2025-12-10',
                end_date: '2026-06-10',
                days: [],
            },
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 0,
        });

        component.render();

        expect(container.querySelector('.dashboard-weekday-card h3')).toBeNull();
        expect(textContent(container)).toContain('No timed activity in the last 6 months.');
        expect(container.querySelector('.dashboard-weekday-radar')).toBeNull();
    });

    it('renders weekly totals, category totals, highlights, cover images, and selected day diffs', async () => {
        const component = new ActivityTotals(container, {
            logs: weeklyLogs(),
            mediaList: weeklyMedia(),
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();
        await flushPromises();

        const text = textContent(container);
        expect(text).toContain('Weekly Stats');
        expect(text).toContain('06-08 to 06-14');
        expect(text).toContain('Wednesday 10/06');
        expect(text).toContain('Data for today');
        expect(text).toContain('2h');
        expect(text).toContain('1h 30m more than yesterday');
        expect(text).toContain('2,000 less than yesterday');

        expect(text).toContain('Categories');
        expect(text).toContain('Anime');
        expect(text).toContain('Novel');
        expect(text).toContain('Mystery');

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

        container.querySelector<HTMLButtonElement>('[data-dashboard-total-index="0"]')?.click();
        const selectedText = textContent(container);
        expect(selectedText).toContain('Data for Monday 08/06/2026');
        expect(selectedText).toContain('1h more than previous day');
        expect(selectedText).toContain('1,000 more than previous day');
    });

    it('renders every day in monthly stats and resets the selected bucket when the timeframe changes', () => {
        const logs = weeklyLogs();
        const component = new ActivityTotals(container, {
            logs: [
                ...logs,
                makeLog({ id: 9, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-30', duration_minutes: 45, characters: 0 }),
            ],
            mediaList: weeklyMedia(),
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();
        container.querySelector<HTMLButtonElement>('[data-dashboard-total-index="0"]')?.click();
        expect(textContent(container)).toContain('Data for Monday 08/06/2026');

        component.setState({ timeRangeDays: 30 });
        const monthlyText = textContent(container);
        expect(monthlyText).toContain('Monthly Stats');
        expect(monthlyText).toContain('2026-06');
        expect(monthlyText).toContain('Monday 01/06');
        expect(monthlyText).toContain('Tuesday 30/06');
        expect(monthlyText).toContain('Data for today');
        expect(monthlyText).not.toContain('Week 1');
        expect(container.querySelectorAll('[data-dashboard-total-index]')).toHaveLength(30);

        component.setState({ selectedBucketIndex: 29 });
        const selectedText = textContent(container);
        expect(selectedText).toContain('Data for Tuesday 30/06/2026');
        expect(selectedText).toContain('45m more than previous day');
    });

    it('renders yearly month buckets and all-time year buckets', () => {
        const component = new ActivityTotals(container, {
            logs: [
                makeLog({ id: 1, media_id: 1, title: 'Novel A', date: '2025-12-31', duration_minutes: 30, characters: 0 }),
                makeLog({ id: 2, media_id: 1, title: 'Novel A', date: '2026-01-02', duration_minutes: 60, characters: 1000 }),
                makeLog({ id: 3, media_id: 2, title: 'Anime B', activity_type: 'Watching', date: '2026-06-10', duration_minutes: 90, characters: 0 }),
            ],
            mediaList: [
                makeMedia({ id: 1, title: 'Novel A', content_type: 'Novel' }),
                makeMedia({ id: 2, title: 'Anime B', default_activity_type: 'Watching', content_type: 'Anime' }),
            ],
            timeRangeDays: 365,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();
        const yearlyText = textContent(container);
        expect(yearlyText).toContain('Yearly Stats');
        expect(yearlyText).toContain('2026');
        expect(yearlyText).toContain('January');
        expect(yearlyText).toContain('June');
        expect(yearlyText).toContain('Data for this month');
        expect(yearlyText).toContain('1h 30m more than last month');

        component.setState({ timeRangeDays: 0 });
        const allTimeText = textContent(container);
        expect(allTimeText).toContain('All Time Stats');
        expect(allTimeText).toContain('All Time');
        expect(allTimeText).toContain('2025');
        expect(allTimeText).toContain('2026');
        expect(allTimeText).toContain('Data for this year');
        expect(allTimeText).toContain('2h more than last year');

        component.setState({
            logs: [makeLog({ id: 4, media_id: 1, title: 'Novel A', date: '2024-01-01', duration_minutes: 15, characters: 0 })],
        });
        const fallbackText = textContent(container);
        expect(fallbackText).toContain('2024');
        expect(fallbackText).toContain('Data for this year');
    });

    it('renders characters-only totals without hour columns', () => {
        const component = new ActivityTotals(container, {
            logs: [
                makeLog({ id: 1, media_id: 1, title: 'Visual Novel', date: '2026-06-08', duration_minutes: 0, characters: 1 }),
                makeLog({ id: 2, media_id: 1, title: 'Visual Novel', date: '2026-06-09', duration_minutes: 0, characters: 2500 }),
            ],
            mediaList: [makeMedia({ id: 1, title: 'Visual Novel', content_type: 'Novel' })],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();

        const text = textContent(container);
        expect(text).toContain('Chars');
        expect(text).toContain('2,501');
        expect(text).not.toContain('Hours');
        expect(text).not.toContain('Time:');
        expect(text).toContain('Most Characters Read');
        expect(text).toContain('1 char');
    });

    it('renders table durations as hours and minutes instead of decimal hours', () => {
        const component = new ActivityTotals(container, {
            logs: [
                makeLog({ id: 1, media_id: 1, date: '2026-06-08', duration_minutes: 30 }),
                makeLog({ id: 2, media_id: 1, date: '2026-06-09', duration_minutes: 90 }),
            ],
            mediaList: [makeMedia({ id: 1, title: 'Novel A', content_type: 'Novel' })],
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();

        const statsTable = container.querySelector<HTMLElement>('.dashboard-stats-table');
        expect(statsTable).not.toBeNull();
        const mondayRow = statsTable?.querySelector<HTMLElement>('[data-dashboard-total-index="0"]');
        const tuesdayRow = statsTable?.querySelector<HTMLElement>('[data-dashboard-total-index="1"]');
        const totalRow = statsTable?.querySelector<HTMLElement>('.dashboard-stats-row-total');

        expect(mondayRow).not.toBeNull();

        expect(mondayRow?.lastElementChild?.textContent).toBe('30m');
        expect(tuesdayRow?.lastElementChild?.textContent).toBe('1h 30m');
        expect(totalRow?.lastElementChild?.textContent).toBe('2h');
        expect(statsTable?.textContent).not.toMatch(/\b\d+\.\d+\b/);
    });

    it('renders mobile highlights without pagination and responds to resize observer changes', async () => {
        const component = new ActivityTotals(container, {
            logs: weeklyLogs(),
            mediaList: weeklyMedia(),
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });
        const renderSpy = vi.spyOn(component, 'render');

        component.render();
        await flushPromises();
        await flushPromises();

        expect(observeSpy).toHaveBeenCalledWith(container);
        container.querySelector<HTMLButtonElement>('[data-highlights-dir="next"]')?.click();
        expect(textContent(container)).toContain('2/2');

        resizeCallback?.();
        expect(textContent(container)).toContain('2/2');

        isMobileLayout = true;
        resizeCallback?.();
        const resizedText = textContent(container);
        expect(renderSpy).toHaveBeenCalled();
        expect(container.querySelector('[data-highlights-dir="next"]')).toBeNull();
        expect(resizedText).toContain('Most Time Spent');
        expect(resizedText).toContain('Biggest Day');
        expect(resizedText).toContain('Biggest Streak');

        component.destroy();
        expect(disconnectSpy).toHaveBeenCalled();
    });

    it('logs cover loading failures without breaking highlight rendering', async () => {
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
        vi.mocked(MediaCoverLoader.load).mockRejectedValueOnce(new Error('cover failed'));
        const component = new ActivityTotals(container, {
            logs: weeklyLogs(),
            mediaList: weeklyMedia(),
            timeRangeDays: 7,
            timeRangeOffset: 0,
            weekStartDay: 1,
        });

        component.render();
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith('Failed to load dashboard highlight covers', expect.any(Error));
        expect(textContent(container)).toContain('Highlights');
    });
});

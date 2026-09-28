import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatsCard } from '../../../src/dashboard/StatsCard';
import { ActivitySummary, Media } from '../../../src/api';
import { SETTING_KEYS } from '../../../src/constants';
import { READING_REPORT_ANIMATION_MS } from '../../../src/dashboard/reading_report_display';
import type { ReadingContentType } from '../../../src/stats/reading_speed';
import type { ReadingReportResult } from '../../../src/stats/reading_report_service';

const { readingReportServiceMock } = vi.hoisted(() => {
    const listeners = new Set<(result: unknown) => void>();
    const state: { lastResult: unknown } = { lastResult: null };
    return {
        readingReportServiceMock: {
            subscribe: (listener: (result: unknown) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            getLastResult: () => state.lastResult,
            hydrateFromCache: () => {},
            markInvalidated: () => {},
            checkAndRecompute: () => {},
            __setResult: (result: unknown) => { state.lastResult = result; },
            __emit: (result: unknown) => {
                state.lastResult = result;
                for (const listener of listeners) listener(result);
            },
            __reset: () => { state.lastResult = null; listeners.clear(); },
        },
    };
});

vi.mock('../../../src/stats/reading_report_service', () => ({
    getReadingReportService: () => readingReportServiceMock,
}));

const apiMocks = vi.hoisted(() => ({ saveLocalSettingValues: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../src/api', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/api')>(),
    saveLocalSettingValues: apiMocks.saveLocalSettingValues,
}));

function buildReadingReportResult(
    speeds: Partial<Record<ReadingContentType, number>>,
    minutes: Partial<Record<ReadingContentType, number>>,
): ReadingReportResult {
    const zeroed: Record<ReadingContentType, number> = {
        Novel: 0, WebNovel: 0, NonFiction: 0, 'Visual Novel': 0, Manga: 0,
    };
    return { speeds: { ...zeroed, ...speeds }, minutes: { ...zeroed, ...minutes } };
}

describe('StatsCard', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
    });

    it('should render empty stats correctly', () => {
        const component = new StatsCard(container, { logs: [], mediaList: [] });
        component.render();
        
        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('0');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('0');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('0');
    });

    it('renders the backend aggregate without needing lifetime log or media arrays', () => {
        const component = new StatsCard(container, {
            summary: {
                total_logs: 2500,
                total_media: 300,
                logged_days: 500,
                first_activity_date: '2020-01-01',
                last_activity_date: '2026-07-21',
                max_streak: 42,
                current_streak: 7,
                total_minutes: 6000,
                total_characters: 1_500_000,
                day_scoped_total_minutes: 6000,
                day_scoped_total_characters: 1_500_000,
                activity_totals: [{ key: 'activity:Reading', label: 'Reading', total_minutes: 6000, total_characters: 1_500_000, day_scoped_total_minutes: 6000, day_scoped_total_characters: 1_500_000 }],
            },
        });
        component.render();

        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('2500');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('300');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('42');
        expect(container.textContent).toContain('Reading');
        expect(container.textContent).toContain('1,500,000');
    });

    it('should calculate and render streaks and averages correctly', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-01-01', date_precision: 'day', language: 'Japanese', notes: '' },
            { id: 2, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-01-02', date_precision: 'day', language: 'Japanese', notes: '' },
            { id: 3, media_id: 2, title: 'T2', activity_type: 'Watching', duration_minutes: 30, characters: 0, date: '2024-01-04', date_precision: 'day', language: 'Japanese', notes: '' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [{} as unknown as Media, {} as unknown as Media] });
        component.render();

        expect(container.querySelector('#stat-total-logs')?.textContent).toBe('3');
        expect(container.querySelector('#stat-total-media')?.textContent).toBe('2');
        expect(container.querySelector('#stat-max-streak')?.textContent).toBe('2'); // Jan 1-2
        expect(container.textContent).toContain('Reading');
        expect(container.textContent).toContain('2h'); // 120m
        expect(container.textContent).toContain('Watching');
        expect(container.textContent).toContain('30m');
    });

    it('should calculate and render character stats correctly', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 1000, date: '2024-03-01', date_precision: 'day', language: 'Japanese', notes: '' },
            { id: 2, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 2000, date: '2024-03-02', date_precision: 'day', language: 'Japanese', notes: '' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();

        expect(container.querySelector('#stat-total-chars')?.textContent).toBe('3,000');
        expect(container.querySelector('#stat-avg-chars')?.textContent).toContain('1,500 chars');
        expect(container.textContent).toContain('Total Characters:');
        expect(container.textContent).toContain('3,000');
    });

    it('should hide character stats if total characters is 0', () => {
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T1', activity_type: 'Reading', duration_minutes: 60, characters: 0, date: '2024-03-01', date_precision: 'day', language: 'Japanese', notes: '' },
        ];
        
        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();

        expect(container.querySelector('#stat-total-chars')).toBeNull();
        expect(container.querySelector('#stat-avg-chars')).toBeNull();
        expect(container.textContent).not.toContain('Total Characters:');
    });

    it('should update current streak correctly', () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        
        const logs: ActivitySummary[] = [
            { id: 1, media_id: 1, title: 'T', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: formatDate(yesterday), date_precision: 'day', language: 'Japanese', notes: '' },
            { id: 2, media_id: 1, title: 'T', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: formatDate(today), date_precision: 'day', language: 'Japanese', notes: '' },
        ];

        const component = new StatsCard(container, { logs, mediaList: [] });
        component.render();
        
        expect(container.querySelector('#stat-current-streak')?.textContent).toBe('2');
    });

    describe('reading speed subcard', () => {
        beforeEach(() => {
            readingReportServiceMock.__reset();
            apiMocks.saveLocalSettingValues.mockClear();
            document.body.dataset.theme = '';
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            document.body.dataset.theme = '';
            delete (document as unknown as Record<string, unknown>).visibilityState;
        });

        it('hides the panel entirely when no content type has computed a positive speed yet', () => {
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            expect(container.querySelector('#dashboard-reading-speed')).toBeNull();
        });

        it('hides the panel when every computed speed is zero', () => {
            readingReportServiceMock.__setResult(buildReadingReportResult({}, {}));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            expect(container.querySelector('#dashboard-reading-speed')).toBeNull();
        });

        it('ranks rows by descending speed and marks only the top row is-top', () => {
            readingReportServiceMock.__setResult(buildReadingReportResult(
                { Novel: 5000, Manga: 9000, WebNovel: 1000 },
                { Novel: 60, Manga: 30, WebNovel: 10 },
            ));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();

            const rows = Array.from(container.querySelectorAll('.dashboard-reading-speed-row'));
            expect(rows.map(row => row.getAttribute('data-content-type'))).toEqual(['Manga', 'Novel', 'WebNovel']);
            expect(rows[0].classList.contains('is-top')).toBe(true);
            expect(rows[1].classList.contains('is-top')).toBe(false);
            expect(rows[2].classList.contains('is-top')).toBe(false);
        });

        it('prettifies the Web Novel and Non-Fiction row labels', () => {
            readingReportServiceMock.__setResult(buildReadingReportResult(
                { WebNovel: 5000, NonFiction: 4000 },
                { WebNovel: 60, NonFiction: 60 },
            ));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();

            expect(container.querySelector('[data-content-type="WebNovel"] .dashboard-reading-speed-row-label')?.textContent).toBe('Web Novel');
            expect(container.querySelector('[data-content-type="NonFiction"] .dashboard-reading-speed-row-label')?.textContent).toBe('Non-Fiction');
        });

        it('sets the row tooltip to the metric hidden by the active tab, and updates it when the tab switches', () => {
            readingReportServiceMock.__setResult(buildReadingReportResult({ Novel: 6000 }, { Novel: 60 }));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();

            expect(container.querySelector('[data-content-type="Novel"]')?.getAttribute('title')).toBe('from 1h read');

            (container.querySelector('#reading-speed-toggle-time') as HTMLButtonElement).click();

            expect(container.querySelector('[data-content-type="Novel"]')?.getAttribute('title')).toBe('6,000 chars per hour');
        });

        it('switches metric instantly on tab click, re-ranks rows by the new metric, and persists the toggle', () => {
            readingReportServiceMock.__setResult(buildReadingReportResult(
                { Novel: 5000, Manga: 9000 },
                { Novel: 120, Manga: 30 },
            ));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            expect(Array.from(container.querySelectorAll('.dashboard-reading-speed-row')).map(row => row.getAttribute('data-content-type')))
                .toEqual(['Manga', 'Novel']);

            (container.querySelector('#reading-speed-toggle-time') as HTMLButtonElement).click();

            const rowsAfter = Array.from(container.querySelectorAll('.dashboard-reading-speed-row'));
            expect(rowsAfter.map(row => row.getAttribute('data-content-type'))).toEqual(['Novel', 'Manga']);
            expect(container.querySelector('[data-content-type="Novel"] .dashboard-reading-speed-row-value')?.textContent).toBe('2h 00m');
            expect(apiMocks.saveLocalSettingValues).toHaveBeenCalledWith({
                values: { [SETTING_KEYS.DASHBOARD_READING_REPORT_METRIC]: 'time' },
            });
        });

        it('writes the final values instantly when a result arrives while the card is not visible', async () => {
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            await Promise.resolve();

            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            readingReportServiceMock.__emit(buildReadingReportResult({ Novel: 6000 }, { Novel: 60 }));

            expect(container.querySelector('[data-content-type="Novel"] .dashboard-reading-speed-row-value')?.textContent).toBe('6,000');
        });

        it('removes a row whose speed drops to zero instantly, without animating', async () => {
            readingReportServiceMock.__setResult(buildReadingReportResult({ Novel: 6000 }, { Novel: 60 }));
            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            await Promise.resolve();
            expect(container.querySelector('[data-content-type="Novel"]')).not.toBeNull();

            readingReportServiceMock.__emit(buildReadingReportResult({ Novel: 0 }, { Novel: 0 }));

            expect(container.querySelector('[data-content-type="Novel"]')).toBeNull();
            expect(container.querySelector('#dashboard-reading-speed')).toBeNull();
        });

        it('counts up from zero, frame by frame, when a first-ever result arrives while the card is visible and motion is allowed', async () => {
            let pendingFrame: FrameRequestCallback | null = null;
            vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
                pendingFrame = callback;
                return 1;
            }));
            vi.stubGlobal('cancelAnimationFrame', vi.fn());
            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList));

            const component = new StatsCard(container, { logs: [], mediaList: [] });
            component.render();
            await Promise.resolve();

            readingReportServiceMock.__emit(buildReadingReportResult({ Novel: 6000 }, { Novel: 60 }));
            const value = () => container.querySelector('[data-content-type="Novel"] .dashboard-reading-speed-row-value')?.textContent;
            expect(value()).toBe('0');

            expect(pendingFrame).not.toBeNull();
            pendingFrame!(0);
            expect(value()).toBe('0');

            pendingFrame!(READING_REPORT_ANIMATION_MS);
            expect(value()).toBe('6,000');
        });
    });
});

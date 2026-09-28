import { describe, it, expect, vi } from 'vitest';
import { needsReadingReportRecompute, ReadingReportService } from '../../src/stats/reading_report_service';
import type { ReadingReportServiceDependencies, ReadingReportStamp } from '../../src/stats/reading_report_service';
import type { MediaReadingAggregateDto, ReadingReportInputsResponse } from '../../src/types';
import { SETTING_KEYS } from '../../src/constants';

function buildStamp(overrides: Partial<ReadingReportStamp> = {}): ReadingReportStamp {
    return {
        day: '2026-06-30',
        totalLogs: 100,
        totalMinutes: 5000,
        totalCharacters: 200000,
        totalMedia: 40,
        ...overrides,
    };
}

function buildAggregateDto(overrides: Partial<MediaReadingAggregateDto> = {}): MediaReadingAggregateDto {
    return {
        media_id: 1,
        content_type: 'Novel',
        tracking_status: 'Ongoing',
        extra_data: '{}',
        immersion_minutes: 60,
        has_dual: true,
        has_characters_only: false,
        window_dual_characters: 3000,
        window_dual_minutes: 60,
        window_timed_minutes: 60,
        window_characters_only_characters: 0,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function buildService(overrides: Partial<ReadingReportServiceDependencies> = {}): {
    service: ReadingReportService;
    fetchInputs: ReturnType<typeof vi.fn>;
    saveValues: ReturnType<typeof vi.fn>;
} {
    const dependencies: ReadingReportServiceDependencies = {
        fetchInputs: vi.fn(async (): Promise<ReadingReportInputsResponse> => ({ aggregates: [buildAggregateDto()] })),
        saveValues: vi.fn(async () => undefined),
        now: () => new Date('2026-06-30T12:00:00Z'),
        ...overrides,
    };
    return {
        service: new ReadingReportService(dependencies),
        fetchInputs: dependencies.fetchInputs as ReturnType<typeof vi.fn>,
        saveValues: dependencies.saveValues as ReturnType<typeof vi.fn>,
    };
}

describe('ReadingReportService', () => {
    it('fetches and saves on the first check of a session, notifying subscribers with the pooled result', async () => {
        const { service, fetchInputs, saveValues } = buildService();
        const listener = vi.fn();
        service.subscribe(listener);

        service.checkAndRecompute(buildStamp());
        await vi.waitFor(() => expect(saveValues).toHaveBeenCalledOnce());

        expect(fetchInputs).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledOnce();
        expect(service.getLastResult()!.speeds.Novel).toBe(3000);
        expect(service.getLastResult()!.minutes.Novel).toBe(60);
    });

    it('does not recompute again for an unchanged stamp', async () => {
        const { service, fetchInputs } = buildService();
        const stamp = buildStamp();
        service.checkAndRecompute(stamp);
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledOnce());

        service.checkAndRecompute({ ...stamp });
        await Promise.resolve();

        expect(fetchInputs).toHaveBeenCalledOnce();
    });

    it('recomputes again once totals differ from the last stamped computation', async () => {
        const { service, fetchInputs } = buildService();
        const stamp = buildStamp();
        service.checkAndRecompute(stamp);
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledOnce());

        service.checkAndRecompute(buildStamp({ totalLogs: 101 }));
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledTimes(2));
    });

    it('recomputes again once the window day moved', async () => {
        const { service, fetchInputs } = buildService();
        service.checkAndRecompute(buildStamp({ day: '2026-06-29' }));
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledOnce());

        service.checkAndRecompute(buildStamp({ day: '2026-06-30' }));
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledTimes(2));
    });

    it('recomputes once invalidated since the last stamped computation, even with unchanged totals', async () => {
        const { service, fetchInputs } = buildService();
        const stamp = buildStamp();
        service.checkAndRecompute(stamp);
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledOnce());

        service.markInvalidated();
        service.checkAndRecompute({ ...stamp });
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledTimes(2));
    });

    it('dedupes a second check for the same stamp while a fetch is already in flight', async () => {
        const pendingFetch = deferred<ReadingReportInputsResponse>();
        const { service, fetchInputs } = buildService({ fetchInputs: vi.fn(() => pendingFetch.promise) });
        const stamp = buildStamp();

        service.checkAndRecompute(stamp);
        service.checkAndRecompute({ ...stamp });
        expect(fetchInputs).toHaveBeenCalledOnce();

        pendingFetch.resolve({ aggregates: [buildAggregateDto()] });
        await vi.waitFor(() => expect(service.getLastResult()).not.toBeNull());
        expect(fetchInputs).toHaveBeenCalledOnce();
    });

    it('queues exactly one rerun for a stamp that differs from the in-flight one, and runs it after', async () => {
        const pendingFetch = deferred<ReadingReportInputsResponse>();
        const fetchInputs = vi.fn()
            .mockReturnValueOnce(pendingFetch.promise)
            .mockResolvedValueOnce({ aggregates: [buildAggregateDto({ window_dual_characters: 9000, window_dual_minutes: 60 })] });
        const { service } = buildService({ fetchInputs });
        const stampA = buildStamp();
        const stampB = buildStamp({ totalLogs: 101 });

        service.checkAndRecompute(stampA);
        service.checkAndRecompute(stampB);
        expect(fetchInputs).toHaveBeenCalledOnce();

        pendingFetch.resolve({ aggregates: [buildAggregateDto()] });
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(service.getLastResult()!.speeds.Novel).toBe(9000));
    });

    it('keeps the previous result and leaves the recompute unstamped when the fetch fails', async () => {
        const { service, fetchInputs, saveValues } = buildService({ fetchInputs: vi.fn().mockRejectedValueOnce(new Error('network down')) });
        const listener = vi.fn();
        service.subscribe(listener);
        const stamp = buildStamp();

        service.checkAndRecompute(stamp);
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledOnce());
        await Promise.resolve();

        expect(saveValues).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        expect(service.getLastResult()).toBeNull();

        service.checkAndRecompute({ ...stamp });
        await vi.waitFor(() => expect(fetchInputs).toHaveBeenCalledTimes(2));
    });

    it('keeps the previous result and does not change what the card shows when the save fails', async () => {
        const { service, saveValues } = buildService();
        const listener = vi.fn();
        service.subscribe(listener);
        const firstStamp = buildStamp();
        service.checkAndRecompute(firstStamp);
        await vi.waitFor(() => expect(service.getLastResult()).not.toBeNull());
        const resultAfterFirstSuccess = service.getLastResult();

        saveValues.mockRejectedValueOnce(new Error('write failed'));
        listener.mockClear();
        service.checkAndRecompute(buildStamp({ totalLogs: 101 }));
        await vi.waitFor(() => expect(saveValues).toHaveBeenCalledTimes(2));
        await Promise.resolve();

        expect(listener).not.toHaveBeenCalled();
        expect(service.getLastResult()).toEqual(resultAfterFirstSuccess);

        service.checkAndRecompute(buildStamp({ totalLogs: 101 }));
        await vi.waitFor(() => expect(saveValues).toHaveBeenCalledTimes(3));
    });

    it('does not overwrite an in-memory result with the persisted cache', async () => {
        const { service } = buildService();
        service.checkAndRecompute(buildStamp());
        await vi.waitFor(() => expect(service.getLastResult()).not.toBeNull());
        const computedResult = service.getLastResult();

        service.hydrateFromCache({ [SETTING_KEYS.STATS_NOVEL_SPEED]: '1' });

        expect(service.getLastResult()).toEqual(computedResult);
    });

    it('hydrates from the persisted cache when nothing has been computed yet this session', () => {
        const { service } = buildService();
        service.hydrateFromCache({
            [SETTING_KEYS.STATS_NOVEL_SPEED]: '8204',
            [SETTING_KEYS.STATS_NOVEL_MINUTES]: '3000',
        });

        const result = service.getLastResult()!;
        expect(result.speeds.Novel).toBe(8204);
        expect(result.minutes.Novel).toBe(3000);
        expect(result.speeds.Manga).toBe(0);
        expect(result.minutes.Manga).toBe(0);
    });

    it('stops notifying a listener once it unsubscribes', async () => {
        const { service } = buildService();
        const listener = vi.fn();
        const unsubscribe = service.subscribe(listener);
        unsubscribe();

        service.checkAndRecompute(buildStamp());
        await vi.waitFor(() => expect(service.getLastResult()).not.toBeNull());

        expect(listener).not.toHaveBeenCalled();
    });
});

describe('needsReadingReportRecompute', () => {
    it('recomputes when nothing has been computed yet this session', () => {
        expect(needsReadingReportRecompute(null, buildStamp(), false)).toBe(true);
    });

    it('does not recompute when nothing changed and nothing was invalidated', () => {
        const stamp = buildStamp();
        expect(needsReadingReportRecompute(stamp, { ...stamp }, false)).toBe(false);
    });

    it('recomputes when the window day moved', () => {
        const previous = buildStamp({ day: '2026-06-29' });
        const current = buildStamp({ day: '2026-06-30' });
        expect(needsReadingReportRecompute(previous, current, false)).toBe(true);
    });

    it('recomputes when total logs changed', () => {
        const previous = buildStamp({ totalLogs: 100 });
        const current = buildStamp({ totalLogs: 101 });
        expect(needsReadingReportRecompute(previous, current, false)).toBe(true);
    });

    it('recomputes when total minutes changed', () => {
        const previous = buildStamp({ totalMinutes: 5000 });
        const current = buildStamp({ totalMinutes: 5030 });
        expect(needsReadingReportRecompute(previous, current, false)).toBe(true);
    });

    it('recomputes when total characters changed', () => {
        const previous = buildStamp({ totalCharacters: 200000 });
        const current = buildStamp({ totalCharacters: 203000 });
        expect(needsReadingReportRecompute(previous, current, false)).toBe(true);
    });

    it('recomputes when total media changed', () => {
        const previous = buildStamp({ totalMedia: 40 });
        const current = buildStamp({ totalMedia: 41 });
        expect(needsReadingReportRecompute(previous, current, false)).toBe(true);
    });

    it('recomputes when invalidated, even with nothing else changed', () => {
        const stamp = buildStamp();
        expect(needsReadingReportRecompute(stamp, { ...stamp }, true)).toBe(true);
    });
});

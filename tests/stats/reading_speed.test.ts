import { describe, it, expect, vi } from 'vitest';
import {
    calculateTypeReadingSpeeds,
    classifySessionEvidence,
    estimateMediaReadingSpeed,
    isEstimatableImmersionSession,
    isInReadingReportWindow,
    isReadingContentType,
    poolTypeReadingSpeeds,
    READING_CONTENT_TYPES,
    readingReportWindow,
} from '../../src/stats/reading_speed';
import type { MediaReadingAggregate, ReadingReportWindow } from '../../src/stats/reading_speed';
import type { ActivitySummary, Media } from '../../src/types';
import { TRACKING_STATUSES } from '../../src/constants';

function buildMedia(overrides: Partial<Media> = {}): Media {
    return {
        id: 1,
        title: 'Test Media',
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Novel',
        tracking_status: 'Ongoing',
        ...overrides,
    };
}

function characterCountExtraData(characters: number | string): string {
    return JSON.stringify({ 'Character count': characters });
}

function readingSpeedExtraData(readingSpeed: number | string, characters?: number): string {
    const extraData: Record<string, number | string> = { 'Reading speed': readingSpeed };
    if (characters !== undefined) extraData['Character count'] = characters;
    return JSON.stringify(extraData);
}

let nextLogId = 1;
function buildLog(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
    return {
        id: nextLogId++,
        media_id: 1,
        title: 'Test Media',
        activity_type: 'Reading',
        duration_minutes: 0,
        characters: 0,
        date: '2024-01-01',
        date_precision: 'day',
        language: 'Japanese',
        notes: '',
        ...overrides,
    };
}

describe('reading_speed.ts', () => {
    describe('classifySessionEvidence', () => {
        it('classifies a session with positive time and characters as dual', () => {
            expect(classifySessionEvidence({ duration_minutes: 10, characters: 5 })).toBe('dual');
        });

        it('classifies a session with only positive time as time-only', () => {
            expect(classifySessionEvidence({ duration_minutes: 10, characters: 0 })).toBe('timeOnly');
        });

        it('classifies a session with only positive characters as characters-only', () => {
            expect(classifySessionEvidence({ duration_minutes: 0, characters: 5 })).toBe('charactersOnly');
        });

        it('classifies a session with neither as empty', () => {
            expect(classifySessionEvidence({ duration_minutes: 0, characters: 0 })).toBe('empty');
        });

        it('classifies negative values defensively, never leaving an unclassified region', () => {
            expect(classifySessionEvidence({ duration_minutes: -5, characters: -5 })).toBe('empty');
            expect(classifySessionEvidence({ duration_minutes: 10, characters: -5 })).toBe('timeOnly');
            expect(classifySessionEvidence({ duration_minutes: -5, characters: 10 })).toBe('charactersOnly');
        });
    });

    describe('isEstimatableImmersionSession', () => {
        it('counts Reading regardless of content type', () => {
            expect(isEstimatableImmersionSession('Reading', 'Novel')).toBe(true);
            expect(isEstimatableImmersionSession('Reading', 'Anime')).toBe(true);
        });

        it('counts Playing only for Visual Novel', () => {
            expect(isEstimatableImmersionSession('Playing', 'Visual Novel')).toBe(true);
            expect(isEstimatableImmersionSession('Playing', 'Videogame')).toBe(false);
        });

        it('excludes a Visual Novel session logged as Watching', () => {
            expect(isEstimatableImmersionSession('Watching', 'Visual Novel')).toBe(false);
        });

        it('excludes Watching and Listening in general', () => {
            expect(isEstimatableImmersionSession('Watching', 'Novel')).toBe(false);
            expect(isEstimatableImmersionSession('Listening', 'NonFiction')).toBe(false);
        });
    });

    describe('isReadingContentType', () => {
        it.each(READING_CONTENT_TYPES)('accepts %s', (contentType) => {
            expect(isReadingContentType(contentType)).toBe(true);
        });

        it.each(['Anime', 'Movie', 'Videogame', 'Audio', 'Drama', 'Livestream', 'Youtube Video', 'Unknown'])('rejects %s', (contentType) => {
            expect(isReadingContentType(contentType)).toBe(false);
        });
    });

    describe('readingReportWindow', () => {
        it('derives cutoff as the same calendar day one year before now', () => {
            const window = readingReportWindow(new Date(2026, 5, 15, 14, 30));
            expect(window).toEqual({ cutoff: '2025-06-15', today: '2026-06-15' });
        });

        it('ignores the time of day, including 23:59', () => {
            const window = readingReportWindow(new Date(2026, 5, 15, 23, 59));
            expect(window).toEqual({ cutoff: '2025-06-15', today: '2026-06-15' });
        });

        it('rolls a 29 Feb cutoff to 1 Mar of the prior non-leap year', () => {
            const window = readingReportWindow(new Date(2024, 1, 29));
            expect(window).toEqual({ cutoff: '2023-03-01', today: '2024-02-29' });
        });

        it('derives both bounds only from the given now, never from the real clock', () => {
            const fixedNow = new Date(2026, 5, 15, 12, 0);
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date(2030, 0, 1));
                const windowAtOneRealTime = readingReportWindow(fixedNow);
                vi.setSystemTime(new Date(2010, 0, 1));
                const windowAtAnotherRealTime = readingReportWindow(fixedNow);
                expect(windowAtOneRealTime).toEqual(windowAtAnotherRealTime);
                expect(windowAtOneRealTime).toEqual({ cutoff: '2025-06-15', today: '2026-06-15' });
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('isInReadingReportWindow', () => {
        const window: ReadingReportWindow = { cutoff: '2024-01-01', today: '2024-06-30' };

        it('admits a day log dated exactly at the cutoff', () => {
            expect(isInReadingReportWindow({ date: '2024-01-01', date_precision: 'day' }, window)).toBe(true);
        });

        it('excludes a day log dated before the cutoff', () => {
            expect(isInReadingReportWindow({ date: '2023-12-31', date_precision: 'day' }, window)).toBe(false);
        });

        it('admits a day log dated exactly at today', () => {
            expect(isInReadingReportWindow({ date: '2024-06-30', date_precision: 'day' }, window)).toBe(true);
        });

        it('excludes a future-dated day log', () => {
            expect(isInReadingReportWindow({ date: '2024-07-01', date_precision: 'day' }, window)).toBe(false);
        });

        it('admits a month log starting exactly on the cutoff day', () => {
            expect(isInReadingReportWindow({ date: '2024-01-01', date_precision: 'month' }, window)).toBe(true);
        });

        it('excludes a month log that only contains the cutoff day without starting on/after it', () => {
            const midMonthCutoffWindow: ReadingReportWindow = { cutoff: '2024-01-15', today: '2024-06-30' };
            expect(isInReadingReportWindow({ date: '2024-01-01', date_precision: 'month' }, midMonthCutoffWindow)).toBe(false);
        });

        it('admits a month log fully inside the window', () => {
            expect(isInReadingReportWindow({ date: '2024-03-01', date_precision: 'month' }, window)).toBe(true);
        });

        it('excludes the current, still-unfinished month', () => {
            const midMonthTodayWindow: ReadingReportWindow = { cutoff: '2024-01-01', today: '2024-06-15' };
            expect(isInReadingReportWindow({ date: '2024-06-01', date_precision: 'month' }, midMonthTodayWindow)).toBe(false);
        });

        it('admits a month log whose period ends exactly on today', () => {
            expect(isInReadingReportWindow({ date: '2024-06-01', date_precision: 'month' }, window)).toBe(true);
        });

        it('always excludes a year-scoped log, even one dated exactly at the cutoff', () => {
            expect(isInReadingReportWindow({ date: '2024-01-01', date_precision: 'year' }, window)).toBe(false);
        });

        it('excludes a year-scoped log spanning exactly 1 January of a cutoff year', () => {
            const janCutoffWindow: ReadingReportWindow = { cutoff: '2023-01-01', today: '2023-12-31' };
            expect(isInReadingReportWindow({ date: '2023-01-01', date_precision: 'year' }, janCutoffWindow)).toBe(false);
        });

        it('admits a day log anchored at the 9999 sentinel year', () => {
            const farFutureWindow: ReadingReportWindow = { cutoff: '9998-12-31', today: '9999-12-31' };
            expect(isInReadingReportWindow({ date: '9999-12-31', date_precision: 'day' }, farFutureWindow)).toBe(true);
        });

        it('admits a month log anchored at the 9999 sentinel year', () => {
            const farFutureWindow: ReadingReportWindow = { cutoff: '9998-12-31', today: '9999-12-31' };
            expect(isInReadingReportWindow({ date: '9999-12-01', date_precision: 'month' }, farFutureWindow)).toBe(true);
        });
    });

    describe('estimateMediaReadingSpeed', () => {
        describe('media-level cases', () => {
            it('hides everything with no immersion evidence at all', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(10000) });
                const logs = [buildLog({ duration_minutes: 0, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBeNull();
                expect(estimate.charactersPerHour).toBeNull();
                expect(estimate.completionPercent).toBeNull();
                expect(estimate.remainingMinutes).toBeNull();
                expect(estimate.estimatedTotalMinutes).toBeNull();
                expect(estimate.observedCharacters).toBe(0);
                expect(estimate.immersionMinutes).toBe(0);
            });

            it('uses workSessions with exact character completion when only dual sessions exist', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(10000) });
                const logs = [buildLog({ duration_minutes: 60, characters: 2000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(2000);
                expect(estimate.completionPercent).toBe(20);
                expect(estimate.remainingMinutes).toBeCloseTo(240);
                expect(estimate.estimatedTotalMinutes).toBeCloseTo(300);
            });

            it('uses workSessions with time-based completion when a time-only session mixes in', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(10000) });
                const logs = [
                    buildLog({ duration_minutes: 60, characters: 2000 }),
                    buildLog({ duration_minutes: 30, characters: 0 }),
                ];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(2000);
                expect(estimate.remainingMinutes).toBeCloseTo(210);
                expect(estimate.estimatedTotalMinutes).toBeCloseTo(300);
                expect(estimate.completionPercent).toBeCloseTo(30);
            });

            describe('a work with time-only sessions and a metadata total', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(6000) });
                const logs = [buildLog({ duration_minutes: 45, characters: 0 })];

                it('hides completion and remaining without a cached type speed', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, null);
                    expect(estimate.source).toBeNull();
                    expect(estimate.completionPercent).toBeNull();
                    expect(estimate.remainingMinutes).toBeNull();
                });

                it('shows time-based completion and remaining with a cached type speed', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, 6000);
                    expect(estimate.source).toBe('typeEstimate');
                    expect(estimate.charactersPerHour).toBe(6000);
                    expect(estimate.remainingMinutes).toBeCloseTo(15);
                    expect(estimate.estimatedTotalMinutes).toBeCloseTo(60);
                    expect(estimate.completionPercent).toBeCloseTo(75);
                });
            });

            describe('a work with characters-only sessions and a metadata total', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(10000) });
                const logs = [buildLog({ duration_minutes: 0, characters: 2500 })];

                it('shows exact character completion without a cached type speed, but no remaining time', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, null);
                    expect(estimate.source).toBeNull();
                    expect(estimate.completionPercent).toBe(25);
                    expect(estimate.remainingMinutes).toBeNull();
                    expect(estimate.estimatedTotalMinutes).toBeNull();
                });

                it('adds remaining time once a cached type speed exists', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, 5000);
                    expect(estimate.source).toBe('typeEstimate');
                    expect(estimate.completionPercent).toBe(25);
                    expect(estimate.remainingMinutes).toBeCloseTo(90);
                    expect(estimate.estimatedTotalMinutes).toBeCloseTo(90);
                });
            });

            describe('mixed time-only and characters-only sessions', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(50000) });
                const logs = [
                    buildLog({ duration_minutes: 0, characters: 19000 }),
                    buildLog({ duration_minutes: 20, characters: 0 }),
                ];

                it('hides completion and remaining without a cached type speed', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, null);
                    expect(estimate.source).toBeNull();
                    expect(estimate.completionPercent).toBeNull();
                    expect(estimate.remainingMinutes).toBeNull();
                });

                it('never reports completion below the characters already logged', () => {
                    const estimate = estimateMediaReadingSpeed(media, logs, 12000);
                    expect(estimate.source).toBe('typeEstimate');
                    expect(estimate.completionPercent).toBeCloseTo(38);
                    expect(estimate.remainingMinutes).toBeCloseTo(155);
                    expect(estimate.estimatedTotalMinutes).toBeCloseTo(175);
                });
            });

            it('shows the speed chip with no metadata total, hiding completion and remaining', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: '{}' });
                const logs = [buildLog({ duration_minutes: 60, characters: 2000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(2000);
                expect(estimate.completionPercent).toBeNull();
                expect(estimate.remainingMinutes).toBeNull();
            });

            it('has no consumer for a cached type speed with no metadata total and no dual sessions', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: '{}' });
                const logs = [buildLog({ duration_minutes: 45, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, 5000);
                expect(estimate.source).toBe('typeEstimate');
                expect(estimate.completionPercent).toBeNull();
                expect(estimate.remainingMinutes).toBeNull();
            });

            it('uses the completed anchor and hides completion/remaining on a Complete work', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
                const logs = [buildLog({ duration_minutes: 60, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('completedAnchor');
                expect(estimate.charactersPerHour).toBe(10000);
                expect(estimate.completionPercent).toBeNull();
                expect(estimate.remainingMinutes).toBeNull();
            });

            it('prefers its own dual sessions over the anchor on a Complete work carrying untimed reading', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: characterCountExtraData(100000) });
                const logs = [
                    buildLog({ duration_minutes: 60, characters: 5000 }),
                    buildLog({ duration_minutes: 60, characters: 5000 }),
                    buildLog({ duration_minutes: 0, characters: 90000 }),
                ];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(5000);
            });

            it('has no anchor speed on a Complete work with characters but zero immersion minutes', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
                const logs = [buildLog({ duration_minutes: 0, characters: 3000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, 4000);
                expect(estimate.source).toBe('typeEstimate');
                expect(estimate.charactersPerHour).toBe(4000);
                expect(estimate.completionPercent).toBeNull();
                expect(estimate.remainingMinutes).toBeNull();
            });

            it('shows the speed chip on a Complete work with no metadata total but dual sessions', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: '{}' });
                const logs = [buildLog({ duration_minutes: 30, characters: 3000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(6000);
                expect(estimate.completionPercent).toBeNull();
            });

            it('has no consumer for a cached type speed on a Complete work with no metadata total and no dual sessions', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: '{}' });
                const logs = [buildLog({ duration_minutes: 45, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, 5000);
                expect(estimate.source).toBe('typeEstimate');
                expect(estimate.completionPercent).toBeNull();
            });
        });

        describe('manual override', () => {
            it("outranks the completed anchor and the work's own dual sessions", () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: readingSpeedExtraData(7000, 100000) });
                const logs = [buildLog({ duration_minutes: 60, characters: 5000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, 3000);
                expect(estimate.source).toBe('manualOverride');
                expect(estimate.charactersPerHour).toBe(7000);
            });

            it('drives completion and remaining time on an ongoing work', () => {
                const media = buildMedia({ extra_data: readingSpeedExtraData(5000, 10000) });
                const logs = [buildLog({ duration_minutes: 60, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.completionPercent).toBe(50);
                expect(estimate.remainingMinutes).toBe(60);
            });

            it('falls through to the computed sources when the override is not a positive number', () => {
                const media = buildMedia({ extra_data: readingSpeedExtraData('nonsense') });
                const logs = [buildLog({ duration_minutes: 60, characters: 4000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBe('workSessions');
                expect(estimate.charactersPerHour).toBe(4000);
            });
        });

        describe('non-reading and mixed-activity handling', () => {
            it('treats a reading-type work with only Watching/Listening logs as having no immersion sessions', () => {
                const media = buildMedia({ content_type: 'Novel', default_activity_type: 'Reading' });
                const logs = [
                    buildLog({ activity_type: 'Watching', duration_minutes: 60, characters: 0 }),
                    buildLog({ activity_type: 'Listening', duration_minutes: 30, characters: 0 }),
                ];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.source).toBeNull();
                expect(estimate.observedCharacters).toBe(0);
                expect(estimate.immersionMinutes).toBe(0);
            });

            it('only counts Reading logs when a work has a mix of Reading and Watching logs', () => {
                const media = buildMedia({ content_type: 'Manga', default_activity_type: 'Reading' });
                const logs = [
                    buildLog({ activity_type: 'Reading', duration_minutes: 30, characters: 1000 }),
                    buildLog({ activity_type: 'Watching', duration_minutes: 500, characters: 0 }),
                ];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.immersionMinutes).toBe(30);
                expect(estimate.observedCharacters).toBe(1000);
            });
        });

        describe('degenerate values', () => {
            it.each([
                ['{}'],
                [characterCountExtraData(0)],
                [characterCountExtraData(-500)],
                [characterCountExtraData('not a number')],
            ])('treats %s as an absent metadata total', (extraData) => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: extraData });
                const logs = [buildLog({ duration_minutes: 60, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.completionPercent).toBeNull();
            });

            it('clamps completion to 100% and floors remaining at 0 when observed characters exceed the metadata total', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(1000) });
                const logs = [buildLog({ duration_minutes: 60, characters: 5000 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.completionPercent).toBe(100);
                expect(estimate.remainingMinutes).toBe(0);
            });

            it('falls through to no source when the cached type speed is zero', () => {
                const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(1000) });
                const logs = [buildLog({ duration_minutes: 30, characters: 0 })];
                const estimate = estimateMediaReadingSpeed(media, logs, 0);
                expect(estimate.source).toBeNull();
            });
        });

        describe('tracking status handling', () => {
            it.each(TRACKING_STATUSES.filter(status => status !== 'Complete'))('treats %s the same as Ongoing for progress', (status) => {
                const media = buildMedia({ tracking_status: status, extra_data: characterCountExtraData(1000) });
                const logs = [buildLog({ duration_minutes: 30, characters: 500 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.completionPercent).toBe(50);
            });

            it('hides completion and remaining only for Complete', () => {
                const media = buildMedia({ tracking_status: 'Complete', extra_data: characterCountExtraData(1000) });
                const logs = [buildLog({ duration_minutes: 30, characters: 500 })];
                const estimate = estimateMediaReadingSpeed(media, logs, null);
                expect(estimate.completionPercent).toBeNull();
            });
        });

        it('computes the real work speed instead of a stale type average', () => {
            const media = buildMedia({ tracking_status: 'Ongoing', extra_data: characterCountExtraData(112441) });
            const logs = [buildLog({ duration_minutes: 30, characters: 2541 })];
            const estimate = estimateMediaReadingSpeed(media, logs, 2875);
            expect(estimate.source).toBe('workSessions');
            expect(estimate.charactersPerHour).toBeCloseTo(5082, 0);
            expect(estimate.completionPercent).toBeCloseTo(2.26, 2);
        });
    });

    describe('calculateTypeReadingSpeeds', () => {
        const cutoffDate = '2024-01-01';
        const window: ReadingReportWindow = { cutoff: cutoffDate, today: '2024-12-31' };

        it('pools dual sessions within the cutoff window for a work resolved to workSessions', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 3000 }),
                buildLog({ media_id: 1, date: '2023-01-01', duration_minutes: 60, characters: 1000 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Novel.charactersPerHour).toBe(3000);
            expect(result.Novel.hours).toBe(1);
        });

        it('contributes only the anchor figures for a work resolved to completedAnchor, even with dual sessions too', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 3000 })];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Manga.charactersPerHour).toBe(10000);
            expect(result.Manga.hours).toBe(1);
        });

        it('pools an overridden work at its in-window logged hours', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', extra_data: readingSpeedExtraData(6000) });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 120, characters: 1000 }),
                buildLog({ media_id: 1, date: '2023-01-01', duration_minutes: 600, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Novel.charactersPerHour).toBe(6000);
            expect(result.Novel.hours).toBe(2);
        });

        it('weights an overridden work with untimed sessions by the hours the override implies', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', extra_data: readingSpeedExtraData(6000) });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 12000 })];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Novel.charactersPerHour).toBe(6000);
            expect(result.Novel.hours).toBe(2);
        });

        it('excludes a completedAnchor work whose newest immersion log falls outside the cutoff', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [buildLog({ media_id: 1, date: '2022-01-01', duration_minutes: 60, characters: 0 })];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Manga.hours).toBe(0);
            expect(result.Manga.charactersPerHour).toBe(0);
        });

        it('keeps a completedAnchor work excluded when its only in-window log carries no time and no characters', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [
                buildLog({ media_id: 1, date: '2022-01-01', duration_minutes: 60, characters: 0 }),
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Manga.hours).toBe(0);
            expect(result.Manga.charactersPerHour).toBe(0);
        });

        it('includes a completedAnchor work whose in-window evidence is older than its empty logs', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [
                buildLog({ media_id: 1, date: '2024-02-01', duration_minutes: 60, characters: 0 }),
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Manga.hours).toBe(1);
            expect(result.Manga.charactersPerHour).toBe(10000);
        });

        it('excludes a work that resolves to no speed source', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 30, characters: 0 })];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result.Novel.hours).toBe(0);
        });

        it('pools contributing works by total characters over total hours, not by averaging their speeds', () => {
            const longSlowWork = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const shortFastWork = buildMedia({ id: 2, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 600, characters: 20000 }),
                buildLog({ media_id: 2, date: '2024-06-01', duration_minutes: 60, characters: 10000 }),
            ];

            const result = calculateTypeReadingSpeeds(logs, [longSlowWork, shortFastWork], window);

            // 30,000 characters over 11 hours. Averaging the works' own speeds would give 6,000.
            expect(result.Novel.charactersPerHour).toBeCloseTo(30000 / 11);
            expect(result.Novel.hours).toBeCloseTo(11);
        });

        it('pools an anchor work and a session work of the same content type together', () => {
            const completedWork = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const ongoingWork = buildMedia({ id: 2, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 0 }),
                buildLog({ media_id: 2, date: '2024-06-01', duration_minutes: 60, characters: 4000 }),
            ];

            const result = calculateTypeReadingSpeeds(logs, [completedWork, ongoingWork], window);

            expect(result.Novel.charactersPerHour).toBe(7000);
            expect(result.Novel.hours).toBe(2);
        });

        it('keeps content types from contaminating each other', () => {
            const novel = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const manga = buildMedia({ id: 2, content_type: 'Manga', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 3000 }),
                buildLog({ media_id: 2, date: '2024-06-01', duration_minutes: 60, characters: 9000 }),
            ];

            const result = calculateTypeReadingSpeeds(logs, [novel, manga], window);

            expect(result.Novel.charactersPerHour).toBe(3000);
            expect(result.Manga.charactersPerHour).toBe(9000);
            expect(result.WebNovel.charactersPerHour).toBe(0);
            expect(result.WebNovel.hours).toBe(0);
        });

        it('only pools Reading (or Playing for Visual Novel) logs', () => {
            const media = buildMedia({ id: 1, content_type: 'Visual Novel', default_activity_type: 'Playing', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', activity_type: 'Playing', duration_minutes: 60, characters: 3000 }),
                buildLog({ media_id: 1, date: '2024-06-02', activity_type: 'Watching', duration_minutes: 60, characters: 3000 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], window);
            expect(result['Visual Novel'].charactersPerHour).toBe(3000);
            expect(result['Visual Novel'].hours).toBe(1);
        });
    });

    describe('poolTypeReadingSpeeds', () => {
        function buildAggregate(overrides: Partial<MediaReadingAggregate> = {}): MediaReadingAggregate {
            return {
                mediaId: 1,
                contentType: 'Novel',
                trackingStatus: 'Ongoing',
                extraData: '{}',
                immersionMinutes: 0,
                hasDual: false,
                hasCharactersOnly: false,
                windowDualCharacters: 0,
                windowDualMinutes: 0,
                windowTimedMinutes: 0,
                windowCharactersOnlyCharacters: 0,
                ...overrides,
            };
        }

        it('weights an override by its own timed minutes when there are no characters-only sessions', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({ extraData: readingSpeedExtraData(4000), windowTimedMinutes: 120 }),
            ]);
            expect(result.Novel.charactersPerHour).toBe(4000);
            expect(result.Novel.hours).toBe(2);
        });

        it('weights an override by the hours its own rate implies for characters-only sessions', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({
                    extraData: readingSpeedExtraData(6000),
                    windowTimedMinutes: 60,
                    windowCharactersOnlyCharacters: 6000,
                }),
            ]);
            expect(result.Novel.charactersPerHour).toBe(6000);
            expect(result.Novel.hours).toBe(2);
        });

        it('contributes only the completed-anchor figures, ignoring dual sessions on the same aggregate', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({
                    contentType: 'Manga',
                    trackingStatus: 'Complete',
                    extraData: characterCountExtraData(9000),
                    immersionMinutes: 180,
                    hasDual: true,
                    windowDualCharacters: 999999,
                    windowDualMinutes: 999,
                }),
            ]);
            expect(result.Manga.charactersPerHour).toBe(3000);
            expect(result.Manga.hours).toBe(3);
        });

        it('contributes an ongoing work\'s window-scoped dual sums when it has no override or anchor', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({
                    contentType: 'Visual Novel',
                    hasDual: true,
                    windowDualCharacters: 5000,
                    windowDualMinutes: 60,
                }),
            ]);
            expect(result['Visual Novel'].charactersPerHour).toBe(5000);
            expect(result['Visual Novel'].hours).toBe(1);
        });

        it('contributes nothing for an aggregate with no override, no anchor and no dual evidence', () => {
            const result = poolTypeReadingSpeeds([buildAggregate({ contentType: 'WebNovel' })]);
            expect(result.WebNovel.charactersPerHour).toBe(0);
            expect(result.WebNovel.hours).toBe(0);
        });

        it('ignores an aggregate whose content type is not a reading type', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({
                    contentType: 'Anime',
                    hasDual: true,
                    windowDualCharacters: 5000,
                    windowDualMinutes: 60,
                }),
            ]);
            for (const contentType of READING_CONTENT_TYPES) {
                expect(result[contentType].charactersPerHour).toBe(0);
                expect(result[contentType].hours).toBe(0);
            }
        });

        it('sums characters and hours across aggregates before dividing, not averaging their individual rates', () => {
            const result = poolTypeReadingSpeeds([
                buildAggregate({ mediaId: 1, hasDual: true, windowDualCharacters: 20000, windowDualMinutes: 600 }),
                buildAggregate({ mediaId: 2, hasDual: true, windowDualCharacters: 10000, windowDualMinutes: 60 }),
            ]);
            expect(result.Novel.charactersPerHour).toBeCloseTo(30000 / 11);
            expect(result.Novel.hours).toBeCloseTo(11);
        });
    });
});
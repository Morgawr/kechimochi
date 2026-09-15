import { describe, it, expect } from 'vitest';
import {
    calculateTypeReadingSpeeds,
    classifySessionEvidence,
    estimateMediaReadingSpeed,
    isEstimatableImmersionSession,
    isReadingContentType,
    READING_CONTENT_TYPES,
} from '../../src/stats/reading_speed';
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

        it('pools dual sessions within the cutoff window for a work resolved to workSessions', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 3000 }),
                buildLog({ media_id: 1, date: '2023-01-01', duration_minutes: 60, characters: 1000 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Novel.charactersPerHour).toBe(3000);
            expect(result.Novel.hours).toBe(1);
        });

        it('contributes only the anchor figures for a work resolved to completedAnchor, even with dual sessions too', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 60, characters: 3000 })];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Manga.charactersPerHour).toBe(10000);
            expect(result.Manga.hours).toBe(1);
        });

        it('pools an overridden work at its in-window logged hours', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', extra_data: readingSpeedExtraData(6000) });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 120, characters: 1000 }),
                buildLog({ media_id: 1, date: '2023-01-01', duration_minutes: 600, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Novel.charactersPerHour).toBe(6000);
            expect(result.Novel.hours).toBe(2);
        });

        it('weights an overridden work with untimed sessions by the hours the override implies', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', extra_data: readingSpeedExtraData(6000) });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 12000 })];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Novel.charactersPerHour).toBe(6000);
            expect(result.Novel.hours).toBe(2);
        });

        it('excludes a completedAnchor work whose newest immersion log falls outside the cutoff', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [buildLog({ media_id: 1, date: '2022-01-01', duration_minutes: 60, characters: 0 })];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Manga.hours).toBe(0);
            expect(result.Manga.charactersPerHour).toBe(0);
        });

        it('keeps a completedAnchor work excluded when its only in-window log carries no time and no characters', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [
                buildLog({ media_id: 1, date: '2022-01-01', duration_minutes: 60, characters: 0 }),
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Manga.hours).toBe(0);
            expect(result.Manga.charactersPerHour).toBe(0);
        });

        it('includes a completedAnchor work whose in-window evidence is older than its empty logs', () => {
            const media = buildMedia({ id: 1, content_type: 'Manga', tracking_status: 'Complete', extra_data: characterCountExtraData(10000) });
            const logs = [
                buildLog({ media_id: 1, date: '2024-02-01', duration_minutes: 60, characters: 0 }),
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 0, characters: 0 }),
            ];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Manga.hours).toBe(1);
            expect(result.Manga.charactersPerHour).toBe(10000);
        });

        it('excludes a work that resolves to no speed source', () => {
            const media = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 30, characters: 0 })];
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result.Novel.hours).toBe(0);
        });

        it('pools contributing works by total characters over total hours, not by averaging their speeds', () => {
            const longSlowWork = buildMedia({ id: 1, content_type: 'Novel', tracking_status: 'Ongoing' });
            const shortFastWork = buildMedia({ id: 2, content_type: 'Novel', tracking_status: 'Ongoing' });
            const logs = [
                buildLog({ media_id: 1, date: '2024-06-01', duration_minutes: 600, characters: 20000 }),
                buildLog({ media_id: 2, date: '2024-06-01', duration_minutes: 60, characters: 10000 }),
            ];

            const result = calculateTypeReadingSpeeds(logs, [longSlowWork, shortFastWork], cutoffDate);

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

            const result = calculateTypeReadingSpeeds(logs, [completedWork, ongoingWork], cutoffDate);

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

            const result = calculateTypeReadingSpeeds(logs, [novel, manga], cutoffDate);

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
            const result = calculateTypeReadingSpeeds(logs, [media], cutoffDate);
            expect(result['Visual Novel'].charactersPerHour).toBe(3000);
            expect(result['Visual Novel'].hours).toBe(1);
        });
    });
});
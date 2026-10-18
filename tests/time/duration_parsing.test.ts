import { describe, it, expect } from 'vitest';
import { parseDuration, withEpisodeCount } from '../../src/time/duration_parsing';

const ANIME_EPISODE_DURATION_MINUTES = 24;

const parsedMinutes = (rawInput: string): number | null => {
    const result = parseDuration(rawInput);
    return result.status === 'parsed' ? result.minutes : null;
};

describe('duration_parsing.ts', () => {
    describe('parseDuration', () => {
        it('should parse empty input as 0 minutes', () => {
            expect(parsedMinutes('')).toBe(0);
            expect(parsedMinutes('   ')).toBe(0);
        });

        it('should parse a bare number as minutes', () => {
            expect(parsedMinutes('0')).toBe(0);
            expect(parsedMinutes('18')).toBe(18);
            expect(parsedMinutes('120')).toBe(120);
        });

        it('should trim surrounding whitespace around a bare number', () => {
            expect(parsedMinutes('  18  ')).toBe(18);
        });

        it('should parse a single unit', () => {
            expect(parsedMinutes('2h')).toBe(120);
            expect(parsedMinutes('90m')).toBe(90);
            expect(parsedMinutes('1d')).toBe(1440);
            expect(parsedMinutes('45s')).toBe(1);
            expect(parsedMinutes('15s')).toBe(0);
            expect(parsedMinutes('30s')).toBe(1);
        });

        it('should parse combined units regardless of spacing', () => {
            expect(parsedMinutes('4h30m')).toBe(270);
            expect(parsedMinutes('2h 15m')).toBe(135);
            expect(parsedMinutes('1d2h 30m4s')).toBe(1590);
            expect(parsedMinutes('2h 15m 30s')).toBe(136);
        });

        it('should read a trailing unitless number as minutes', () => {
            expect(parsedMinutes('1h30')).toBe(90);
            expect(parsedMinutes('1h 30')).toBe(90);
            expect(parsedMinutes('2h 15')).toBe(135);
            expect(parsedMinutes('1d2h30')).toBe(1590);
        });

        it('should reject a trailing unitless number when minutes are already given', () => {
            expect(parsedMinutes('2h15m3')).toBeNull();
        });

        it('should reject anything following a trailing unitless number', () => {
            expect(parsedMinutes('2h 15 30')).toBeNull();
            expect(parsedMinutes('1 2m')).toBeNull();
        });

        it('should parse units case-insensitively', () => {
            expect(parsedMinutes('2H15M')).toBe(135);
            expect(parsedMinutes('1D')).toBe(1440);
        });

        it('should reject the min unit', () => {
            expect(parsedMinutes('4h30min')).toBeNull();
        });

        it('should reject a number separated from its unit by whitespace', () => {
            expect(parsedMinutes('2 h')).toBeNull();
        });

        it('should reject a dash-separated range', () => {
            expect(parsedMinutes('15-20')).toBeNull();
        });

        it('should reject a clock-formatted time', () => {
            expect(parsedMinutes('12:20')).toBeNull();
        });

        it('should reject a negative number', () => {
            expect(parsedMinutes('-1')).toBeNull();
        });

        it('should reject a decimal number', () => {
            expect(parsedMinutes('1.5h')).toBeNull();
        });

        it('should reject non-numeric input', () => {
            expect(parsedMinutes('abc')).toBeNull();
        });

        it('should reject a repeated unit', () => {
            expect(parsedMinutes('2h2h')).toBeNull();
        });

        it('should reject a unit letter with no number', () => {
            expect(parsedMinutes('h')).toBeNull();
        });

        it('should reject an unrecognized unit letter', () => {
            expect(parsedMinutes('2x')).toBeNull();
        });

        it('should reject scientific notation', () => {
            expect(parsedMinutes('1e3')).toBeNull();
        });

        it('should accept large durations', () => {
            expect(parsedMinutes('1000001')).toBe(1000001);
            expect(parsedMinutes('9999d')).toBe(9999 * 24 * 60);
        });

        it('should report notation mistakes as unrecognized', () => {
            expect(parseDuration('abc')).toEqual({ status: 'unrecognized' });
            expect(parseDuration('12:20')).toEqual({ status: 'unrecognized' });
        });

        it('should report values beyond safe integer precision as too large', () => {
            expect(parseDuration('99999999999999999999')).toEqual({ status: 'tooLarge' });
            expect(parseDuration('99999999999999d')).toEqual({ status: 'tooLarge' });
        });

        it('should report a digit run too long to tokenize as unrecognized', () => {
            expect(parseDuration('99999999999999999999d')).toEqual({ status: 'unrecognized' });
        });

        it('should report zero episodes for input without an episode unit', () => {
            expect(parseDuration('1h30m', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 90, episodeCount: 0 });
            expect(parseDuration('45', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 45, episodeCount: 0 });
        });
    });

    describe('parseDuration with episodes', () => {
        it('should multiply episodes by the episode duration', () => {
            expect(parseDuration('3ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 72, episodeCount: 3 });
        });

        it('should add other units on top of the episodes', () => {
            expect(parseDuration('3ep 6m', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 78, episodeCount: 3 });
            expect(parseDuration('2ep1h', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 108, episodeCount: 2 });
        });

        it('should read a trailing unitless number after episodes as minutes', () => {
            expect(parseDuration('2ep 6', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 54, episodeCount: 2 });
        });

        it('should parse the episode unit case-insensitively', () => {
            expect(parseDuration('2EP', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 48, episodeCount: 2 });
            expect(parseDuration('2Ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 48, episodeCount: 2 });
        });

        it('should parse zero episodes as zero minutes', () => {
            expect(parseDuration('0ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 0, episodeCount: 0 });
        });

        it('should use the given episode duration', () => {
            expect(parseDuration('2ep', 45)).toEqual({ status: 'parsed', minutes: 90, episodeCount: 2 });
        });

        it('should reject a repeated episode unit', () => {
            expect(parseDuration('2ep 3ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'unrecognized' });
        });

        it('should reject a truncated episode unit', () => {
            expect(parseDuration('3e', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'unrecognized' });
        });

        it('should reject the episode unit with no number', () => {
            expect(parseDuration('ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'unrecognized' });
        });

        it('should report episodes without an episode duration as episode duration unknown', () => {
            expect(parseDuration('3ep')).toEqual({ status: 'episodeDurationUnknown' });
            expect(parseDuration('3ep 6m', null)).toEqual({ status: 'episodeDurationUnknown' });
        });

        it('should report a notation mistake before a missing episode duration', () => {
            expect(parseDuration('3ep 3ep')).toEqual({ status: 'unrecognized' });
        });

        it('should report an episode total beyond safe integer precision as too large', () => {
            expect(parseDuration('999999999999999ep', ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'tooLarge' });
        });
    });

    describe('withEpisodeCount', () => {
        it('should put the episode count in front of the other units', () => {
            expect(withEpisodeCount('50m', 5)).toBe('5ep 50m');
            expect(withEpisodeCount('1h 6m', 2)).toBe('2ep 1h 6m');
        });

        it('should replace an existing episode count', () => {
            expect(withEpisodeCount('3ep 6m', 4)).toBe('4ep 6m');
            expect(withEpisodeCount('6m 3EP', 4)).toBe('4ep 6m');
        });

        it('should replace an episode count joined to other units', () => {
            expect(withEpisodeCount('3ep1h', 4)).toBe('4ep 1h');
        });

        it('should write empty input as the episode count alone', () => {
            expect(withEpisodeCount('', 1)).toBe('1ep');
            expect(withEpisodeCount('   ', 2)).toBe('2ep');
        });

        it('should mark a bare number as minutes so it stays minutes after the episode count', () => {
            expect(withEpisodeCount('72', 1)).toBe('1ep 72m');
            expect(withEpisodeCount('1h30', 1)).toBe('1ep 1h30m');
        });

        it('should drop a bare zero instead of writing it as minutes', () => {
            expect(withEpisodeCount('0', 1)).toBe('1ep');
            expect(withEpisodeCount('1h0', 1)).toBe('1ep 1h');
        });

        it('should drop the episode count at zero episodes', () => {
            expect(withEpisodeCount('5ep 50m', 0)).toBe('50m');
            expect(withEpisodeCount('5ep', 0)).toBe('');
        });

        it('should keep the total of the other units unchanged', () => {
            const rewritten = withEpisodeCount('1h30', 2);
            expect(parseDuration(rewritten, ANIME_EPISODE_DURATION_MINUTES)).toEqual({ status: 'parsed', minutes: 138, episodeCount: 2 });
        });
    });
});
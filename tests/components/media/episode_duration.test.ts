import { describe, it, expect } from 'vitest';
import {
    DEFAULT_ANIME_EPISODE_DURATION_MINUTES,
    getEpisodeDurationOverride,
    isEpisodicMedia,
    resolveEpisodeDurationMinutes,
} from '../../../src/media/episodes/episode_duration';

describe('episode_duration.ts', () => {
    describe('isEpisodicMedia', () => {
        it('should treat only anime as episodic', () => {
            expect(isEpisodicMedia({ content_type: 'Anime' })).toBe(true);
            expect(isEpisodicMedia({ content_type: 'Drama' })).toBe(false);
            expect(isEpisodicMedia({ content_type: 'Manga' })).toBe(false);
        });
    });

    describe('getEpisodeDurationOverride', () => {
        it('should read the Episode duration field', () => {
            expect(getEpisodeDurationOverride({ extra_data: '{"Episode duration":"25m"}' })).toBe(25);
        });

        it('should return null when the field is missing or the extra data is malformed', () => {
            expect(getEpisodeDurationOverride({ extra_data: '{}' })).toBeNull();
            expect(getEpisodeDurationOverride({ extra_data: '' })).toBeNull();
            expect(getEpisodeDurationOverride({ extra_data: '{not json' })).toBeNull();
        });
    });

    describe('resolveEpisodeDurationMinutes', () => {
        it('should use the default duration for anime without an override', () => {
            expect(resolveEpisodeDurationMinutes({ content_type: 'Anime', extra_data: '{}' })).toBe(DEFAULT_ANIME_EPISODE_DURATION_MINUTES);
        });

        it('should prefer the override for anime', () => {
            expect(resolveEpisodeDurationMinutes({ content_type: 'Anime', extra_data: '{"Episode duration":"1h"}' })).toBe(60);
        });

        it('should fall back to the default duration for a zero or unreadable override', () => {
            expect(resolveEpisodeDurationMinutes({ content_type: 'Anime', extra_data: '{"Episode duration":"0"}' })).toBe(DEFAULT_ANIME_EPISODE_DURATION_MINUTES);
            expect(resolveEpisodeDurationMinutes({ content_type: 'Anime', extra_data: '{"Episode duration":"long"}' })).toBe(DEFAULT_ANIME_EPISODE_DURATION_MINUTES);
        });

        it('should return null for non-anime media, even with an override', () => {
            expect(resolveEpisodeDurationMinutes({ content_type: 'Manga', extra_data: '{"Episode duration":"25m"}' })).toBeNull();
        });

        it('should return null without a media', () => {
            expect(resolveEpisodeDurationMinutes(undefined)).toBeNull();
        });
    });
});

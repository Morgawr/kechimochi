import type { Media } from '../../types';
import type { CONTENT_TYPES } from '../../constants';
import { getEpisodeDurationFromExtraData, readMediaExtraData } from '../../extra_data';

const EPISODIC_CONTENT_TYPE: typeof CONTENT_TYPES[number] = 'Anime';

export const DEFAULT_ANIME_EPISODE_DURATION_MINUTES = 24;

export function isEpisodicMedia(media: Pick<Media, 'content_type'>): boolean {
    return media.content_type === EPISODIC_CONTENT_TYPE;
}

export function getEpisodeDurationOverride(media: Pick<Media, 'extra_data'>): number | null {
    return getEpisodeDurationFromExtraData(readMediaExtraData(media));
}

export function resolveEpisodeDurationMinutes(media: Pick<Media, 'content_type' | 'extra_data'> | undefined): number | null {
    if (!media || !isEpisodicMedia(media)) return null;
    return getEpisodeDurationOverride(media) ?? DEFAULT_ANIME_EPISODE_DURATION_MINUTES;
}

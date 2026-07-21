import type { Media } from '../types';

const UNKNOWN_CONTENT_TYPE_LABEL = 'Unknown';

export function resolveDisplayContentType(media: Media): string {
    return (media.content_type || UNKNOWN_CONTENT_TYPE_LABEL).trim() || UNKNOWN_CONTENT_TYPE_LABEL;
}
import type { Media } from '../types';

const UNKNOWN_CONTENT_TYPE_LABEL = 'Unknown';

export function resolveDisplayContentType(media: Media): string {
    return (media.content_type || UNKNOWN_CONTENT_TYPE_LABEL).trim() || UNKNOWN_CONTENT_TYPE_LABEL;
}

const CONTENT_TYPE_LABEL_OVERRIDES: Record<string, string> = {
    'WebNovel': 'Web Novel',
    'NonFiction': 'Non-Fiction',
};

export function formatContentTypeLabel(contentType: string): string {
    return CONTENT_TYPE_LABEL_OVERRIDES[contentType] ?? contentType;
}
import { describe, expect, it } from 'vitest';
import { resolveDisplayContentType } from '../../src/media/content_type';
import type { Media } from '../../src/types';

function makeMedia(overrides: Partial<Media> & { id: number }): Media {
    return {
        uid: `uid-${overrides.id}`,
        title: 'Untitled',
        media_type: 'Book',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Manga',
        tracking_status: 'Ongoing',
        ...overrides,
    };
}

describe('resolveDisplayContentType', () => {
    it('should return the trimmed content type unchanged when it is recognized text', () => {
        expect(resolveDisplayContentType(makeMedia({ id: 1, content_type: 'Manga' }))).toBe('Manga');
    });

    it('should return Unknown for an empty content type', () => {
        expect(resolveDisplayContentType(makeMedia({ id: 1, content_type: '' }))).toBe('Unknown');
    });

    it('should return Unknown for a whitespace-only content type', () => {
        expect(resolveDisplayContentType(makeMedia({ id: 1, content_type: '   ' }))).toBe('Unknown');
    });
});
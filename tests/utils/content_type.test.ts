import { describe, expect, it } from 'vitest';
import { formatContentTypeLabel, resolveDisplayContentType } from '../../src/media/content_type';
import type { Media } from '../../src/types';

function makeMedia(overrides: Partial<Media> & { id: number }): Media {
    return {
        uid: `uid-${overrides.id}`,
        title: 'Untitled',
        default_activity_type: 'Book',
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

describe('formatContentTypeLabel', () => {
    it('should prettify WebNovel to Web Novel', () => {
        expect(formatContentTypeLabel('WebNovel')).toBe('Web Novel');
    });

    it('should prettify NonFiction to Non-Fiction', () => {
        expect(formatContentTypeLabel('NonFiction')).toBe('Non-Fiction');
    });

    it('should pass every other content type through unchanged', () => {
        for (const contentType of ['Novel', 'Manga', 'Visual Novel', 'Anime', 'Unknown']) {
            expect(formatContentTypeLabel(contentType)).toBe(contentType);
        }
    });
});
import { describe, expect, it } from 'vitest';

import { getProfileInitials, profilePictureToDataUrl } from '../../src/utils/profile_picture';

describe('profile_picture utils', () => {
    it('builds a data url for stored profile pictures', () => {
        expect(profilePictureToDataUrl({
            mime_type: 'image/png',
            base64_data: 'YWJj',
            byte_size: 3,
            width: 1,
            height: 1,
            updated_at: '2026-03-23T00:00:00Z',
        })).toBe('data:image/png;base64,YWJj');
    });

    it('builds initials from profile names', () => {
        expect(getProfileInitials('Morg')).toBe('MO');
        expect(getProfileInitials('Morg Awr')).toBe('MA');
        expect(getProfileInitials('')).toBe('?');
    });
});

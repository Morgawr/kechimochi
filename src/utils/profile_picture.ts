import type { ProfilePicture } from '../types';

export function profilePictureToDataUrl(profilePicture: ProfilePicture | null): string | null {
    if (!profilePicture?.base64_data || !profilePicture?.mime_type) {
        return null;
    }
    return `data:${profilePicture.mime_type};base64,${profilePicture.base64_data}`;
}

export function getProfileInitials(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '?';

    const parts = trimmed
        .split(/\s+/)
        .map(part => part.trim())
        .filter(Boolean);

    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return trimmed.slice(0, 2).toUpperCase();
}

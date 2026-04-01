/**
 * Shared data-model interfaces — used by both the frontend and the service adapters.
 * Import types from here instead of from api.ts to avoid circular dependencies.
 */

export interface MediaCsvRow {
    "Title": string;
    "Media Type": string;
    "Status": string;
    "Language": string;
    "Description": string;
    "Content Type": string;
    "Extra Data": string;
    "Cover Image (Base64)": string;
}

export interface MediaConflict {
    incoming: MediaCsvRow;
    existing?: Media;
}

export interface Media {
    id?: number;
    uid?: string;
    title: string;
    media_type: string;
    status: string;
    language: string;
    description: string;
    cover_image: string;
    extra_data: string;
    content_type: string;
    tracking_status: string;
}

export interface ActivityLog {
    id?: number;
    media_id: number;
    duration_minutes: number;
    characters: number;
    date: string;
    activity_type?: string;
}

export interface ActivitySummary {
    id: number;
    media_id: number;
    title: string;
    media_type: string;
    duration_minutes: number;
    characters: number;
    date: string;
    language: string;
}

export interface DailyHeatmap {
    date: string;
    total_minutes: number;
    total_characters: number;
}

export type TimelineEventKind =
    | 'started'
    | 'finished'
    | 'paused'
    | 'dropped'
    | 'milestone';

export interface TimelineEvent {
    kind: TimelineEventKind;
    date: string;
    mediaId: number;
    mediaTitle: string;
    coverImage: string;
    activityType: string;
    contentType: string;
    trackingStatus: string;
    milestoneName: string | null;
    firstDate: string;
    lastDate: string;
    totalMinutes: number;
    totalCharacters: number;
    milestoneMinutes: number;
    milestoneCharacters: number;
    sameDayTerminal: boolean;
}

export interface Milestone {
    id?: number;
    media_uid?: string | null;
    media_title: string;
    name: string;
    duration: number;
    characters: number;
    date?: string;
}

export interface ProfilePicture {
    mime_type: string;
    base64_data: string;
    byte_size: number;
    width: number;
    height: number;
    updated_at: string;
}

export interface ReleaseInfo {
    version: string;
    body: string;
    url: string;
    publishedAt: string;
    prerelease: boolean;
}

export interface UpdateState {
    checking: boolean;
    autoCheckEnabled: boolean;
    availableRelease: ReleaseInfo | null;
    installedVersion: string;
    isSupported: boolean;
}

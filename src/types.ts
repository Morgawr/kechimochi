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

export interface Milestone {
    id?: number;
    media_title: string;
    name: string;
    duration: number;
    characters: number;
    date?: string;
}

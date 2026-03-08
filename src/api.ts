import { invoke } from '@tauri-apps/api/core';

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
}

export interface ActivityLog {
  id?: number;
  media_id: number;
  duration_minutes: number;
  date: string;
}

export interface ActivitySummary {
  id: number;
  media_id: number;
  title: string;
  media_type: string;
  duration_minutes: number;
  date: string;
  language: string;
}

export interface DailyHeatmap {
  date: string;
  total_minutes: number;
}

export async function getAllMedia(): Promise<Media[]> {
  return await invoke('get_all_media');
}

export async function addMedia(media: Media): Promise<number> {
  return await invoke('add_media', { media });
}

export async function updateMedia(media: Media): Promise<void> {
  return await invoke('update_media', { media });
}

export async function deleteMedia(id: number): Promise<void> {
  return await invoke('delete_media', { id });
}

export async function addLog(log: ActivityLog): Promise<number> {
  return await invoke('add_log', { log });
}

export async function deleteLog(id: number): Promise<void> {
  return await invoke('delete_log', { id });
}

export async function getLogs(): Promise<ActivitySummary[]> {
  return await invoke('get_logs');
}

export async function getHeatmap(): Promise<DailyHeatmap[]> {
  return await invoke('get_heatmap');
}

export async function importCsv(filePath: string): Promise<number> {
  return await invoke('import_csv', { filePath });
}

export async function switchProfile(profileName: string): Promise<void> {
  return await invoke('switch_profile', { profileName });
}

export async function clearActivities(): Promise<void> {
  return await invoke('clear_activities');
}

export async function wipeEverything(): Promise<void> {
  return await invoke('wipe_everything');
}

export async function deleteProfile(profileName: string): Promise<void> {
  return await invoke('delete_profile', { profileName });
}

export async function listProfiles(): Promise<string[]> {
  return await invoke('list_profiles');
}

export async function exportCsv(filePath: string, startDate?: string, endDate?: string): Promise<number> {
  return await invoke('export_csv', { filePath, startDate, endDate });
}

export async function exportMediaCsv(filePath: string): Promise<number> {
  return await invoke('export_media_csv', { filePath });
}

export async function analyzeMediaCsv(filePath: string): Promise<MediaConflict[]> {
  return await invoke('analyze_media_csv', { filePath });
}

export async function applyMediaImport(records: MediaCsvRow[]): Promise<number> {
  return await invoke('apply_media_import', { records });
}

export async function getLogsForMedia(mediaId: number): Promise<ActivitySummary[]> {
  return await invoke('get_logs_for_media', { mediaId });
}

export async function uploadCoverImage(mediaId: number, path: string): Promise<string> {
  return await invoke('upload_cover_image', { mediaId, path });
}

export async function readFileBytes(path: string): Promise<number[]> {
  return await invoke('read_file_bytes', { path });
}

export async function getUsername(): Promise<string> {
  return await invoke('get_username');
}

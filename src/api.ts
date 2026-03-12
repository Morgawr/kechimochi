import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

declare const __APP_GIT_HASH__: string;

declare global {
  interface Window {
    mockDownloadedImagePath?: string;
  }
}

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
  date: string;
}

export interface Milestone {
  id?: number;
  media_title: string;
  name: string;
  duration: number; // minutes
  date?: string; // YYYY-MM-DD
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

export async function getMilestones(mediaTitle: string): Promise<Milestone[]> {
  return await invoke('get_milestones', { mediaTitle });
}

export async function addMilestone(milestone: Milestone): Promise<number> {
  return await invoke('add_milestone', { milestone });
}

export async function deleteMilestone(id: number): Promise<void> {
  return await invoke('delete_milestone', { id });
}

export async function updateMilestone(milestone: Milestone): Promise<void> {
  return await invoke('update_milestone', { milestone });
}

export async function clearMilestones(mediaTitle: string): Promise<void> {
  return await invoke('delete_milestones_for_media', { mediaTitle });
}

export async function exportMilestonesCsv(filePath: string): Promise<number> {
  return await invoke('export_milestones_csv', { filePath });
}

export async function importMilestonesCsv(filePath: string): Promise<number> {
  return await invoke('import_milestones_csv', { filePath });
}

export async function uploadCoverImage(mediaId: number, path: string): Promise<string> {
  return await invoke('upload_cover_image', { mediaId, path });
}

export async function readFileBytes(path: string): Promise<number[]> {
  return await invoke('read_file_bytes', { path });
}

export async function downloadAndSaveImage(mediaId: number, url: string): Promise<string> {
  if (window.mockDownloadedImagePath) {
    return window.mockDownloadedImagePath;
  }
  return await invoke('download_and_save_image', { mediaId, url });
}

export async function getUsername(): Promise<string> {
  return await invoke('get_username');
}

export async function getSetting(key: string): Promise<string | null> {
  return await invoke('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return await invoke('set_setting', { key, value });
}
/*
* Retrieves the version as defined in the manifest (or as dynamically set)
*/
export async function getAppVersion(): Promise<string> {
    const baseVersion = await getVersion();
    // For in-development releases, we ignore the 0.x.x version and show the git hash
    if (baseVersion.startsWith('0.')) {
        return `0.0.0-dev.${__APP_GIT_HASH__}`;
    }
    return baseVersion;
}

const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

// Universal invoke – works over Tauri IPC or HTTP POST.
// Adding a new command only requires a one-liner export below.
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(command, args);
  }
  const res = await fetch(`/api/invoke/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text);
}

// ─── Interfaces ──────────────────────────────────────────────

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

// ─── Commands (work identically in both Tauri and web) ───────
// To add a new command, just add one line here and a match arm in routes.rs.

export const getAllMedia = () => invoke<Media[]>('get_all_media');
export const addMedia = (media: Media) => invoke<number>('add_media', { media });
export const updateMedia = (media: Media) => invoke<void>('update_media', { media });
export const deleteMedia = (id: number) => invoke<void>('delete_media', { id });
export const addLog = (log: ActivityLog) => invoke<number>('add_log', { log });
export const deleteLog = (id: number) => invoke<void>('delete_log', { id });
export const getLogs = () => invoke<ActivitySummary[]>('get_logs');
export const getHeatmap = () => invoke<DailyHeatmap[]>('get_heatmap');
export const getLogsForMedia = (mediaId: number) => invoke<ActivitySummary[]>('get_logs_for_media', { mediaId });
export const switchProfile = (profileName: string) => invoke<void>('switch_profile', { profileName });
export const wipeProfile = (profileName: string) => invoke<void>('wipe_profile', { profileName });
export const deleteProfile = (profileName: string) => invoke<void>('delete_profile', { profileName });
export const listProfiles = () => invoke<string[]>('list_profiles');
export const fetchExternalJson = (url: string, method: string, body?: string) => invoke<string>('fetch_external_json', { url, method, body });
export const downloadAndSaveImage = (mediaId: number, url: string) => invoke<string>('download_and_save_image', { mediaId, url });

// ─── File operations (require platform-specific handling) ────
// These few functions need different transports because they deal with
// file uploads (multipart), binary downloads, or Tauri-only filesystem access.

export async function importCsv(filePathOrFile: string | File): Promise<number> {
  if (isTauri()) return invoke('import_csv', { filePath: filePathOrFile as string });
  const formData = new FormData();
  formData.append('file', filePathOrFile as File);
  const res = await fetch('/api/import/csv', { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportCsv(filePathOrNull: string | null, startDate?: string, endDate?: string): Promise<number> {
  if (isTauri()) return invoke('export_csv', { filePath: filePathOrNull, startDate, endDate });
  const params = new URLSearchParams();
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const res = await fetch(`/api/export/csv?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kechimochi_export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  return 0;
}

export async function uploadCoverImage(mediaId: number, pathOrFile: string | File): Promise<string> {
  if (isTauri()) return invoke('upload_cover_image', { mediaId, path: pathOrFile as string });
  const formData = new FormData();
  formData.append('file', pathOrFile as File);
  const res = await fetch(`/api/covers/${mediaId}/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function readFileBytes(path: string): Promise<number[]> {
  if (isTauri()) return invoke('read_file_bytes', { path });
  throw new Error('readFileBytes is not available in web mode');
}

export function getCoverImageUrl(mediaId: number): string {
  return `/api/covers/${mediaId}`;
}

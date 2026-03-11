/// <reference types="vite/client" />
/**
 * Web adapter — routes all operations to the Rust HTTP server via fetch().
 * This file must NOT import from @tauri-apps/*.
 *
 * The server base URL is set at build time via VITE_API_BASE_URL, defaulting
 * to the same origin (so the Vite dev proxy or a bundled server both work).
 */
import type { AppServices } from './types';
import type { Media, ActivityLog, ActivitySummary, DailyHeatmap, MediaCsvRow, MediaConflict } from '../types';

const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string) || '';

function apiUrl(path: string): string {
    return `${API_BASE}/api${path}`;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
    if (!res.ok) throw new Error(await res.text());

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const body = await res.text();
        const hint = body.startsWith('<!DOCTYPE') || body.startsWith('<html')
            ? 'Received HTML instead of JSON. Start the Rust web server and configure Vite to proxy /api to it.'
            : `Unexpected response type: ${contentType || 'unknown'}`;
        throw new Error(hint);
    }

    return res.json();
}

async function get<T>(path: string): Promise<T> {
    const res = await fetch(apiUrl(path));
    return parseJsonResponse<T>(res);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseJsonResponse<T>(res);
}

async function put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(apiUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return parseJsonResponse<T>(res);
}

async function del<T>(path: string): Promise<T> {
    const res = await fetch(apiUrl(path), { method: 'DELETE' });
    return parseJsonResponse<T>(res);
}

function pickFile(accept: string): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        // 'cancel' fires in modern browsers; fall back to focusing the window
        input.addEventListener('cancel', () => resolve(null));
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export class WebServices implements AppServices {
    // ── Data operations ───────────────────────────────────────────────────────
    getAllMedia():                           Promise<Media[]>          { return get('/media'); }
    addMedia(media: Media):                  Promise<number>           { return post('/media', media); }
    updateMedia(media: Media):               Promise<void>             { return put(`/media/${media.id}`, media); }
    deleteMedia(id: number):                 Promise<void>             { return del(`/media/${id}`); }

    addLog(log: ActivityLog):               Promise<number>           { return post('/logs', log); }
    deleteLog(id: number):                  Promise<void>             { return del(`/logs/${id}`); }
    getLogs():                              Promise<ActivitySummary[]> { return get('/logs'); }
    getHeatmap():                           Promise<DailyHeatmap[]>   { return get('/logs/heatmap'); }
    getLogsForMedia(mediaId: number):       Promise<ActivitySummary[]> { return get(`/logs/media/${mediaId}`); }

    switchProfile(profileName: string):      Promise<void>             { return post('/profiles/switch', { profile_name: profileName }); }
    clearActivities():                       Promise<void>             { return post('/activities/clear'); }
    wipeEverything():                        Promise<void>             { return post('/reset'); }
    deleteProfile(profileName: string):      Promise<void>             { return del(`/profiles/${encodeURIComponent(profileName)}`); }
    listProfiles():                          Promise<string[]>          { return get('/profiles'); }

    getSetting(key: string):                 Promise<string | null>    { return get(`/settings/${encodeURIComponent(key)}`); }
    setSetting(key: string, value: string):  Promise<void>             { return put(`/settings/${encodeURIComponent(key)}`, { value }); }

    getUsername():                           Promise<string>            { return get('/username'); }
    getAppVersion():                         Promise<string>            { return get('/version'); }

    // ── File-based operations ─────────────────────────────────────────────────
    async pickAndImportActivities(): Promise<number | null> {
        const file = await pickFile('.csv');
        if (!file) return null;
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(apiUrl('/import/activities'), { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        const { count } = await res.json();
        return count as number;
    }

    async exportActivities(startDate?: string, endDate?: string): Promise<number | null> {
        const params = new URLSearchParams();
        if (startDate) params.set('start', startDate);
        if (endDate) params.set('end', endDate);
        const res = await fetch(apiUrl(`/export/activities?${params}`));
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        triggerDownload(blob, 'kechimochi_activities.csv');
        return parseInt(res.headers.get('X-Row-Count') ?? '0', 10);
    }

    async analyzeMediaCsvFromPick(): Promise<MediaConflict[] | null> {
        const file = await pickFile('.csv');
        if (!file) return null;
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(apiUrl('/import/media/analyze'), { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    async exportMediaLibrary(_profileName: string): Promise<number | null> {
        const res = await fetch(apiUrl('/export/media'));
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        triggerDownload(blob, 'kechimochi_media_library.csv');
        return parseInt(res.headers.get('X-Row-Count') ?? '0', 10);
    }

    applyMediaImport(records: MediaCsvRow[]): Promise<number> {
        return post('/import/media/apply', records);
    }

    // ── Cover image operations ────────────────────────────────────────────────
    async pickAndUploadCover(mediaId: number): Promise<string | null> {
        const file = await pickFile('image/png,image/jpeg,image/gif,image/webp');
        if (!file) return null;
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(apiUrl(`/covers/${mediaId}`), { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        const { path } = await res.json();
        return path as string;
    }

    async downloadAndSaveImage(mediaId: number, url: string): Promise<string> {
        const res = await post<{ path: string }>('/covers/download', { media_id: mediaId, url });
        return res.path;
    }

    async loadCoverImage(coverRef: string): Promise<string | null> {
        if (!coverRef || coverRef.trim() === '') return null;
        // Extract filename from the absolute path stored in the DB
        const filename = coverRef.split(/[\\/]/).pop();
        if (!filename) return null;
        return `${API_BASE}/api/covers/file/${encodeURIComponent(filename)}`;
    }

    // ── External network ──────────────────────────────────────────────────────
    async fetchExternalJson(url: string, method: string, body?: string, headers?: Record<string, string>): Promise<string> {
        const res = await post<{ data: string }>('/fetch/json', { url, method, body, headers });
        return res.data;
    }

    async fetchRemoteBytes(url: string): Promise<number[]> {
        const res = await post<{ bytes: number[] }>('/fetch/bytes', { url });
        return res.bytes;
    }

    // ── Window management (noop) ──────────────────────────────────────────────
    minimizeWindow(): void {}
    maximizeWindow(): void {}
    closeWindow():    void {}

    isDesktop(): boolean { return false; }
}

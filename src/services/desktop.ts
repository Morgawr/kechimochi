/**
 * Desktop adapter — wraps Tauri invoke and native plugins.
 * This is the ONLY file that may import from @tauri-apps/*.
 */
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

import type { AppServices } from './types';
import type { Media, ActivityLog, ActivitySummary, DailyHeatmap, MediaCsvRow, MediaConflict, Milestone } from '../types';

declare const __APP_GIT_HASH__: string;

export class DesktopServices implements AppServices {
    private win: ReturnType<typeof getCurrentWindow> | null = null;

    private getWin() {
        if (!this.win) this.win = getCurrentWindow();
        return this.win;
    }

    private getMockValue(key: 'mockOpenPath' | 'mockSavePath'): string | null {
        const globalCandidate = (globalThis as unknown as Record<string, unknown>)[key];
        if (typeof globalCandidate === 'string' && globalCandidate.length > 0) return globalCandidate;
        return null;
    }

    private getMockOpenPath(): string | null {
        return this.getMockValue('mockOpenPath');
    }

    private getMockSavePath(): string | null {
        return this.getMockValue('mockSavePath');
    }

    // ── Data operations ───────────────────────────────────────────────────────
    getAllMedia():                           Promise<Media[]>         { return invoke('get_all_media'); }
    addMedia(media: Media):                  Promise<number>          { return invoke('add_media', { media }); }
    updateMedia(media: Media):               Promise<void>            { return invoke('update_media', { media }); }
    deleteMedia(id: number):                 Promise<void>            { return invoke('delete_media', { id }); }

    addLog(log: ActivityLog):               Promise<number>          { return invoke('add_log', { log }); }
    updateLog(log: ActivityLog):            Promise<void>            { return invoke('update_log', { log }); }
    deleteLog(id: number):                  Promise<void>            { return invoke('delete_log', { id }); }
    getLogs():                              Promise<ActivitySummary[]>{ return invoke('get_logs'); }
    getHeatmap():                           Promise<DailyHeatmap[]>  { return invoke('get_heatmap'); }
    getLogsForMedia(mediaId: number):       Promise<ActivitySummary[]>{ return invoke('get_logs_for_media', { mediaId }); }

    initializeUserDb(fallbackUsername?: string):Promise<void>            { return invoke('initialize_user_db', { fallbackUsername }); }
    clearActivities():                       Promise<void>            { return invoke('clear_activities'); }
    wipeEverything():                        Promise<void>            { return invoke('wipe_everything'); }

    getSetting(key: string):                 Promise<string | null>   { return invoke('get_setting', { key }); }
    setSetting(key: string, value: string):  Promise<void>            { return invoke('set_setting', { key, value }); }

    getUsername():                           Promise<string>          { return invoke('get_username'); }

    async getAppVersion(): Promise<string> {
        const base = await getVersion();
        const hash = (__APP_GIT_HASH__ as string | undefined)
            ?? ((globalThis as Record<string, unknown>).__APP_GIT_HASH__ as string)
            ?? 'dev';
        return base.startsWith('0.') ? `0.0.0-dev.${hash}` : base;
    }

    // ── File-based operations ─────────────────────────────────────────────────
    async pickAndImportActivities(): Promise<number | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('import_csv', { filePath: selected });
    }

    async exportActivities(startDate?: string, endDate?: string): Promise<number | null> {
        const savePath = this.getMockSavePath() ?? await tauriSave({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
        if (!savePath) return null;
        return invoke('export_csv', { filePath: savePath, startDate, endDate });
    }

    async analyzeMediaCsvFromPick(): Promise<MediaConflict[] | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('analyze_media_csv', { filePath: selected });
    }

    async exportMediaLibrary(_profileName: string): Promise<number | null> {
        const savePath = this.getMockSavePath() ?? await tauriSave({
            filters: [{ name: 'CSV', extensions: ['csv'] }],
            defaultPath: `kechimochi_media_library.csv`,
        });
        if (!savePath) return null;
        return invoke('export_media_csv', { filePath: savePath });
    }

    applyMediaImport(records: MediaCsvRow[]): Promise<number> {
        return invoke('apply_media_import', { records });
    }

    // ── Full Backup operations ────────────────────────────────────────────────
    async pickAndExportFullBackup(localStorageData: string, version: string): Promise<void | null> {
        const savePath = this.getMockSavePath() ?? await tauriSave({
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
            defaultPath: `kechimochi_full_backup.zip`,
        });
        if (!savePath) return null;
        return invoke('export_full_backup', { filePath: savePath, localStorage: localStorageData, version });
    }

    async pickAndImportFullBackup(): Promise<string | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({ multiple: false, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('import_full_backup', { filePath: selected });
    }

    // ── Milestone operations ─────────────────────────────────────────────────
    getMilestones(mediaTitle: string): Promise<Milestone[]> {
        return invoke('get_milestones', { mediaTitle });
    }

    addMilestone(milestone: Milestone): Promise<number> {
        return invoke('add_milestone', { milestone });
    }

    updateMilestone(milestone: Milestone): Promise<void> {
        return invoke('update_milestone', { milestone });
    }

    deleteMilestone(id: number): Promise<void> {
        return invoke('delete_milestone', { id });
    }

    clearMilestones(mediaTitle: string): Promise<void> {
        return invoke('delete_milestones_for_media', { mediaTitle });
    }

    exportMilestonesCsv(filePath: string): Promise<number> {
        if (filePath && filePath.trim().length > 0) {
            return invoke('export_milestones_csv', { filePath });
        }
        return Promise.resolve(this.getMockSavePath()).then(mockPath => {
            if (mockPath) return mockPath;
            return tauriSave({
                filters: [{ name: 'CSV', extensions: ['csv'] }],
                defaultPath: 'kechimochi_milestones.csv',
            });
        }).then(savePath => {
            if (!savePath) return 0;
            return invoke<number>('export_milestones_csv', { filePath: savePath });
        });
    }

    importMilestonesCsv(filePath: string): Promise<number> {
        if (filePath && filePath.trim().length > 0) {
            return invoke('import_milestones_csv', { filePath });
        }
        return Promise.resolve(this.getMockOpenPath()).then(mockPath => {
            if (mockPath) return mockPath;
            return tauriOpen({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
        }).then(selected => {
            if (!selected || typeof selected !== 'string') return 0;
            return invoke<number>('import_milestones_csv', { filePath: selected });
        });
    }

    // ── Cover image operations ────────────────────────────────────────────────
    async pickAndUploadCover(mediaId: number): Promise<string | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('upload_cover_image', { mediaId, path: selected });
    }

    downloadAndSaveImage(mediaId: number, url: string): Promise<string> {
        return invoke('download_and_save_image', { mediaId, url });
    }

    async loadCoverImage(coverRef: string): Promise<string | null> {
        if (!coverRef || coverRef.trim() === '') return null;
        try {
            const bytes = await invoke<number[]>('read_file_bytes', { path: coverRef });
            const blob = new Blob([new Uint8Array(bytes)]);
            return URL.createObjectURL(blob);
        } catch {
            return null;
        }
    }

    // ── External network ──────────────────────────────────────────────────────
    fetchExternalJson(url: string, method: string, body?: string, headers?: Record<string, string>): Promise<string> {
        return invoke('fetch_external_json', { url, method, body, headers });
    }

    fetchRemoteBytes(url: string): Promise<number[]> {
        return invoke('fetch_remote_bytes', { url });
    }

    // ── Window management ─────────────────────────────────────────────────────
    minimizeWindow(): void { this.getWin().minimize(); }
    maximizeWindow(): void { this.getWin().toggleMaximize(); }
    closeWindow():    void { this.getWin().close(); }

    isDesktop(): boolean { return true; }
}

/**
 * Desktop adapter — wraps Tauri invoke and native plugins.
 * This is the ONLY file that may import from @tauri-apps/*.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

import type { AppServices, ImportedThemePackFile, ThemePackExportSelection, ThemePackImportSelection } from './types';
import type {
    Media,
    ActivityLog,
    ActivitySummary,
    DailyHeatmap,
    TimelineEvent,
    MediaCsvRow,
    MediaConflict,
    Milestone,
    ProfilePicture,
    GoogleDriveAuthSession,
    RemoteSyncProfileSummary,
    SyncActionResult,
    SyncAttachPreview,
    SyncConflict,
    SyncConflictResolution,
    SyncProgressUpdate,
    SyncStatus,
    ManagedThemePackSummary,
} from '../types';
import { getBuildVersion } from '../app_version';
import { getMockExternalJsonResponse } from './external_mocks';

const THEME_ASSET_MIME_TYPES: Record<string, string> = {
    css: 'text/css;charset=utf-8',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    json: 'application/json;charset=utf-8',
    mp4: 'video/mp4',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
};

const BACKSLASH = '\\';

function normalizeThemeAssetPath(assetPath: string): string {
    return assetPath.trim().replaceAll(BACKSLASH, '/');
}

function getThemeAssetMimeType(assetPath: string): string {
    const normalized = normalizeThemeAssetPath(assetPath);
    const extension = normalized.split('.').pop()?.toLowerCase() || '';
    return THEME_ASSET_MIME_TYPES[extension] || 'application/octet-stream';
}

export class DesktopServices implements AppServices {
    private win: ReturnType<typeof getCurrentWindow> | null = null;
    private readonly themeAssetUrls = new Map<string, string>();

    private isAndroidRuntime(): boolean {
        const ua = navigator.userAgent || '';
        return /\bAndroid\b/i.test(ua);
    }

    private supportsDesktopWindowControls(): boolean {
        return !this.isAndroidRuntime();
    }

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

    private revokeThemeAssetUrls(themeId: string): void {
        const prefix = `${themeId}::`;
        for (const [cacheKey, objectUrl] of this.themeAssetUrls.entries()) {
            if (!cacheKey.startsWith(prefix)) {
                continue;
            }

            URL.revokeObjectURL(objectUrl);
            this.themeAssetUrls.delete(cacheKey);
        }
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
    getTimelineEvents():                    Promise<TimelineEvent[]> { return invoke('get_timeline_events'); }

    initializeUserDb(fallbackUsername?: string):Promise<void>            { return invoke('initialize_user_db', { fallbackUsername }); }
    clearActivities():                       Promise<void>            { return invoke('clear_activities'); }
    wipeEverything():                        Promise<void>            { return invoke('wipe_everything'); }

    getSetting(key: string):                 Promise<string | null>   { return invoke('get_setting', { key }); }
    setSetting(key: string, value: string):  Promise<void>            { return invoke('set_setting', { key, value }); }

    getUsername():                           Promise<string>          { return invoke('get_username'); }
    getStartupError():                       Promise<string | null>   { return invoke('get_startup_error'); }
    shouldSkipLegacyLocalProfileMigration(): Promise<boolean>        { return invoke('should_skip_legacy_local_profile_migration'); }
    getProfilePicture():                     Promise<ProfilePicture | null> { return invoke('get_profile_picture'); }
    deleteProfilePicture():                  Promise<void>            { return invoke('delete_profile_picture'); }
    getSyncStatus():                         Promise<SyncStatus>      { return invoke('get_sync_status'); }
    connectGoogleDrive():                    Promise<GoogleDriveAuthSession> { return invoke('connect_google_drive'); }
    disconnectGoogleDrive():                 Promise<void>            { return invoke('disconnect_google_drive'); }
    listRemoteSyncProfiles():                Promise<RemoteSyncProfileSummary[]> { return invoke('list_remote_sync_profiles'); }
    previewAttachRemoteSyncProfile(profileId: string): Promise<SyncAttachPreview> {
        return invoke('preview_attach_remote_sync_profile', { profileId });
    }
    createRemoteSyncProfile():               Promise<SyncActionResult> { return invoke('create_remote_sync_profile'); }
    attachRemoteSyncProfile(profileId: string): Promise<SyncActionResult> {
        return invoke('attach_remote_sync_profile', { profileId });
    }
    runSync():                              Promise<SyncActionResult> { return invoke('run_sync'); }
    replaceLocalFromRemote():               Promise<SyncActionResult> { return invoke('replace_local_from_remote'); }
    forcePublishLocalAsRemote():            Promise<SyncActionResult> { return invoke('force_publish_local_as_remote'); }
    getSyncConflicts():                      Promise<SyncConflict[]>   { return invoke('get_sync_conflicts'); }
    resolveSyncConflict(conflictIndex: number, resolution: SyncConflictResolution): Promise<SyncActionResult> {
        return invoke('resolve_sync_conflict', { conflictIndex, resolution });
    }
    subscribeSyncProgress(listener: (update: SyncProgressUpdate) => void): Promise<() => void> {
        return listen<SyncProgressUpdate>('sync-progress', (event) => {
            listener(event.payload);
        });
    }

    clearSyncBackups():                      Promise<void>            { return invoke('clear_sync_backups'); }

    async getAppVersion(): Promise<string> {
        return getBuildVersion();
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
    async pickAndExportFullBackup(localStorageData: string, version: string): Promise<boolean> {
        const savePath = this.getMockSavePath() ?? await tauriSave({
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
            defaultPath: `kechimochi_full_backup.zip`,
        });
        if (!savePath) return false;
        await invoke('export_full_backup', { filePath: savePath, localStorage: localStorageData, version });
        return true;
    }

    async pickAndImportFullBackup(): Promise<string | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({ multiple: false, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('import_full_backup', { filePath: selected });
    }

    async pickThemePackImportSelection(): Promise<ThemePackImportSelection | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({ multiple: false, filters: [{ name: 'Theme Pack', extensions: ['json', 'zip'] }] });
        if (!selected || typeof selected !== 'string') return null;
        return { kind: 'desktop', path: selected };
    }

    async importThemePackFromSelection(selection: ThemePackImportSelection): Promise<ImportedThemePackFile> {
        if (selection.kind !== 'desktop') {
            throw new Error('Theme pack import selection is not valid for the desktop runtime.');
        }

        const imported = await invoke<ImportedThemePackFile>('import_theme_pack', { path: selection.path });
        this.revokeThemeAssetUrls(imported.themeId);
        return imported;
    }

    listManagedThemePackSummaries(): Promise<ManagedThemePackSummary[]> {
        return invoke('list_theme_pack_summaries');
    }

    getManagedThemePack(themeId: string): Promise<string | null> {
        return invoke('read_theme_pack', { themeId });
    }

    async resolveManagedThemeAssetUrl(themeId: string, assetPath: string): Promise<string | null> {
        const normalized = normalizeThemeAssetPath(assetPath);
        if (!normalized) return null;

        const cacheKey = `${themeId}::${normalized}`;
        const cached = this.themeAssetUrls.get(cacheKey);
        if (cached) {
            return cached;
        }

        const bytes = await invoke<number[] | null>('read_theme_pack_asset_bytes', { themeId, assetPath: normalized });
        if (!bytes || bytes.length === 0) {
            return null;
        }

        const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: getThemeAssetMimeType(normalized) }));
        this.themeAssetUrls.set(cacheKey, objectUrl);
        return objectUrl;
    }

    listManagedThemePacks(): Promise<string[]> {
        return invoke('list_theme_packs');
    }

    saveManagedThemePack(themeId: string, content: string, preferredFileName?: string | null): Promise<void> {
        this.revokeThemeAssetUrls(themeId);
        return invoke('save_theme_pack', { themeId, content, preferredFileName });
    }

    deleteManagedThemePack(themeId: string): Promise<void> {
        this.revokeThemeAssetUrls(themeId);
        return invoke('delete_theme_pack', { themeId });
    }

    async pickThemePackExportSelection(defaultFileName: string): Promise<ThemePackExportSelection | null> {
        const exportIsArchive = defaultFileName.toLowerCase().endsWith('.zip');
        const savePath = this.getMockSavePath() ?? await tauriSave({
            filters: [exportIsArchive
                ? { name: 'Theme Pack Archive', extensions: ['zip'] }
                : { name: 'Theme Pack JSON', extensions: ['json'] }],
            defaultPath: defaultFileName,
        });
        if (!savePath) return null;
        return { kind: 'desktop', filePath: savePath };
    }

    async exportThemePackToSelection(themeId: string, content: string, selection: ThemePackExportSelection): Promise<boolean> {
        if (selection.kind !== 'desktop') {
            throw new Error('Theme pack export selection is not valid for the desktop runtime.');
        }

        await invoke('export_theme_pack', { themeId, filePath: selection.filePath, content });
        return true;
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

    // ── Profile picture operations ────────────────────────────────────────────
    async pickAndUploadProfilePicture(): Promise<ProfilePicture | null> {
        const selected = this.getMockOpenPath() ?? await tauriOpen({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        });
        if (!selected || typeof selected !== 'string') return null;
        return invoke('upload_profile_picture', { path: selected });
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
        const mocked = getMockExternalJsonResponse(url);
        if (mocked !== null) {
            return Promise.resolve(mocked);
        }
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
    supportsWindowControls(): boolean { return this.supportsDesktopWindowControls(); }
}

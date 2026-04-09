import type {
    Media,
    ActivityLog,
    ActivitySummary,
    GoogleDriveAuthSession,
    DailyHeatmap,
    TimelineEvent,
    MediaCsvRow,
    MediaConflict,
    Milestone,
    ProfilePicture,
    RemoteSyncProfileSummary,
    SyncActionResult,
    SyncAttachPreview,
    SyncConflict,
    SyncConflictResolution,
    SyncProgressUpdate,
    SyncStatus,
    ManagedThemePackSummary,
} from '../types';

export type {
    Media,
    ActivityLog,
    ActivitySummary,
    GoogleDriveAuthSession,
    DailyHeatmap,
    TimelineEvent,
    MediaCsvRow,
    MediaConflict,
    Milestone,
    ProfilePicture,
    RemoteSyncProfileSummary,
    SyncActionResult,
    SyncAttachPreview,
    SyncConflict,
    SyncConflictResolution,
    SyncProgressUpdate,
    SyncStatus,
    ManagedThemePackSummary,
} from '../types';

export interface ImportedThemePackFile {
    themeId: string;
    themeName: string;
    content: string;
    fileName: string | null;
}

export type ThemePackImportSelection =
    | { kind: 'desktop'; path: string }
    | { kind: 'web'; file: File };

export type ThemePackExportSelection =
    | { kind: 'desktop'; filePath: string }
    | { kind: 'web'; fileName: string };

/**
 * The single capability contract every part of the application uses.
 *
 * Concrete implementations live in:
 *   - services/desktop.ts  (Tauri invoke / native plugins)
 *   - services/web.ts      (HTTP fetch to the Rust web server)
 *
 * Future feature code should import and call this interface only.
 * Nothing outside the adapter files should import from @tauri-apps/* directly.
 */
export interface AppServices {
    // ── Data operations ──────────────────────────────────────────────────────
    getAllMedia(): Promise<Media[]>;
    addMedia(media: Media): Promise<number>;
    updateMedia(media: Media): Promise<void>;
    deleteMedia(id: number): Promise<void>;

    addLog(log: ActivityLog): Promise<number>;
    updateLog(log: ActivityLog): Promise<void>;
    deleteLog(id: number): Promise<void>;
    getLogs(): Promise<ActivitySummary[]>;
    getHeatmap(): Promise<DailyHeatmap[]>;
    getLogsForMedia(mediaId: number): Promise<ActivitySummary[]>;
    getTimelineEvents(): Promise<TimelineEvent[]>;

    initializeUserDb(fallbackUsername?: string): Promise<void>;
    clearActivities(): Promise<void>;
    wipeEverything(): Promise<void>;

    getSetting(key: string): Promise<string | null>;
    setSetting(key: string, value: string): Promise<void>;

    getUsername(): Promise<string>;
    getAppVersion(): Promise<string>;
    getStartupError(): Promise<string | null>;
    shouldSkipLegacyLocalProfileMigration(): Promise<boolean>;
    getProfilePicture(): Promise<ProfilePicture | null>;
    deleteProfilePicture(): Promise<void>;

    // ── Cloud sync operations ────────────────────────────────────────────────
    getSyncStatus(): Promise<SyncStatus>;
    connectGoogleDrive(): Promise<GoogleDriveAuthSession>;
    disconnectGoogleDrive(): Promise<void>;
    listRemoteSyncProfiles(): Promise<RemoteSyncProfileSummary[]>;
    previewAttachRemoteSyncProfile(profileId: string): Promise<SyncAttachPreview>;
    createRemoteSyncProfile(): Promise<SyncActionResult>;
    attachRemoteSyncProfile(profileId: string): Promise<SyncActionResult>;
    runSync(): Promise<SyncActionResult>;
    replaceLocalFromRemote(): Promise<SyncActionResult>;
    forcePublishLocalAsRemote(): Promise<SyncActionResult>;
    getSyncConflicts(): Promise<SyncConflict[]>;
    resolveSyncConflict(conflictIndex: number, resolution: SyncConflictResolution): Promise<SyncActionResult>;
    subscribeSyncProgress(listener: (update: SyncProgressUpdate) => void): Promise<() => void>;
    clearSyncBackups(): Promise<void>;

    // ── File-based operations (no filesystem paths exposed to callers) ────────
    /** Opens a file picker and imports the selected activities CSV. */
    pickAndImportActivities(): Promise<number | null>;
    /** Picks a destination (or triggers browser download) and exports activity logs. */
    exportActivities(startDate?: string, endDate?: string): Promise<number | null>;
    /** Opens a file picker and analyses the selected media library CSV for conflicts. */
    analyzeMediaCsvFromPick(): Promise<MediaConflict[] | null>;
    /** Picks a destination (or triggers browser download) and exports the media library. */
    exportMediaLibrary(profileName: string): Promise<number | null>;
    /** Applies the pre-approved list of media rows returned by analyzeMediaCsvFromPick. */
    applyMediaImport(records: MediaCsvRow[]): Promise<number>;

    // ── Full Backup operations ──────────────────────────────────────────────
    pickAndExportFullBackup(localStorageData: string, version: string): Promise<boolean>;
    pickAndImportFullBackup(): Promise<string | null>;
    pickThemePackImportSelection(): Promise<ThemePackImportSelection | null>;
    importThemePackFromSelection(selection: ThemePackImportSelection): Promise<ImportedThemePackFile>;
    listManagedThemePackSummaries(): Promise<ManagedThemePackSummary[]>;
    getManagedThemePack(themeId: string): Promise<string | null>;
    resolveManagedThemeAssetUrl(themeId: string, assetPath: string): Promise<string | null>;
    listManagedThemePacks(): Promise<string[]>;
    saveManagedThemePack(themeId: string, content: string, preferredFileName?: string | null): Promise<void>;
    deleteManagedThemePack(themeId: string): Promise<void>;
    pickThemePackExportSelection(defaultFileName: string): Promise<ThemePackExportSelection | null>;
    exportThemePackToSelection(themeId: string, content: string, selection: ThemePackExportSelection): Promise<boolean>;

    // ── Milestone operations ────────────────────────────────────────────────
    getMilestones(mediaTitle: string): Promise<Milestone[]>;
    addMilestone(milestone: Milestone): Promise<number>;
    updateMilestone(milestone: Milestone): Promise<void>;
    deleteMilestone(id: number): Promise<void>;
    clearMilestones(mediaTitle: string): Promise<void>;
    exportMilestonesCsv(filePath: string): Promise<number>;
    importMilestonesCsv(filePath: string): Promise<number>;

    // ── Profile picture operations ────────────────────────────────────────────
    /** Opens a file picker, validates/uploads the image, and returns the stored profile picture. */
    pickAndUploadProfilePicture(): Promise<ProfilePicture | null>;

    // ── Cover image operations ────────────────────────────────────────────────
    /** Opens a file picker, uploads the image, and returns the stored reference. */
    pickAndUploadCover(mediaId: number): Promise<string | null>;
    /** Downloads a remote image, stores it, and returns the stored reference. */
    downloadAndSaveImage(mediaId: number, url: string): Promise<string>;
    /**
     * Resolves a stored cover reference (filesystem path or server-relative key)
     * to a displayable URL or data-URI.
     */
    loadCoverImage(coverRef: string): Promise<string | null>;

    // ── External network (proxied through backend in web mode) ───────────────
    fetchExternalJson(
        url: string,
        method: string,
        body?: string,
        headers?: Record<string, string>,
    ): Promise<string>;
    fetchRemoteBytes(url: string): Promise<number[]>;

    // ── Window management (graceful noop in web mode) ─────────────────────────
    minimizeWindow(): void;
    maximizeWindow(): void;
    closeWindow(): void;

    /** True when running inside the Tauri desktop shell. */
    isDesktop(): boolean;
    /** True when the runtime exposes desktop-style window chrome controls. */
    supportsWindowControls(): boolean;
}

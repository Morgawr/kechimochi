/**
 * Public API surface for all application data and platform operations.
 *
 * All primary functions delegate to the active service adapter (desktop or web).
 * Legacy file-path-based exports are kept for desktop backwards compatibility.
 */
import { getServices } from './services';

export type {
  Media,
  ActivityLog,
  ActivitySummary,
  DailyHeatmap,
  GoogleDriveAuthSession,
  TimelineEventKind,
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
} from './types';

import type {
  Media,
  ActivityLog,
  ActivitySummary,
  DailyHeatmap,
  GoogleDriveAuthSession,
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
} from './types';

declare global {
  interface Window {
    mockDownloadedImagePath?: string;
  }
}

async function desktopInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!getServices().isDesktop()) {
    throw new Error(`${command} is not supported in web mode.`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export function getAllMedia(): Promise<Media[]> { return getServices().getAllMedia(); }
export function addMedia(media: Media): Promise<number> { return getServices().addMedia(media); }
export function updateMedia(media: Media): Promise<void> { return getServices().updateMedia(media); }
export function deleteMedia(id: number): Promise<void> { return getServices().deleteMedia(id); }

export function addLog(log: ActivityLog): Promise<number> { return getServices().addLog(log); }
export function updateLog(log: ActivityLog): Promise<void> { return getServices().updateLog(log); }
export function deleteLog(id: number): Promise<void> { return getServices().deleteLog(id); }
export function getLogs(): Promise<ActivitySummary[]> { return getServices().getLogs(); }
export function getHeatmap(): Promise<DailyHeatmap[]> { return getServices().getHeatmap(); }
export function getLogsForMedia(mediaId: number): Promise<ActivitySummary[]> { return getServices().getLogsForMedia(mediaId); }
export function getTimelineEvents(): Promise<TimelineEvent[]> { return getServices().getTimelineEvents(); }

export function initializeUserDb(fallbackUsername?: string): Promise<void> { return getServices().initializeUserDb(fallbackUsername); }
export function clearActivities(): Promise<void> { return getServices().clearActivities(); }
export function wipeEverything(): Promise<void> { return getServices().wipeEverything(); }

export function getSetting(key: string): Promise<string | null> { return getServices().getSetting(key); }
export function setSetting(key: string, value: string): Promise<void> { return getServices().setSetting(key, value); }

export function getUsername(): Promise<string> { return getServices().getUsername(); }
export function getAppVersion(): Promise<string> { return getServices().getAppVersion(); }
export function getStartupError(): Promise<string | null> { return getServices().getStartupError(); }
export function shouldSkipLegacyLocalProfileMigration(): Promise<boolean> {
  return getServices().shouldSkipLegacyLocalProfileMigration();
}
export function getProfilePicture(): Promise<ProfilePicture | null> { return getServices().getProfilePicture(); }
export function deleteProfilePicture(): Promise<void> { return getServices().deleteProfilePicture(); }
export function uploadProfilePicture(): Promise<ProfilePicture | null> { return getServices().pickAndUploadProfilePicture(); }
export function getSyncStatus(): Promise<SyncStatus> { return getServices().getSyncStatus(); }
export function connectGoogleDrive(): Promise<GoogleDriveAuthSession> { return getServices().connectGoogleDrive(); }
export function disconnectGoogleDrive(): Promise<void> { return getServices().disconnectGoogleDrive(); }
export function listRemoteSyncProfiles(): Promise<RemoteSyncProfileSummary[]> { return getServices().listRemoteSyncProfiles(); }
export function previewAttachRemoteSyncProfile(profileId: string): Promise<SyncAttachPreview> {
  return getServices().previewAttachRemoteSyncProfile(profileId);
}
export function createRemoteSyncProfile(): Promise<SyncActionResult> { return getServices().createRemoteSyncProfile(); }
export function attachRemoteSyncProfile(profileId: string): Promise<SyncActionResult> {
  return getServices().attachRemoteSyncProfile(profileId);
}
export function runSync(): Promise<SyncActionResult> { return getServices().runSync(); }
export function replaceLocalFromRemote(): Promise<SyncActionResult> { return getServices().replaceLocalFromRemote(); }
export function forcePublishLocalAsRemote(): Promise<SyncActionResult> { return getServices().forcePublishLocalAsRemote(); }
export function getSyncConflicts(): Promise<SyncConflict[]> { return getServices().getSyncConflicts(); }
export function resolveSyncConflict(conflictIndex: number, resolution: SyncConflictResolution): Promise<SyncActionResult> {
  return getServices().resolveSyncConflict(conflictIndex, resolution);
}
export function subscribeSyncProgress(listener: (update: SyncProgressUpdate) => void): Promise<() => void> {
  return getServices().subscribeSyncProgress(listener);
}
export function clearSyncBackups(): Promise<void> { return getServices().clearSyncBackups(); }

export function isDesktop(): boolean { return getServices().isDesktop(); }

export function applyMediaImport(records: MediaCsvRow[]): Promise<number> { return getServices().applyMediaImport(records); }

export function getMilestones(mediaTitle: string): Promise<Milestone[]> { return getServices().getMilestones(mediaTitle); }
export function addMilestone(milestone: Milestone): Promise<number> { return getServices().addMilestone(milestone); }
export function updateMilestone(milestone: Milestone): Promise<void> { return getServices().updateMilestone(milestone); }
export function deleteMilestone(id: number): Promise<void> { return getServices().deleteMilestone(id); }
export function clearMilestones(mediaTitle: string): Promise<void> { return getServices().clearMilestones(mediaTitle); }
export function exportMilestonesCsv(filePath: string): Promise<number> { return getServices().exportMilestonesCsv(filePath); }
export function importMilestonesCsv(filePath: string): Promise<number> { return getServices().importMilestonesCsv(filePath); }

export async function downloadAndSaveImage(mediaId: number, url: string): Promise<string> {
  const direct = (globalThis as unknown as Record<string, unknown>).mockDownloadedImagePath;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  return getServices().downloadAndSaveImage(mediaId, url);
}

// Legacy file-path-based desktop exports.
export function importCsv(filePath: string): Promise<number> {
  return desktopInvoke<number>('import_csv', { filePath });
}

export function exportCsv(filePath: string, startDate?: string, endDate?: string): Promise<number> {
  return desktopInvoke<number>('export_csv', { filePath, startDate, endDate });
}

export function exportMediaCsv(filePath: string): Promise<number> {
  return desktopInvoke<number>('export_media_csv', { filePath });
}

export function analyzeMediaCsv(filePath: string): Promise<MediaConflict[]> {
  return desktopInvoke<MediaConflict[]>('analyze_media_csv', { filePath });
}

export function uploadCoverImage(mediaId: number, path: string): Promise<string> {
  return desktopInvoke<string>('upload_cover_image', { mediaId, path });
}

export function readFileBytes(path: string): Promise<number[]> {
  return desktopInvoke<number[]>('read_file_bytes', { path });
}

export function exportFullBackup(localStorageData: string, version: string): Promise<boolean> {
  return getServices().pickAndExportFullBackup(localStorageData, version);
}

export function importFullBackup(): Promise<string | null> {
  return getServices().pickAndImportFullBackup();
}

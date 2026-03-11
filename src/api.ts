/**
 * Public API surface for all application data and platform operations.
 *
 * All functions delegate to the active service adapter (desktop or web).
 * Existing import sites across the codebase continue to work unchanged.
 *
 * Do NOT add direct @tauri-apps imports here — use the service layer instead.
 */
import { getServices } from './services';

// Re-export shared types so existing `import { Media, ... } from './api'` still works.
export type {
    Media,
    ActivityLog,
    ActivitySummary,
    DailyHeatmap,
    MediaCsvRow,
    MediaConflict,
} from './types';

import type { Media, ActivityLog, ActivitySummary, DailyHeatmap, MediaCsvRow, MediaConflict } from './types';

export function getAllMedia():                                     Promise<Media[]>          { return getServices().getAllMedia(); }
export function addMedia(media: Media):                            Promise<number>           { return getServices().addMedia(media); }
export function updateMedia(media: Media):                         Promise<void>             { return getServices().updateMedia(media); }
export function deleteMedia(id: number):                           Promise<void>             { return getServices().deleteMedia(id); }

export function addLog(log: ActivityLog):                         Promise<number>           { return getServices().addLog(log); }
export function deleteLog(id: number):                            Promise<void>             { return getServices().deleteLog(id); }
export function getLogs():                                        Promise<ActivitySummary[]> { return getServices().getLogs(); }
export function getHeatmap():                                     Promise<DailyHeatmap[]>   { return getServices().getHeatmap(); }
export function getLogsForMedia(mediaId: number):                 Promise<ActivitySummary[]> { return getServices().getLogsForMedia(mediaId); }

export function switchProfile(profileName: string):                Promise<void>             { return getServices().switchProfile(profileName); }
export function clearActivities():                                 Promise<void>             { return getServices().clearActivities(); }
export function wipeEverything():                                  Promise<void>             { return getServices().wipeEverything(); }
export function deleteProfile(profileName: string):                Promise<void>             { return getServices().deleteProfile(profileName); }
export function listProfiles():                                    Promise<string[]>          { return getServices().listProfiles(); }

export function getSetting(key: string):                           Promise<string | null>    { return getServices().getSetting(key); }
export function setSetting(key: string, value: string):            Promise<void>             { return getServices().setSetting(key, value); }

export function getUsername():                                     Promise<string>            { return getServices().getUsername(); }
export function getAppVersion():                                   Promise<string>            { return getServices().getAppVersion(); }

export function applyMediaImport(records: MediaCsvRow[]):          Promise<number>           { return getServices().applyMediaImport(records); }

export async function downloadAndSaveImage(mediaId: number, url: string): Promise<string> {
    const direct = (window as any).mockDownloadedImagePath;
    if (typeof direct === 'string' && direct.length > 0) {
        return direct;
    }
    return getServices().downloadAndSaveImage(mediaId, url);
}

// ── Legacy file-path-based exports (desktop only, kept for backwards compat) ─
// New code should use getServices().pick* / export* methods instead.

/** @deprecated Use getServices().pickAndImportActivities() */
export function importCsv(_filePath: string): Promise<number> {
    // Desktop-only path; file path is forwarded directly to the Tauri command.
    // In web mode this will throw — callers should be migrated to pickAndImportActivities().
    return getServices().getAllMedia().then(() => {
        throw new Error('importCsv(path) is not supported in web mode. Use pickAndImportActivities().');
    });
}

/** @deprecated Use getServices().exportActivities() */
export function exportCsv(_filePath: string, _startDate?: string, _endDate?: string): Promise<number> {
    throw new Error('exportCsv(path) is not supported in web mode. Use exportActivities().');
}

/** @deprecated Use getServices().exportMediaLibrary() */
export function exportMediaCsv(_filePath: string): Promise<number> {
    throw new Error('exportMediaCsv(path) is not supported in web mode. Use exportMediaLibrary().');
}

/** @deprecated Use getServices().analyzeMediaCsvFromPick() */
export function analyzeMediaCsv(_filePath: string): Promise<MediaConflict[]> {
    throw new Error('analyzeMediaCsv(path) is not supported in web mode. Use analyzeMediaCsvFromPick().');
}

/** @deprecated Use getServices().pickAndUploadCover() */
export function uploadCoverImage(_mediaId: number, _path: string): Promise<string> {
    throw new Error('uploadCoverImage(path) is not supported in web mode. Use pickAndUploadCover().');
}

/** @deprecated Use getServices().loadCoverImage() */
export function readFileBytes(_path: string): Promise<number[]> {
    throw new Error('readFileBytes(path) is not supported in web mode. Use loadCoverImage().');
}

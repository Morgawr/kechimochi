import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import { Media, Milestone, ActivityLog } from '../src/api';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri's invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('api.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('media functions', () => {
    it('getAllMedia should call invoke', async () => {
      vi.mocked(invoke).mockResolvedValue([]);
      await api.getAllMedia();
      expect(invoke).toHaveBeenCalledWith('get_all_media');
    });

    it('addMedia should call invoke', async () => {
      const media = { title: 'T' } as unknown as Media;
      vi.mocked(invoke).mockResolvedValue(1);
      await api.addMedia(media);
      expect(invoke).toHaveBeenCalledWith('add_media', { media });
    });

    it('updateMedia should call invoke', async () => {
      const media = { id: 1, title: 'T' } as unknown as Media;
      await api.updateMedia(media);
      expect(invoke).toHaveBeenCalledWith('update_media', { media });
    });

    it('deleteMedia should call invoke', async () => {
      await api.deleteMedia(1);
      expect(invoke).toHaveBeenCalledWith('delete_media', { id: 1 });
    });
  });

  describe('log functions', () => {
    it('addLog should call invoke', async () => {
      const log = { media_id: 1 } as unknown as ActivityLog;
      await api.addLog(log);
      expect(invoke).toHaveBeenCalledWith('add_log', { log });
    });

    it('updateLog calls invoke update_log', async () => {
        const log = { id: 123, media_id: 1, duration_minutes: 60, characters: 0, date: '2024-03-01' };
        await api.updateLog(log);
        expect(invoke).toHaveBeenCalledWith('update_log', { log });
    });

    it('deleteLog should call invoke', async () => {
      await api.deleteLog(1);
      expect(invoke).toHaveBeenCalledWith('delete_log', { id: 1 });
    });

    it('getLogs should call invoke', async () => {
      await api.getLogs();
      expect(invoke).toHaveBeenCalledWith('get_logs');
    });

    it('getHeatmap should call invoke', async () => {
      await api.getHeatmap();
      expect(invoke).toHaveBeenCalledWith('get_heatmap');
    });

    it('getLogsForMedia should call invoke', async () => {
      await api.getLogsForMedia(1);
      expect(invoke).toHaveBeenCalledWith('get_logs_for_media', { mediaId: 1 });
    });

    it('getTimelineEvents should call invoke', async () => {
      await api.getTimelineEvents();
      expect(invoke).toHaveBeenCalledWith('get_timeline_events');
    });

    it('clearActivities should call invoke', async () => {
      await api.clearActivities();
      expect(invoke).toHaveBeenCalledWith('clear_activities');
    });
  });

  describe('csv functions', () => {
    it('importCsv should call invoke', async () => {
      await api.importCsv('p');
      expect(invoke).toHaveBeenCalledWith('import_csv', { filePath: 'p' });
    });

    it('exportCsv should call invoke', async () => {
      await api.exportCsv('p', 's', 'e');
      expect(invoke).toHaveBeenCalledWith('export_csv', { filePath: 'p', startDate: 's', endDate: 'e' });
    });

    it('exportMediaCsv should call invoke', async () => {
      await api.exportMediaCsv('p');
      expect(invoke).toHaveBeenCalledWith('export_media_csv', { filePath: 'p' });
    });

    it('analyzeMediaCsv should call invoke', async () => {
      await api.analyzeMediaCsv('p');
      expect(invoke).toHaveBeenCalledWith('analyze_media_csv', { filePath: 'p' });
    });

    it('applyMediaImport should call invoke', async () => {
      await api.applyMediaImport([]);
      expect(invoke).toHaveBeenCalledWith('apply_media_import', { records: [] });
    });
  });

  describe('milestone functions', () => {
    it('getMilestones should call invoke', async () => {
      await api.getMilestones('T');
      expect(invoke).toHaveBeenCalledWith('get_milestones', { mediaTitle: 'T' });
    });

    it('addMilestone should call invoke', async () => {
      const m = { media_title: 'T' } as unknown as Milestone;
      await api.addMilestone(m);
      expect(invoke).toHaveBeenCalledWith('add_milestone', { milestone: m });
    });

    it('deleteMilestone should call invoke', async () => {
      await api.deleteMilestone(1);
      expect(invoke).toHaveBeenCalledWith('delete_milestone', { id: 1 });
    });

    it('updateMilestone should call invoke', async () => {
      const m = { id: 1 } as unknown as Milestone;
      await api.updateMilestone(m);
      expect(invoke).toHaveBeenCalledWith('update_milestone', { milestone: m });
    });

    it('clearMilestones should call invoke', async () => {
      await api.clearMilestones('T');
      expect(invoke).toHaveBeenCalledWith('delete_milestones_for_media', { mediaTitle: 'T' });
    });

    it('exportMilestonesCsv should call invoke', async () => {
      await api.exportMilestonesCsv('p');
      expect(invoke).toHaveBeenCalledWith('export_milestones_csv', { filePath: 'p' });
    });

    it('importMilestonesCsv should call invoke', async () => {
      await api.importMilestonesCsv('p');
      expect(invoke).toHaveBeenCalledWith('import_milestones_csv', { filePath: 'p' });
    });
  });

  describe('profile and settings functions', () => {
    it('initializeUserDb should call invoke', async () => {
      await api.initializeUserDb('p');
      expect(invoke).toHaveBeenCalledWith('initialize_user_db', { fallbackUsername: 'p' });
    });

    it('wipeEverything should call invoke', async () => {
      await api.wipeEverything();
      expect(invoke).toHaveBeenCalledWith('wipe_everything');
    });

    it('getUsername should call invoke', async () => {
      await api.getUsername();
      expect(invoke).toHaveBeenCalledWith('get_username');
    });

    it('getProfilePicture should call invoke', async () => {
      await api.getProfilePicture();
      expect(invoke).toHaveBeenCalledWith('get_profile_picture');
    });

    it('deleteProfilePicture should call invoke', async () => {
      await api.deleteProfilePicture();
      expect(invoke).toHaveBeenCalledWith('delete_profile_picture');
    });

    it('getSetting should call invoke', async () => {
      await api.getSetting('k');
      expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'k' });
    });

    it('setSetting should call invoke', async () => {
      await api.setSetting('k', 'v');
      expect(invoke).toHaveBeenCalledWith('set_setting', { key: 'k', value: 'v' });
    });
  });

  describe('sync functions', () => {
    it.each([
      ['getSyncStatus', () => api.getSyncStatus(), 'get_sync_status'],
      ['connectGoogleDrive', () => api.connectGoogleDrive(), 'connect_google_drive'],
      ['disconnectGoogleDrive', () => api.disconnectGoogleDrive(), 'disconnect_google_drive'],
      ['listRemoteSyncProfiles', () => api.listRemoteSyncProfiles(), 'list_remote_sync_profiles'],
      ['createRemoteSyncProfile', () => api.createRemoteSyncProfile(), 'create_remote_sync_profile'],
      ['runSync', () => api.runSync(), 'run_sync'],
      ['replaceLocalFromRemote', () => api.replaceLocalFromRemote(), 'replace_local_from_remote'],
      ['forcePublishLocalAsRemote', () => api.forcePublishLocalAsRemote(), 'force_publish_local_as_remote'],
      ['getSyncConflicts', () => api.getSyncConflicts(), 'get_sync_conflicts'],
      ['clearSyncBackups', () => api.clearSyncBackups(), 'clear_sync_backups'],
    ])('%s should call invoke', async (_label, fn, command) => {
      await fn();
      expect(invoke).toHaveBeenCalledWith(command);
    });

    it.each([
      ['previewAttachRemoteSyncProfile', () => api.previewAttachRemoteSyncProfile('prof_123'), 'preview_attach_remote_sync_profile', { profileId: 'prof_123' }],
      ['attachRemoteSyncProfile', () => api.attachRemoteSyncProfile('prof_123'), 'attach_remote_sync_profile', { profileId: 'prof_123' }],
    ])('%s should call invoke with args', async (_label, fn, command, args) => {
      await fn();
      expect(invoke).toHaveBeenCalledWith(command, args);
    });

    it('resolveSyncConflict should call invoke', async () => {
      await api.resolveSyncConflict(2, { kind: 'media_field', side: 'remote' });
      expect(invoke).toHaveBeenCalledWith('resolve_sync_conflict', {
        conflictIndex: 2,
        resolution: { kind: 'media_field', side: 'remote' },
      });
    });
  });

  describe('file and image functions', () => {
    it('uploadCoverImage should call invoke', async () => {
      await api.uploadCoverImage(1, 'p');
      expect(invoke).toHaveBeenCalledWith('upload_cover_image', { mediaId: 1, path: 'p' });
    });

    it('readFileBytes should call invoke', async () => {
      await api.readFileBytes('p');
      expect(invoke).toHaveBeenCalledWith('read_file_bytes', { path: 'p' });
    });

    it('downloadAndSaveImage should call invoke', async () => {
      await api.downloadAndSaveImage(1, 'u');
      expect(invoke).toHaveBeenCalledWith('download_and_save_image', { mediaId: 1, url: 'u' });
    });
    
    it('downloadAndSaveImage should return mock path if window.mockDownloadedImagePath exists', async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      g.mockDownloadedImagePath = 'mock-path';
      const result = await api.downloadAndSaveImage(1, 'u');
      expect(result).toBe('mock-path');
      delete g.mockDownloadedImagePath;
    });

  });

  describe('getAppVersion', () => {
    it('should return the explicit dev build version', async () => {
      const globals = globalThis as Record<string, unknown>;
      globals.__APP_VERSION__ = '0.1.0-dev.abc';
      globals.__APP_BUILD_CHANNEL__ = 'dev';
      globals.__APP_RELEASE_STAGE__ = 'beta';

      const result = await api.getAppVersion();
      expect(result).toBe('0.1.0-dev.abc');
    });

    it('should return the explicit release build version', async () => {
      const globals = globalThis as Record<string, unknown>;
      globals.__APP_VERSION__ = '0.1.0';
      globals.__APP_BUILD_CHANNEL__ = 'release';
      globals.__APP_RELEASE_STAGE__ = 'beta';

      const result = await api.getAppVersion();
      expect(result).toBe('0.1.0');
    });
  });
});

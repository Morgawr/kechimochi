import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { safeClick, dismissAlert, confirmAction, setDialogMockPath, waitForNoActiveOverlays } from '../helpers/common.js';
import { addMedia, clickMediaItem, isMediaVisible } from '../helpers/library.js';
import { addExtraField, backToLibrary, editExtraField, getDescription, getExtraField } from '../helpers/media-detail.js';
import {
  enableSyncByAttachingExistingProfile,
  enableSyncByCreatingNewProfile,
  forcePublishLocal,
  openCloudSyncCard,
  openSyncConflictsPanel,
  replaceLocalFromRemote,
  resolveFirstExtraDataConflict,
  runSyncNow,
  waitForSyncCardText,
} from '../helpers/sync.js';
import {
  getRemoteMedia,
  getSingleRemoteProfileId,
  readRemoteProfile,
  setRemoteExtraDataEntry,
  setRemoteMediaDescription,
  waitForRemoteProfileCount,
} from '../helpers/sync-mock.js';

const REMOTE_SYNC_TARGET = 'ペルソナ5';
const REMOTE_DESCRIPTION = 'Remote sync update applied from the fake Google Drive service.';
const CONFLICT_KEY = 'sync_conflict_note';
const FORCE_KEY = 'force_publish_note';
const MANUAL_SYNC_TITLE = 'Cloud Sync Manual Local';
const ROUNDTRIP_TITLE = 'Cloud Sync Backup Roundtrip';
const REMOTE_SYNC_TIMEOUT_MS = 12_000;
const BACKUP_ALERT_TIMEOUT_MS = 12_000;

async function waitForRemoteMediaTitle(title: string, timeout = REMOTE_SYNC_TIMEOUT_MS): Promise<void> {
  await browser.waitUntil(async () => {
    const remoteProfileId = getSingleRemoteProfileId();
    const snapshot = readRemoteProfile(remoteProfileId).snapshot;
    return Object.values(snapshot.library).some((media) => media.title === title);
  }, {
    timeout,
    timeoutMsg: `Remote profile never contained "${title}"`,
  });
}

async function openMediaDetail(title: string): Promise<void> {
  await navigateTo('media');
  expect(await verifyActiveView('media')).toBe(true);
  await clickMediaItem(title);
  await $('#media-detail-header').waitForDisplayed({ timeout: 10_000 });
}

describe('CUJ: Cloud Sync', () => {
  let remoteProfileId = '';
  let backupZipPath = '';
  let completedStep = 0;

  function requireStep(context: Mocha.Context, step: number): void {
    if (completedStep < step) {
      context.skip();
    }
  }

  before(async () => {
    await waitForAppReady();
    const exportBaseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
    backupZipPath = path.join(exportBaseDir, `kechimochi-sync-roundtrip-${Date.now()}.zip`);
  });

  beforeEach(async () => {
    await waitForNoActiveOverlays(5_000).catch(() => undefined);
  });

  after(() => {
    if (!process.env.SPEC_STAGE_DIR && backupZipPath && fs.existsSync(backupZipPath)) {
      fs.unlinkSync(backupZipPath);
    }
  });

  it('should complete the mocked Google login flow and create the first cloud profile', async function () {
    await enableSyncByCreatingNewProfile();
    await waitForRemoteProfileCount(1, REMOTE_SYNC_TIMEOUT_MS);
    remoteProfileId = getSingleRemoteProfileId();

    await openCloudSyncCard();
    await waitForSyncCardText('Connected');
    await waitForSyncCardText('Sync profile');
    expect(remoteProfileId).not.toBe('');
    completedStep = 1;
  });

  it('should manually sync a local change up to the remote profile', async function () {
    requireStep(this, 1);
    await addMedia(MANUAL_SYNC_TITLE, 'Reading', 'Novel');
    await navigateTo('profile');
    await runSyncNow('Cloud Sync completed successfully');

    await waitForRemoteMediaTitle(MANUAL_SYNC_TITLE);
    const remoteSnapshot = readRemoteProfile(remoteProfileId).snapshot;
    expect(Object.values(remoteSnapshot.library).some((media) => media.title === MANUAL_SYNC_TITLE)).toBe(true);
    completedStep = 2;
  });

  it('should pull a remote-only update down on a normal sync', async function () {
    requireStep(this, 2);
    setRemoteMediaDescription(remoteProfileId, REMOTE_SYNC_TARGET, REMOTE_DESCRIPTION);

    await navigateTo('profile');
    await runSyncNow('Cloud Sync completed successfully');

    await openMediaDetail(REMOTE_SYNC_TARGET);
    await browser.waitUntil(async () => (await getDescription()) === REMOTE_DESCRIPTION, {
      timeout: 10_000,
      timeoutMsg: 'Local description never updated from the remote snapshot',
    });
    await backToLibrary('grid');
    completedStep = 3;
  });

  it('should surface an extra-data merge conflict and let the user resolve it through the UI', async function () {
    requireStep(this, 3);
    await openMediaDetail(REMOTE_SYNC_TARGET);
    await addExtraField(CONFLICT_KEY, 'shared-baseline');
    await backToLibrary('grid');

    await navigateTo('profile');
    await runSyncNow('Cloud Sync completed successfully');

    await openMediaDetail(REMOTE_SYNC_TARGET);
    await editExtraField(CONFLICT_KEY, 'local-conflict-value');
    await backToLibrary('grid');

    setRemoteExtraDataEntry(remoteProfileId, REMOTE_SYNC_TARGET, CONFLICT_KEY, 'remote-conflict-value');

    await navigateTo('profile');
    await runSyncNow('Resolve them in the Cloud Sync card');
    await waitForSyncCardText('Conflicts Pending');

    await openSyncConflictsPanel();
    await resolveFirstExtraDataConflict('remote');
    await runSyncNow('Cloud Sync completed successfully');

    await openMediaDetail(REMOTE_SYNC_TARGET);
    await browser.waitUntil(async () => (await getExtraField(CONFLICT_KEY)) === 'remote-conflict-value', {
      timeout: 10_000,
      timeoutMsg: 'Resolved extra-data value never applied locally',
    });
    await backToLibrary('grid');

    const remoteMedia = getRemoteMedia(remoteProfileId, REMOTE_SYNC_TARGET);
    expect(JSON.parse(remoteMedia.extra_data)[CONFLICT_KEY]).toBe('remote-conflict-value');
    completedStep = 4;
  });

  it('should force publish local data to the remote profile', async function () {
    requireStep(this, 4);
    await openMediaDetail(REMOTE_SYNC_TARGET);
    await addExtraField(FORCE_KEY, 'force-local-value');
    await backToLibrary('grid');

    await navigateTo('profile');
    await forcePublishLocal();

    await browser.waitUntil(async () => {
      const remoteMedia = getRemoteMedia(remoteProfileId, REMOTE_SYNC_TARGET);
      return JSON.parse(remoteMedia.extra_data)[FORCE_KEY] === 'force-local-value';
    }, {
      timeout: 10_000,
      timeoutMsg: 'Force publish did not update the remote snapshot',
    });
    completedStep = 5;
  });

  it('should replace the local state from the remote profile for destructive recovery', async function () {
    requireStep(this, 5);
    setRemoteExtraDataEntry(remoteProfileId, REMOTE_SYNC_TARGET, FORCE_KEY, 'force-remote-value');

    await openMediaDetail(REMOTE_SYNC_TARGET);
    await editExtraField(FORCE_KEY, 'local-stale-value');
    await backToLibrary('grid');

    await navigateTo('profile');
    await replaceLocalFromRemote();

    await openMediaDetail(REMOTE_SYNC_TARGET);
    await browser.waitUntil(async () => (await getExtraField(FORCE_KEY)) === 'force-remote-value', {
      timeout: 10_000,
      timeoutMsg: 'Replace Local From Remote did not overwrite the local value',
    });
    await backToLibrary('grid');
    completedStep = 6;
  });

  it('should restore missing remote changes after importing an older local backup and re-attaching', async function () {
    requireStep(this, 6);
    await navigateTo('profile');
    await setDialogMockPath(backupZipPath);
    await safeClick('#profile-btn-export-full-backup');
    await dismissAlert('Full backup export completed.', BACKUP_ALERT_TIMEOUT_MS);
    expect(fs.existsSync(backupZipPath)).toBe(true);

    await addMedia(ROUNDTRIP_TITLE, 'Watching', 'Anime');
    await navigateTo('profile');
    await runSyncNow('Cloud Sync completed successfully');
    await waitForRemoteMediaTitle(ROUNDTRIP_TITLE);

    await setDialogMockPath(backupZipPath);
    await safeClick('#profile-btn-import-full-backup');
    await confirmAction(true);
    await dismissAlert('Backup imported successfully!', BACKUP_ALERT_TIMEOUT_MS);
    await waitForAppReady();

    await enableSyncByAttachingExistingProfile();
    await navigateTo('media');
    await browser.waitUntil(async () => await isMediaVisible(ROUNDTRIP_TITLE), {
      timeout: 15_000,
      timeoutMsg: 'Remote-only media was not restored after re-attaching the cloud profile',
    });
    completedStep = 7;
  });
});

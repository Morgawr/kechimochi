import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { safeClick, dismissAlert, confirmAction, setDialogMockPath, waitForNoActiveOverlays } from '../../helpers/common.js';
import { addMedia, clickMediaItem, isMediaVisible } from '../../helpers/library.js';
import {
  addExtraField,
  addMilestone,
  backToLibrary,
  editExtraField,
  getDescription,
  getExtraField,
  logActivityFromDetail,
  uploadCoverImage,
} from '../../helpers/media-detail.js';
import { uploadProfilePicture } from '../../helpers/profile.js';
import { setSelect, setText } from '../../helpers/form-controls.js';
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
} from '../../helpers/sync.js';
import {
  addRemoteMediaWithIndependentUid,
  getRemoteMedia,
  getSingleRemoteProfileId,
  readRemoteProfile,
  setRemoteExtraDataEntry,
  setRemoteMediaDescription,
  waitForRemoteProfileCount,
} from '../../helpers/sync-mock.js';

const REMOTE_SYNC_TARGET = 'ペルソナ5';
const REMOTE_DESCRIPTION = 'Remote sync update applied from the fake Google Drive service.';
const CONFLICT_KEY = 'sync_conflict_note';
const FORCE_KEY = 'force_publish_note';
const MANUAL_SYNC_TITLE = 'Cloud Sync Manual Local';
const ROUNDTRIP_TITLE = 'Cloud Sync Backup Roundtrip';
const COMPLETE_ENTITY_TITLE = 'Cloud Sync Complete Entity';
const DELETION_TITLE = 'Cloud Sync Deletion Propagation';
const DUPLICATE_IDENTITY_TITLE = 'Cloud Sync Duplicate Identity';
const KEEP_BOTH_IDENTITY_TITLE = 'Cloud Sync Keep Both Identity';
const RENAMED_CLOUD_IDENTITY_TITLE = 'Cloud Sync Keep Both Cloud Copy';
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

  it('should sync logs, notes, milestones, settings, profile picture, covers, variants, and deletions', async function () {
    requireStep(this, 7);
    const imageFixture = path.join(
      process.env.KECHIMOCHI_DATA_DIR || path.resolve(process.cwd(), 'e2e', 'fixtures'),
      'covers',
      'profile_placeholder.png',
    );

    await navigateTo('media');
    await addMedia(COMPLETE_ENTITY_TITLE, 'Reading', 'Novel', 'Sync Edition');
    await uploadCoverImage(imageFixture);
    await logActivityFromDetail(
      COMPLETE_ENTITY_TITLE,
      '36',
      '2400',
      'Watching',
      'Synced note with exact content',
    );
    await addMilestone('Synced milestone', '0', '36', '2400', true);
    await backToLibrary('grid');
    await addMedia(DELETION_TITLE, 'Playing', 'Videogame');
    await backToLibrary('grid');

    await navigateTo('profile');
    await setSelect('#profile-select-theme', { value: 'molokai' });
    await uploadProfilePicture(imageFixture);
    await runSyncNow('Cloud Sync completed successfully');

    await browser.waitUntil(async () => {
      const snapshot = readRemoteProfile(remoteProfileId).snapshot;
      return Object.values(snapshot.library).some(media => media.title === COMPLETE_ENTITY_TITLE);
    }, { timeout: REMOTE_SYNC_TIMEOUT_MS });

    const syncedSnapshot = readRemoteProfile(remoteProfileId).snapshot;
    const syncedMedia = Object.values(syncedSnapshot.library)
      .find(media => media.title === COMPLETE_ENTITY_TITLE) as Record<string, unknown>;
    const activities = syncedMedia.activities as Array<Record<string, unknown>>;
    const milestones = syncedMedia.milestones as Array<Record<string, unknown>>;
    expect(syncedMedia.variant).toBe('Sync Edition');
    expect(syncedMedia.cover_blob_sha256).toEqual(expect.any(String));
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      activity_type: 'Watching',
      duration_minutes: 36,
      characters: 2400,
      notes: 'Synced note with exact content',
    });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ name: 'Synced milestone', duration: 36, characters: 2400 });
    expect((syncedSnapshot.settings.theme as Record<string, unknown>).value).toBe('molokai');
    expect((syncedSnapshot.profile_picture as Record<string, unknown>).base64_data).toEqual(expect.any(String));

    await openMediaDetail(DELETION_TITLE);
    await safeClick('#btn-media-overflow');
    await safeClick('#btn-delete-media-detail');
    await confirmAction(true);
    await navigateTo('profile');
    await runSyncNow('Cloud Sync completed successfully');

    await browser.waitUntil(async () => {
      const snapshot = readRemoteProfile(remoteProfileId).snapshot;
      return !Object.values(snapshot.library).some(media => media.title === DELETION_TITLE)
        && snapshot.tombstones.length > 0;
    }, {
      timeout: REMOTE_SYNC_TIMEOUT_MS,
      timeoutMsg: 'Remote snapshot did not receive the local media deletion',
    });
    completedStep = 8;
  });

  it('should pause on equal title/variant with different cloud identity and combine explicitly', async function () {
    requireStep(this, 8);
    await navigateTo('media');
    await addMedia(DUPLICATE_IDENTITY_TITLE, 'Reading', 'Novel', 'Shared Edition');
    await backToLibrary('grid');

    const remoteDuplicateUid = addRemoteMediaWithIndependentUid(remoteProfileId, {
      title: DUPLICATE_IDENTITY_TITLE,
      variant: 'Shared Edition',
      mediaType: 'Reading',
      contentType: 'Novel',
    });

    await navigateTo('profile');
    await runSyncNow('Resolve them in the Cloud Sync card');
    await waitForSyncCardText('Conflicts Pending');
    await openSyncConflictsPanel();

    const conflictCard = $('.sync-duplicate-media-conflict');
    await conflictCard.waitForDisplayed({ timeout: 10_000 });
    const conflictText = await conflictCard.getText();
    expect(conflictText).toContain(DUPLICATE_IDENTITY_TITLE);
    expect(conflictText).toContain('Shared Edition');
    expect(conflictText).not.toContain(remoteDuplicateUid);

    await safeClick(() => conflictCard.$('[data-sync-resolution-kind="duplicate_media_identity_merge"]'));
    await confirmAction(true);
    await dismissAlert('1 conflict still need review', REMOTE_SYNC_TIMEOUT_MS);

    // Combining two independently-created entries preserves their histories,
    // but differing metadata still needs an explicit choice. The local entry
    // starts Untracked while the mock cloud entry starts Ongoing.
    await openSyncConflictsPanel();
    expect(await $('#profile-sync-conflicts').getText()).toContain('Tracking Status conflict');
    await safeClick('[data-sync-resolution-kind="media_field"][data-sync-resolution-side="local"]');
    await dismissAlert('Run Sync Now to publish the merged state', REMOTE_SYNC_TIMEOUT_MS);
    await runSyncNow('Cloud Sync completed successfully');

    const remote = readRemoteProfile(remoteProfileId).snapshot;
    expect(Object.values(remote.library).filter(media =>
      media.title === DUPLICATE_IDENTITY_TITLE && media.variant === 'Shared Edition'
    )).toHaveLength(1);
    expect(remote.tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ media_uid: remoteDuplicateUid }),
    ]));

    await navigateTo('media');
    expect(await $$(`.media-grid-item[data-title="${DUPLICATE_IDENTITY_TITLE}"]`).length).toBe(1);
    completedStep = 9;
  });

  it('should rename the selected cloud identity and keep both independent entries', async function () {
    requireStep(this, 9);
    await navigateTo('media');
    await addMedia(KEEP_BOTH_IDENTITY_TITLE, 'Reading', 'Novel', 'Shared Edition');
    await backToLibrary('grid');

    const remoteDuplicateUid = addRemoteMediaWithIndependentUid(remoteProfileId, {
      title: KEEP_BOTH_IDENTITY_TITLE,
      variant: 'Shared Edition',
      mediaType: 'Watching',
      contentType: 'Anime',
    });

    await navigateTo('profile');
    await runSyncNow('Resolve them in the Cloud Sync card');
    await waitForSyncCardText('Conflicts Pending');
    await openSyncConflictsPanel();

    await setText(
      '.sync-duplicate-replacement-title[data-sync-duplicate-side="remote"]',
      RENAMED_CLOUD_IDENTITY_TITLE,
    );
    await safeClick(
      '[data-sync-resolution-kind="duplicate_media_identity_keep_both"][data-sync-resolution-side="remote"]',
    );
    await dismissAlert('Run Sync Now to publish the merged state', REMOTE_SYNC_TIMEOUT_MS);
    await runSyncNow('Cloud Sync completed successfully');

    const remote = readRemoteProfile(remoteProfileId).snapshot;
    expect(remote.library[remoteDuplicateUid]).toMatchObject({
      title: RENAMED_CLOUD_IDENTITY_TITLE,
      variant: 'Shared Edition',
      media_type: 'Watching',
    });
    expect(Object.values(remote.library).filter(media =>
      media.title === KEEP_BOTH_IDENTITY_TITLE && media.variant === 'Shared Edition'
    )).toHaveLength(1);
    expect(remote.tombstones.some(tombstone => tombstone.media_uid === remoteDuplicateUid)).toBe(false);

    await navigateTo('media');
    expect(await $$(`.media-grid-item[data-title="${KEEP_BOTH_IDENTITY_TITLE}"][data-variant="Shared Edition"]`).length).toBe(1);
    expect(await $$(`.media-grid-item[data-title="${RENAMED_CLOUD_IDENTITY_TITLE}"][data-variant="Shared Edition"]`).length).toBe(1);
    completedStep = 10;
  });
});

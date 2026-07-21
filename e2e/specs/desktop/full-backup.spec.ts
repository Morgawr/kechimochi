import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import {
  confirmAction,
  dismissAlert,
  setDialogMockPath,
  submitPrompt,
  waitForSelectorDisplayed,
} from '../../helpers/common.js';
import { setText, setSelect } from '../../helpers/form-controls.js';
import { TEST_PROFILE_NAME } from '../../config/test-constants.js';
import { addMedia, clickMediaItem } from '../../helpers/library.js';
import {
  addExtraField,
  addMilestone,
  getExtraField,
  logActivityFromDetail,
  uploadCoverImage,
} from '../../helpers/media-detail.js';
import { uploadProfilePicture } from '../../helpers/profile.js';

const SEEDED_ACTIVITY_TITLES = ['ペルソナ5', '薬屋のひとりごと', '葬送のフリーレン'] as const;
const FIDELITY_TITLE = 'Full Backup Fidelity Media';
const FIDELITY_NOTE = 'Exact note restored from the full backup';
const FIDELITY_MILESTONE = 'Exact milestone restored';

async function expectProfileName(name: string): Promise<void> {
  const headerName = $('#nav-user-name');
  const profileName = $('#profile-name');

  await browser.waitUntil(async () => (await headerName.getText()) === name, {
    timeout: 5000,
    timeoutMsg: `Header profile name did not become ${name}`,
  });

  await browser.waitUntil(async () => (await profileName.getText()) === name, {
    timeout: 5000,
    timeoutMsg: `Profile heading did not become ${name}`,
  });

  expect(await headerName.getText()).toBe(name);
  expect(await profileName.getText()).toBe(name);
}

async function expectTheme(theme: string): Promise<void> {
  await browser.waitUntil(async () => (await $('body').getAttribute('data-theme')) === theme, {
    timeout: 5000,
    timeoutMsg: `Theme did not become ${theme}`,
  });

  await browser.waitUntil(async () => (await $('#profile-select-theme').getValue()) === theme, {
    timeout: 5000,
    timeoutMsg: `Theme selector did not become ${theme}`,
  });

  expect(await $('body').getAttribute('data-theme')).toBe(theme);
  expect(await $('#profile-select-theme').getValue()).toBe(theme);
}

async function expectSeededActivitiesPresent(): Promise<void> {
  await navigateTo('dashboard');
  expect(await verifyActiveView('dashboard')).toBe(true);

  for (const title of SEEDED_ACTIVITY_TITLES) {
    const activity = $(`.dashboard-activity-item[data-activity-title="${title}"]`);
    await activity.waitForExist({
      timeout: 5000,
      timeoutMsg: `Expected seeded activity for "${title}" to exist on the dashboard`,
    });
    expect(await activity.isDisplayed()).toBe(true);
  }
}

async function setTheme(theme: string): Promise<void> {
  await setSelect('#profile-select-theme', { value: theme });
  await expectTheme(theme);
}

async function performFactoryReset(): Promise<void> {
  const wipeBtn = $('#profile-btn-wipe-everything');
  await wipeBtn.waitForDisplayed({ timeout: 5000 });
  await wipeBtn.scrollIntoView();
  await wipeBtn.click();

  await submitPrompt('WIPE_EVERYTHING');
  await waitForSelectorDisplayed('#initial-prompt-input', 30000);
}

async function completeFirstTimeSetup(profileName: string): Promise<void> {
  await waitForSelectorDisplayed('#initial-prompt-input', 10000);
  await setText('#initial-prompt-input', profileName);

  const startBtn = $('#initial-prompt-confirm');
  await startBtn.waitForClickable({ timeout: 5000 });
  await startBtn.click();

  await browser.waitUntil(async () => {
    return browser.execute((expectedProfileName) => {
      const active = document.querySelector('[data-view="dashboard"]')?.classList.contains('active') ?? false;
      const dashboardReady = document.querySelector('.dashboard-root') !== null;
      const headerProfile = document.querySelector('#nav-user-name')?.textContent?.trim() ?? '';
      return active && dashboardReady && headerProfile === expectedProfileName;
    }, profileName);
  }, {
    timeout: 30000,
    timeoutMsg: `Dashboard did not become active with ${profileName}`,
  });
}

describe('CUJ: Full Backup Import Export', () => {
  let backupZipPath: string;

  before(async () => {
    await waitForAppReady();

    const exportBaseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
    backupZipPath = path.join(exportBaseDir, `kechimochi-full-backup-${Date.now()}.zip`);
  });

  after(() => {
    if (!process.env.SPEC_STAGE_DIR && backupZipPath && fs.existsSync(backupZipPath)) {
      fs.unlinkSync(backupZipPath);
    }
  });

  it('should export a full backup, factory reset the app, and restore everything from the backup', async () => {
    await expectSeededActivitiesPresent();

    const imageFixture = path.join(
      process.env.KECHIMOCHI_DATA_DIR || path.resolve(process.cwd(), 'e2e', 'fixtures'),
      'covers',
      'profile_placeholder.png',
    );
    await navigateTo('media');
    await addMedia(FIDELITY_TITLE, 'Reading', 'Novel', 'Backup Edition');
    await uploadCoverImage(imageFixture);
    await addExtraField('Backup field', 'Backup field value');
    await logActivityFromDetail(FIDELITY_TITLE, '52', '3100', 'Reading', FIDELITY_NOTE);
    await addMilestone(FIDELITY_MILESTONE, '0', '52', '3100', true);

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await expectProfileName(TEST_PROFILE_NAME);
    await expectTheme('pastel-pink');

    await uploadProfilePicture(imageFixture);

    await setTheme('molokai');

    await setDialogMockPath(backupZipPath);

    const exportBackupBtn = $('#profile-btn-export-full-backup');
    await exportBackupBtn.waitForClickable({ timeout: 5000 });
    await exportBackupBtn.click();

    await dismissAlert('Full backup export completed.', 20000);

    expect(fs.existsSync(backupZipPath)).toBe(true);
    expect(fs.statSync(backupZipPath).size).toBeGreaterThan(0);

    await performFactoryReset();
    await completeFirstTimeSetup('BESTUSER');

    await navigateTo('dashboard');
    const emptyState = $('p=No activity logged yet.');
    await emptyState.waitForDisplayed({ timeout: 5000 });
    expect(await emptyState.isDisplayed()).toBe(true);

    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);
    expect(await $$('.media-grid-item').length).toBe(0);

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    await expectProfileName('BESTUSER');
    await expectTheme('pastel-pink');

    await setDialogMockPath(backupZipPath);

    const importBackupBtn = $('#profile-btn-import-full-backup');
    await importBackupBtn.waitForClickable({ timeout: 5000 });
    await importBackupBtn.click();

    await confirmAction(true);

    await dismissAlert('Backup imported successfully!', 15000);
    await waitForAppReady();

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    await expectProfileName(TEST_PROFILE_NAME);
    await expectTheme('molokai');
    const restoredProfilePicture = $('#profile-hero-avatar img');
    await restoredProfilePicture.waitForDisplayed({ timeout: 10000 });
    expect(await restoredProfilePicture.getAttribute('src')).toContain('data:image/');

    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);
    await browser.waitUntil(async () => (await $$('.media-grid-item').length) > 0, {
      timeout: 10000,
      timeoutMsg: 'Media library did not repopulate after importing the full backup',
    });

    await clickMediaItem(FIDELITY_TITLE);
    expect(await $('#media-variant').getText()).toBe('Backup Edition');
    expect(await getExtraField('Backup field')).toBe('Backup field value');
    expect(await $('#media-logs-container').getText()).toContain(FIDELITY_NOTE);
    expect(await $('#milestone-list-container').getText()).toContain(FIDELITY_MILESTONE);
    await $('#media-cover-img').waitForDisplayed({ timeout: 10000 });
    expect(await $('#media-cover-img').getTagName()).toBe('img');

    await expectSeededActivitiesPresent();
  });
});

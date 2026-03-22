import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { confirmAction, dismissAlert, setDialogMockPath } from '../helpers/common.js';

const SEEDED_ACTIVITY_TITLES = ['ペルソナ5', '薬屋のひとりごと', '葬送のフリーレン'] as const;

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
  const themeSelect = $('#profile-select-theme');
  const body = $('body');

  await browser.waitUntil(async () => (await body.getAttribute('data-theme')) === theme, {
    timeout: 5000,
    timeoutMsg: `Theme did not become ${theme}`,
  });

  await browser.waitUntil(async () => (await themeSelect.getValue()) === theme, {
    timeout: 5000,
    timeoutMsg: `Theme selector did not become ${theme}`,
  });

  expect(await body.getAttribute('data-theme')).toBe(theme);
  expect(await themeSelect.getValue()).toBe(theme);
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
  const themeSelect = $('#profile-select-theme');
  await themeSelect.waitForDisplayed({ timeout: 5000 });

  await browser.execute((nextTheme) => {
    const select = document.getElementById('profile-select-theme') as HTMLSelectElement | null;
    if (!select) {
      throw new Error('Theme select not found');
    }
    select.value = nextTheme as string;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);

  await expectTheme(theme);
}

async function performFactoryReset(): Promise<void> {
  const wipeBtn = $('#profile-btn-wipe-everything');
  await wipeBtn.waitForDisplayed({ timeout: 5000 });
  await wipeBtn.scrollIntoView();
  await wipeBtn.click();

  const promptInput = $('#prompt-input');
  await promptInput.waitForDisplayed({ timeout: 5000 });
  await promptInput.setValue('WIPE_EVERYTHING');

  const confirmBtn = $('#prompt-confirm');
  await confirmBtn.waitForClickable({ timeout: 5000 });
  await confirmBtn.click();

  const initialInput = $('#initial-prompt-input');
  await initialInput.waitForDisplayed({ timeout: 10000 });
}

async function completeFirstTimeSetup(profileName: string): Promise<void> {
  const initialInput = $('#initial-prompt-input');
  await initialInput.waitForDisplayed({ timeout: 10000 });
  await initialInput.setValue(profileName);

  const startBtn = $('#initial-prompt-confirm');
  await startBtn.waitForClickable({ timeout: 5000 });
  await startBtn.click();

  await browser.waitUntil(async () => {
    const active = await verifyActiveView('dashboard');
    const currentProfile = await browser.execute(() => localStorage.getItem('kechimochi_profile'));
    return active && currentProfile === profileName;
  }, {
    timeout: 10000,
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

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await expectProfileName('TESTUSER');
    await expectTheme('pastel-pink');

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
    expect((await $$('.media-grid-item')).length).toBe(0);

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

    await browser.pause(500);
    await waitForAppReady();

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    await expectProfileName('TESTUSER');
    await expectTheme('molokai');

    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);
    await browser.waitUntil(async () => (await $$('.media-grid-item')).length > 0, {
      timeout: 10000,
      timeoutMsg: 'Media library did not repopulate after importing the full backup',
    });

    await expectSeededActivitiesPresent();
  });
});

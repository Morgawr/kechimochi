/// <reference types="@wdio/globals/types" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { confirmAction, dismissAlert, setDialogMockPath } from '../helpers/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

describe('Custom Theme Packs', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('imports, exports, and deletes a custom theme pack', async () => {
    const importPath = path.join(FIXTURES_DIR, 'custom_theme_pack.json');
    const exportPath = path.join(os.tmpdir(), `kechimochi-theme-export-${Date.now()}.json`);

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await setDialogMockPath(importPath);
    const importBtn = await $('#profile-btn-import-theme');
    await importBtn.waitForClickable({ timeout: 5000 });
    await importBtn.click();
    await dismissAlert('Imported theme pack');

    await browser.waitUntil(async () => {
      const body = await $('body');
      return (await body.getAttribute('data-theme')) === 'custom:e2e-theme';
    }, {
      timeout: 5000,
      timeoutMsg: 'Imported custom theme was not activated',
    });

    const buttonRadius = await browser.execute(() => {
      const button = document.querySelector('.btn') as HTMLElement | null;
      if (!button) return '';
      return globalThis.getComputedStyle(button).borderRadius;
    });
    expect(buttonRadius).toBe('999px');

    await setDialogMockPath(exportPath);
    const exportBtn = await $('#profile-btn-export-theme');
    await exportBtn.waitForClickable({ timeout: 5000 });
    await exportBtn.click();
    await dismissAlert('Exported theme pack');

    expect(fs.existsSync(exportPath)).toBe(true);
    const exported = fs.readFileSync(exportPath, 'utf8');
    expect(exported).toContain('"id": "custom:e2e-theme"');

    const deleteBtn = await $('#profile-btn-delete-theme');
    await deleteBtn.waitForClickable({ timeout: 5000 });
    await deleteBtn.click();
    await confirmAction(true);
    await dismissAlert('Deleted theme pack');

    await browser.waitUntil(async () => {
      const body = await $('body');
      return (await body.getAttribute('data-theme')) === 'pastel-pink';
    }, {
      timeout: 5000,
      timeoutMsg: 'Theme did not fall back after deleting the custom pack',
    });

    fs.rmSync(exportPath, { force: true });
  });
});

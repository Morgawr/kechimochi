import path from 'node:path';
import { readFileSync } from 'node:fs';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { renameProfile, uploadProfilePicture } from '../../helpers/profile.js';
import { setCheckbox, setSelect } from '../../helpers/form-controls.js';

function closeEnough(actual: number, expected: number, tolerance = 40): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function readSavedWindowState(): { main: { width: number; height: number; x: number; y: number; maximized: boolean } } {
  const testDirectory = process.env.KECHIMOCHI_DATA_DIR;
  if (!testDirectory) throw new Error('KECHIMOCHI_DATA_DIR is required for the restart CUJ');
  const configRoot = process.platform === 'win32'
    ? path.join(testDirectory, 'appdata')
    : path.join(testDirectory, 'xdg-config');
  const statePath = path.join(configRoot, 'com.morg.kechimochi', '.window-state.json');
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

async function isWindowMaximized(): Promise<boolean> {
  return browser.execute(async () => {
    const invoke = (globalThis as unknown as {
      __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
    }).__TAURI_INTERNALS__.invoke;
    return invoke<boolean>('plugin:window|is_maximized', { label: 'main' });
  });
}

async function waitForSavedMaximizedState(timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      if (readSavedWindowState().main.maximized) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const detail = lastError instanceof Error ? ` Last read failed: ${lastError.message}` : '';
  throw new Error(`Window state was not saved as maximized within ${timeout}ms.${detail}`);
}

async function closeAppAndRelaunch(afterClose?: () => void | Promise<void>): Promise<void> {
  try {
    await $('#win-close').click();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/invalid session id|session (?:deleted|terminated)/i.test(message)) throw error;
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  await afterClose?.();
  await browser.reloadSession();
}

describe('CUJ: Desktop Restart Persistence', () => {
  const profileName = 'RESTART_USER';
  const imageFixture = path.join(
    process.env.KECHIMOCHI_DATA_DIR || path.resolve(process.cwd(), 'e2e', 'fixtures'),
    'covers',
    'profile_placeholder.png',
  );

  before(async () => {
    await waitForAppReady();
  });

  it('persists profile customization and native window state through real close and relaunch', async () => {
    await navigateTo('profile');
    await renameProfile(profileName);
    await uploadProfilePicture(imageFixture);
    await setSelect('#profile-select-theme', { value: 'molokai' });
    await setCheckbox('#profile-checkbox-theme-override', true);
    await setSelect('#profile-select-theme-local', { value: 'purple' });

    await browser.setWindowRect(120, 90, 940, 760);
    const expectedRect = await browser.getWindowRect();
    await browser.pause(500);

    await closeAppAndRelaunch();
    await waitForAppReady(30000, { normalizeWindow: false });

    const savedRect = readSavedWindowState().main;
    expect(savedRect.width).toBe(expectedRect.width);
    expect(savedRect.height).toBe(expectedRect.height);
    expect(closeEnough(savedRect.x, expectedRect.x)).toBe(true);
    expect(closeEnough(savedRect.y, expectedRect.y)).toBe(true);

    await navigateTo('profile');
    expect(await $('#profile-name').getText()).toBe(profileName);
    expect(await $('#profile-checkbox-theme-override').isSelected()).toBe(true);
    expect(await $('#profile-select-theme-local').getValue()).toBe('purple');
    expect(await $('body').getAttribute('data-theme')).toBe('purple');
    await $('#profile-hero-avatar img').waitForDisplayed({ timeout: 10000 });

    await $('#win-max').click();
    await browser.waitUntil(isWindowMaximized, {
      timeout: 10000,
      interval: 100,
      timeoutMsg: 'The native window did not become maximized after using the app window control',
    });
    await closeAppAndRelaunch(waitForSavedMaximizedState);
    await waitForAppReady(30000, { normalizeWindow: false });
    expect(readSavedWindowState().main.maximized).toBe(true);
    await browser.waitUntil(isWindowMaximized, {
      timeout: 10000,
      interval: 100,
      timeoutMsg: 'The native window did not restore its maximized state after relaunch',
    });
    // This CUJ deliberately launches the native application three times. Set the
    // timeout on the test definition so WebdriverIO captures it before execution.
  }).timeout(120_000);
});

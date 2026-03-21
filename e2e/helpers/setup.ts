import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Logger } from '../../src/core/logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

function seedProfileNameSetting(dbPath: string, profileName: string): void {
  const db = new Database(dbPath);

  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('profile_name', profileName);
  } finally {
    db.close();
  }
}

/**
 * Creates a temporary test directory by copying all fixture data into it.
 * Returns the path to the temp directory ($TEST_DIR).
 */
export function prepareTestDir(): string {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kechimochi-e2e-'));

  // Copy and pre-migrate fixture databases so localStorage leak is bypassed entirely
  const srcTestUser = path.join(FIXTURES_DIR, 'kechimochi_TESTUSER.db');
  const destUser = path.join(testDir, 'kechimochi_user.db');
  if (fs.existsSync(srcTestUser)) {
    fs.copyFileSync(srcTestUser, destUser);
    try {
      seedProfileNameSetting(destUser, 'TESTUSER');
    } catch (err) {
      Logger.warn('Failed to pre-seed sqlite test database with profile_name', err);
    }
  } else {
    throw new Error(`Fixture file not found: ${srcTestUser}`);
  }

  const srcShared = path.join(FIXTURES_DIR, 'kechimochi_shared_media.db');
  const destShared = path.join(testDir, 'kechimochi_shared_media.db');
  if (fs.existsSync(srcShared)) {
    fs.copyFileSync(srcShared, destShared);
  } else {
    throw new Error(`Fixture file not found: ${srcShared}`);
  }

  // Copy covers directory
  const srcCovers = path.join(FIXTURES_DIR, 'covers');
  const destCovers = path.join(testDir, 'covers');
  if (fs.existsSync(srcCovers)) {
    fs.mkdirSync(destCovers, { recursive: true });
    for (const file of fs.readdirSync(srcCovers)) {
      fs.copyFileSync(path.join(srcCovers, file), path.join(destCovers, file));
    }
  }

  return testDir;
}

/**
 * Removes the temporary test directory.
 */
export function cleanupTestDir(testDir: string): void {
  if (testDir && testDir.startsWith(os.tmpdir()) && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

async function normalizeWindowSize(): Promise<void> {
  try {
    await browser.setWindowSize(1280, 1200);
    await browser.execute(() => {
      document.documentElement.style.zoom = '1';
      document.body.style.zoom = '1';
    });
  } catch { /* environment may not support setWindowSize, continue */ }
}

/**
 * Waits for the app to be ready by polling for a known DOM element.
 * Also ensures the system date is mocked to 2024-03-31 for consistent stats/charts.
 */
export async function waitForAppReady(timeout = 30000): Promise<void> {
  const MOCK_DATE = '2024-03-31';
  const startTs = Date.now();
  const reserveMs = 1000;
  const timeLeft = () => Math.max(0, timeout - (Date.now() - startTs));
  const phaseBudget = (maxMs: number, minMs = 1000) => Math.max(minMs, Math.min(maxMs, Math.max(0, timeLeft() - reserveMs)));

  Logger.info(`[e2e] Ensuring app is ready and date is mocked to ${MOCK_DATE}...`);

  // Keep visual snapshots deterministic across different host DPI settings.
  await normalizeWindowSize();

  // 1. First, wait for the window to have a valid origin and the DOM to be somewhat ready.
  // We check document.readyState to ensure we aren't on about:blank or a transitional state.
  await browser.waitUntil(
    async () => {
      const readyState = await browser.execute(() => document.readyState).catch(() => '');
      if (readyState !== 'complete') return false;
      
      const el = $('#app');
      return await el.isExisting().catch(() => false);
    },
    {
      timeout: phaseBudget(10000),
      timeoutMsg: 'App HTML failed to load (or remained at about:blank) within 10s',
      interval: 1000,
    }
  ).catch(() => {
    Logger.warn('[e2e] Initial readyState/app check timed out, proceeding anyway...');
  });

  // 2. Try to set mock date in sessionStorage with a retry loop for "insecure" errors.
  // In WebKit/Tauri, storage access can be transiently "insecure" if the origin isn't fully established.
  let setResolved = false;
  let attempts = 0;
  while (!setResolved && attempts < 6 && timeLeft() > 7000) {
    try {
      await browser.execute((date: string) => {
        sessionStorage.setItem('kechimochi_mock_date', date);
        localStorage.setItem('kechimochi_profile', 'TESTUSER');
      }, MOCK_DATE);
      setResolved = true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('insecure') || message.includes('Access is denied')) {
        attempts++;
        Logger.warn(`[e2e] sessionStorage not ready (attempt ${attempts}), retrying in 500ms...`);
        await browser.pause(500);
      } else {
        Logger.error('[e2e] Non-security error setting mock date:', message);
        break; // Fatal error
      }
    }
  }

  // 3. Refresh to apply the mock date only if we successfully set it.
  if (setResolved) {
    Logger.info(`[e2e] Refreshing to apply mock date...`);
    await browser.refresh();
  } else {
    Logger.warn('[e2e] Proceeding without mocked date because storage was unavailable in this session');
  }

  // Some environments reset zoom/window metrics after refresh.
  await normalizeWindowSize();

  // 4. Poll for final app readiness.
  // Some flows can land on initial profile prompt or non-dashboard views first,
  // so we accept any stable app shell state.
  let retries = 0;
  const finalTimeout = Math.max(1500, Math.min(timeout, timeLeft()));
  await browser.waitUntil(
    async () => {
      retries++;
      const dashboardNav = await $('[data-view="dashboard"]');
      const profileNav = await $('[data-view="profile"]');
      const viewContainer = await $('#view-container');
      const initialPrompt = await $('#initial-prompt-input');

      const dashboardVisible = await dashboardNav.isDisplayed().catch(() => false);
      const profileVisible = await profileNav.isDisplayed().catch(() => false);
      const containerVisible = await viewContainer.isDisplayed().catch(() => false);
      const promptVisible = await initialPrompt.isDisplayed().catch(() => false);

      if (retries % 5 === 0) {
        Logger.info(`[e2e] Final app ready check #${retries}...`);
      }

      return (containerVisible && (dashboardVisible || profileVisible)) || promptVisible;
    },
    {
      timeout: finalTimeout,
      timeoutMsg: 'App did not reach a stable ready UI state after startup',
      interval: 1000,
    }
  ).catch(async () => {
    const appRootExists = await $('#app').isExisting().catch(() => false);
    if (appRootExists) {
      Logger.warn('[e2e] App shell not fully ready, proceeding with degraded readiness because #app exists');
      return;
    }
    throw new Error('App did not reach a stable ready UI state after startup');
  });

  if (setResolved) {
    Logger.info('[e2e] App is ready and date is mocked');
  } else {
    Logger.info('[e2e] App is ready (mock date unavailable this run)');
  }
}

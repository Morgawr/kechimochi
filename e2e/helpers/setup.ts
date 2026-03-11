/**
 * Test environment setup/teardown helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

/**
 * Creates a temporary test directory by copying all fixture data into it.
 * Returns the path to the temp directory ($TEST_DIR).
 */
export function prepareTestDir(): string {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kechimochi-e2e-'));

  // Copy fixture databases
  for (const file of ['kechimochi_TESTUSER.db', 'kechimochi_shared_media.db']) {
    const src = path.join(FIXTURES_DIR, file);
    const dest = path.join(testDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      throw new Error(`Fixture file not found: ${src}. Did you run 'npm run e2e:seed'?`);
    }
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

/**
 * Waits for the app to be ready by polling for a known DOM element.
 * Also ensures the system date is mocked to 2024-03-31 for consistent stats/charts.
 */
export async function waitForAppReady(timeout = 30000): Promise<void> {
  const MOCK_DATE = '2024-03-31';
  console.log(`[e2e] Ensuring app is ready and date is mocked to ${MOCK_DATE}...`);

  // Keep visual snapshots deterministic across different host DPI settings.
  try {
    await (browser as any).setWindowSize(1280, 1200);
    await (browser as any).execute(() => {
      document.documentElement.style.zoom = '1';
      (document.body as HTMLElement).style.zoom = '1';
    });
  } catch (e) {
    console.warn('[e2e] Failed to normalize window size/zoom:', e);
  }

  // 1. First, wait for the window to have a valid origin and the DOM to be somewhat ready.
  // We check document.readyState to ensure we aren't on about:blank or a transitional state.
  await (browser as any).waitUntil(
    async () => {
      const readyState = await (browser as any).execute(() => document.readyState).catch(() => '');
      if (readyState !== 'complete') return false;
      
      const el = await $('#app');
      return await el.isExisting().catch(() => false);
    },
    {
      timeout: 10000,
      timeoutMsg: 'App HTML failed to load (or remained at about:blank) within 10s',
      interval: 1000,
    }
  ).catch(() => {
    console.warn('[e2e] Initial readyState/app check timed out, proceeding anyway...');
  });

  // 2. Try to set mock date in sessionStorage with a retry loop for "insecure" errors.
  // In WebKit/Tauri, storage access can be transiently "insecure" if the origin isn't fully established.
  let setResolved = false;
  let attempts = 0;
  while (!setResolved && attempts < 10) {
    try {
      await (browser as any).execute((date: string) => {
        sessionStorage.setItem('kechimochi_mock_date', date);
      }, MOCK_DATE);
      setResolved = true;
    } catch (e: any) {
      if (e.message.includes('insecure')) {
        attempts++;
        console.warn(`[e2e] sessionStorage access insecure (attempt ${attempts}), retrying in 1s...`);
        await browser.pause(1000);
      } else {
        console.error('[e2e] Non-security error setting mock date:', e.message);
        break; // Fatal error
      }
    }
  }

  // 3. Refresh to apply the mock date
  console.log(`[e2e] Refreshing to apply mock date...`);
  await (browser as any).refresh();

  // Some environments reset zoom/window metrics after refresh.
  try {
    await (browser as any).setWindowSize(1280, 1200);
    await (browser as any).execute(() => {
      document.documentElement.style.zoom = '1';
      (document.body as HTMLElement).style.zoom = '1';
    });
  } catch (e) {
    console.warn('[e2e] Failed to re-apply window size/zoom after refresh:', e);
  }

  // 4. Poll for final app readiness (dashboard view visible)
  let retries = 0;
  await (browser as any).waitUntil(
    async () => {
      retries++;
      const el = await $('[data-view="dashboard"]');
      const displayed = await el.isDisplayed().catch(() => false);

      if (retries % 5 === 0) {
        console.log(`[e2e] Final app ready check #${retries}...`);
      }

      return displayed;
    },
    {
      timeout,
      timeoutMsg: 'App did not become ready (dashboard not visible) after refresh',
      interval: 1000,
    }
  );

  console.log('[e2e] App is ready and date is mocked');
}

/**
 * Web (Chrome / web_server) WebdriverIO configuration.
 *
 * Runs the shared + web-exclusive specs via chromedriver against the
 * web_server Rust binary.  WDIO v9 manages the chromedriver binary
 * automatically via @puppeteer/browsers — no separate install needed.
 *
 * Port layout (all disjoint for safe parallel runs):
 *   web_server instances:  8000 + workerIndex  (see web-driver.ts)
 *   chromedriver:          auto-assigned by WDIO via getPort()
 *   desktop tauri-driver:  4444 + workerIndex  (never used here)
 *
 * baseUrl is patched by the custom beforeSession below so that
 * browser.url('/') in specs resolves to the correct web_server origin.
 * webDriver.start() (called from the base config's beforeSession) sets
 * process.env.WEB_SERVER_URL before any spec accesses browser.url().
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairIncompleteWebdriverCache } from '../helpers/webdriver-cache.js';
import { webDriver } from '../drivers/web-driver.js';
import { Logger } from '../../src/logger.js';
import { makeConfig } from './wdio.base.conf.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const webdriverCacheDirectory = process.env.KECHIMOCHI_WEBDRIVER_CACHE_DIR
  || path.join(__dirname, '..', '..', 'node_modules', '.cache', 'kechimochi-webdriver');

for (const removedDirectory of repairIncompleteWebdriverCache(webdriverCacheDirectory)) {
  Logger.warn(`[e2e] Removed incomplete WebDriver cache entry: ${removedDirectory}`);
}

process.env.E2E_PLATFORM = 'web';

const baseConfig = makeConfig(webDriver, ['shared/**', 'non-mobile/**', 'web/**']);

// Cache the base beforeSession so we can wrap it.
const baseBeforeSession = baseConfig.beforeSession as (
  (wdioConfig: unknown, caps: Record<string, unknown>, specs: string[]) => Promise<void>
) | undefined;

export const config: WebdriverIO.Config = {
  ...baseConfig,

  // Keep browser downloads scoped to this checkout. Before WDIO inspects the
  // cache, remove half-extracted installs that its downloader cannot repair.
  cacheDir: webdriverCacheDirectory,

  // No hostname/port set: WDIO v9 only auto-manages chromedriver when no custom
  // connection is configured. The base config leaves the connection unset, so
  // web inherits that and chromedriver self-manages.

  // Placeholder — overridden per-session in our beforeSession wrapper below.
  baseUrl: 'http://127.0.0.1:8000',

  capabilities: [{
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    },
  } as WebdriverIO.Capabilities],

  beforeSession: async (wdioConfig: unknown, caps: Record<string, unknown>, specs: string[]) => {
    // Run the base config's beforeSession first (starts web_server, writes env).
    if (baseBeforeSession) {
      await baseBeforeSession(wdioConfig, caps, specs);
    }

    // Patch the live config object so browser.url('/') resolves to the
    // web_server URL that was just started.
    const serverUrl = process.env.WEB_SERVER_URL;
    if (serverUrl) {
      (wdioConfig as WebdriverIO.Config).baseUrl = serverUrl;
    }
  },
};

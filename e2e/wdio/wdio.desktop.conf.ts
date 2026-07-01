/**
 * Desktop (Tauri / WebKit) WebdriverIO configuration.
 *
 * Runs the shared + desktop-only specs via tauri-driver.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeConfig } from './wdio.base.conf.js';
import { desktopDriver, TAURI_DRIVER_BASE_PORT } from '../drivers/desktop-driver.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

process.env.E2E_PLATFORM = 'desktop';

const baseConfig = makeConfig(desktopDriver, ['shared/**', 'non-mobile/**', 'desktop/**']);

export const config: WebdriverIO.Config = {
  ...baseConfig,

  // Desktop connects to tauri-driver; port is overridden per session in
  // beforeSession by the desktop driver, but we seed the base value here.
  hostname: '127.0.0.1',
  port: TAURI_DRIVER_BASE_PORT,

  capabilities: [{
    'tauri:options': {
      application: path.resolve(
        __dirname, '..', '..', 'src-tauri', 'target', 'debug', 'kechimochi',
      ),
    },
  } as WebdriverIO.Capabilities],
};
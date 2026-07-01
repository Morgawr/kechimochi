/**
 * Android (Appium / UiAutomator2) WDIO config — runs the shared + android specs
 * against the debug APK. Target via ANDROID_E2E_TARGET (see android-driver.ts).
 *
 * Local prerequisites: Android SDK + ANDROID_HOME; a booted AVD; Appium on
 * :4723 (`npx appium`); debug APK (`npm run tauri -- android build --apk --debug`).
 */

import path from 'node:path';
import { makeConfig } from './wdio.base.conf.js';
import { androidDriver, resolveAppiumConnection, ensureEmulatorHealthy } from '../drivers/android-driver.js';
import { ensureAndroidWebContext } from '../helpers/common.js';

process.env.E2E_PLATFORM = 'android';

const baseConfig = makeConfig(androidDriver, ['shared/**', 'android/**']);

const connection = resolveAppiumConnection();

const apkPath = process.env.ANDROID_APK_PATH
  ?? 'src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk';

export const config: WebdriverIO.Config = {
  ...baseConfig,

  hostname: connection.hostname,
  port: connection.port,
  protocol: connection.protocol as 'http' | 'https',

  // Appium requires maxInstances=1 for emulator runs to avoid AVD conflicts.
  maxInstances: 1,
  specFileRetries: 1,
  logLevel: 'silent',

  // Session creation (app + UiAutomator2 install on a slow CI emulator) exceeds WDIO's 120 s default.
  connectionRetryTimeout: 300000,

  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': apkPath,
    'appium:noReset': false,
    'appium:fullReset': true,
    // Don't auto-launch: the `before` hook seeds the sandbox first, then launches.
    'appium:autoLaunch': false,
    'appium:newCommandTimeout': 90,
    // Generous install/launch timeouts for the slow CI emulator.
    'appium:androidInstallTimeout': 180000,
    'appium:uiautomator2ServerInstallTimeout': 120000,
    'appium:uiautomator2ServerLaunchTimeout': 120000,
    'appium:adbExecTimeout': 60000,
    ...(connection.user ? { 'appium:user': connection.user } : {}),
    ...(connection.key ? { 'appium:accessKey': connection.key } : {}),
  } as WebdriverIO.Capabilities],

  mochaOpts: {
    ...baseConfig.mochaOpts,
    // Longer timeout for cold-boot emulator sessions.
    timeout: 120000,
  },

  // Launcher hook, not beforeSession: the restart counter in android-driver
  // must persist across specs, and WDIO spawns a fresh worker per spec file.
  onWorkerStart: async (_cid: string, _capabilities: WebdriverIO.Capabilities, specs: string[]) => {
    const specName = path.basename(specs[0], '.spec.ts');
    await ensureEmulatorHealthy(specName);
  },

  // Must be `before`, not a config beforeEach: shared specs' own hooks touch the
  // DOM first, so the WebView context has to be live before any spec hook runs.
  before: async () => {
    await androidDriver.seedSession();
    await ensureAndroidWebContext();
  },
};
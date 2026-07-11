/**
 * Android platform driver — drives an Appium session against a local emulator
 * (ANDROID_E2E_TARGET=emulator, the default) or a remote grid (=remote).
 *
 * Remote grid env vars: APPIUM_HOST (required), APPIUM_PORT (443),
 * APPIUM_PROTOCOL (https), APPIUM_USER, APPIUM_KEY.
 *
 * NOT compatible with Firebase Test Lab — FTL runs APK-packaged instrumentation
 * tests, not a live Appium grid.
 */

import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { Logger } from '../../src/logger';
import type { PlatformDriver, DriverStartContext } from './types.js';

const execFileAsync = promisify(execFile);

// ── Appium port constants ──────────────────────────────────────────────────
export const APPIUM_LOCAL_PORT = 4723;

// ── Emulator health-check tuning ────────────────────────────────────────────
const EMULATOR_RECOVERY_TIMEOUT_MS = 60000;
const EMULATOR_BOOT_TIMEOUT_MS = 300000;
const EMULATOR_POLL_INTERVAL_MS = 2000;
const ANDROID_DEBUG_BRIDGE_TIMEOUT_MS = 30000;
const MAX_EMULATOR_RESTARTS = 2;
const DEFAULT_EMULATOR_PORT = '5554';

/** Tauri app identifier (src-tauri/tauri.conf.json); run-as / pushFile target. */
export const ANDROID_PACKAGE_ID = 'com.morg.kechimochi';

interface MobileBrowser {
  pushFile: (remotePath: string, base64Data: string) => Promise<void>;
  activateApp: (appId: string) => Promise<void>;
}

function listFilesRecursive(rootDirectory: string): string[] {
  const relativeFiles: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) relativeFiles.push(path.relative(rootDirectory, fullPath));
    }
  };
  walk(rootDirectory);
  return relativeFiles;
}

// ── Helpers ────────────────────────────────────────────────────────────────
type AndroidTarget = 'emulator' | 'remote';

function resolveTarget(): AndroidTarget {
  const value = process.env.ANDROID_E2E_TARGET;
  if (value === 'remote') return 'remote';
  return 'emulator';
}

interface AppiumConnectionOptions {
  hostname: string;
  port: number;
  protocol: string;
  user?: string;
  key?: string;
}

function resolveConnectionOptions(): AppiumConnectionOptions {
  const target = resolveTarget();

  if (target === 'emulator') {
    return {
      hostname: '127.0.0.1',
      port: APPIUM_LOCAL_PORT,
      protocol: 'http',
    };
  }

  const hostname = process.env.APPIUM_HOST;
  if (!hostname) {
    throw new Error(
      'ANDROID_E2E_TARGET=remote requires APPIUM_HOST to be set. ' +
      'See e2e/drivers/android-driver.ts for the full list of env vars.',
    );
  }

  return {
    hostname,
    port: Number.parseInt(process.env.APPIUM_PORT || '443', 10),
    protocol: process.env.APPIUM_PROTOCOL || 'https',
    user: process.env.APPIUM_USER,
    key: process.env.APPIUM_KEY,
  };
}

// ── PlatformDriver implementation ──────────────────────────────────────────

interface AndroidDriver extends PlatformDriver {
  seedSession(): Promise<void>;
}

export const androidDriver: AndroidDriver = {

  async start(context: DriverStartContext): Promise<number> {
    const { specName, stageDirectory } = context;
    const connection = resolveConnectionOptions();
    const target = resolveTarget();

    const logFile = path.join(stageDirectory, 'android-driver.log');

    if (existsSync(stageDirectory)) {
      appendFileSync(logFile, [
        `[e2e] [${specName}] Android driver starting`,
        `  target: ${target}`,
        `  appium: ${connection.protocol}://${connection.hostname}:${connection.port}`,
        '',
      ].join('\n'));
    }

    Logger.info(
      `[e2e] [${specName}] Android driver: target=${target}, ` +
      `appium=${connection.protocol}://${connection.hostname}:${connection.port}`,
    );

    return connection.port;
  },

  async stop(): Promise<void> {
    // Appium lifecycle is owned by CI; nothing to tear down here.
    Logger.info('[e2e] Android driver stopped (Appium session closed by WDIO).');
  },

  injectEnv(_caps: Record<string, unknown>, _env: Record<string, string>): void {
    // No-op: the sandbox path is fixed and can't be set via caps/env; seeding
    // happens in seedSession() instead.
  },

  // autoLaunch=false lets us push the seed into the sandbox before first launch,
  // so startup reads it. No seed data → fresh install.
  async seedSession(): Promise<void> {
    const mobile = browser as unknown as MobileBrowser;
    const dataDirectory = process.env.KECHIMOCHI_DATA_DIR;
    const relativeFiles = dataDirectory && existsSync(dataDirectory)
      ? listFilesRecursive(dataDirectory)
      : [];

    if (!dataDirectory || relativeFiles.length === 0) {
      await mobile.activateApp(ANDROID_PACKAGE_ID);
      Logger.info('[e2e] [android-seed] No seed data (fresh-install) — app launched as-is.');
      return;
    }

    for (const relativeFile of relativeFiles) {
      const normalizedRelative = relativeFile.split(path.sep).join('/');
      const remotePath = `@${ANDROID_PACKAGE_ID}/${normalizedRelative}`;
      const base64Data = readFileSync(path.join(dataDirectory, relativeFile)).toString('base64');
      await mobile.pushFile(remotePath, base64Data);
      Logger.info(`[e2e] [android-seed] pushed ${normalizedRelative} → ${remotePath}`);
    }

    await mobile.activateApp(ANDROID_PACKAGE_ID);
  },
};

export function resolveAppiumConnection(): AppiumConnectionOptions {
  return resolveConnectionOptions();
}

// ── Emulator health check ───────────────────────────────────────────────────

async function runAndroidDebugBridgeCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('adb', args, { timeout: ANDROID_DEBUG_BRIDGE_TIMEOUT_MS });
  return stdout.trim();
}

async function isEmulatorReady(): Promise<boolean> {
  try {
    const devices = await runAndroidDebugBridgeCommand(['devices']);
    const hasReadyDevice = devices
      .split('\n')
      .slice(1)
      .some(line => /\tdevice$/.test(line.trim()));
    if (!hasReadyDevice) return false;

    const bootCompleted = await runAndroidDebugBridgeCommand(['shell', 'getprop', 'sys.boot_completed']);
    return bootCompleted === '1';
  } catch {
    return false;
  }
}

/** Serial listed at all (even if offline) — false once the process is gone. */
async function isEmulatorSerialPresent(): Promise<boolean> {
  try {
    const devices = await runAndroidDebugBridgeCommand(['devices']);
    return devices
      .split('\n')
      .slice(1)
      .some(line => line.trim().startsWith('emulator-'));
  } catch {
    return false;
  }
}

async function resolveEmulatorBinaryPath(): Promise<string> {
  try {
    await execFileAsync('which', ['emulator']);
    return 'emulator';
  } catch {
    const androidSdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
    return androidSdkRoot ? path.join(androidSdkRoot, 'emulator', 'emulator') : 'emulator';
  }
}

// Module scope so it survives across specs: read from the launcher-persistent
// onWorkerStart hook, not a per-spec worker hook (which would reset each spec).
let emulatorRestartCount = 0;
let emulatorDead = false;

async function reconnectEmulator(specName: string): Promise<void> {
  await runAndroidDebugBridgeCommand(['reconnect', 'offline']).catch(() => {});
  await runAndroidDebugBridgeCommand(['start-server']).catch(() => {});

  const deadline = Date.now() + EMULATOR_RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isEmulatorReady()) {
      Logger.info(`[e2e] [${specName}] Emulator reconnected — proceeding with session.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, EMULATOR_POLL_INTERVAL_MS));
  }

  Logger.error(
    `[e2e] [${specName}] Emulator did not reconnect within ${EMULATOR_RECOVERY_TIMEOUT_MS} ms; ` +
    'letting session creation fail so specFileRetries can requeue.',
  );
}

async function restartEmulator(specName: string): Promise<void> {
  if (emulatorRestartCount >= MAX_EMULATOR_RESTARTS) {
    emulatorDead = true;
    Logger.error(
      `[e2e] [${specName}] Emulator restart cap (${MAX_EMULATOR_RESTARTS}) reached; ` +
      'marking the emulator dead — remaining specs will fail fast.',
    );
    return;
  }

  const avdName = process.env.AVD_NAME;
  if (!avdName) {
    emulatorDead = true;
    Logger.error(`[e2e] [${specName}] AVD_NAME is not set; cannot relaunch the emulator.`);
    return;
  }

  emulatorRestartCount += 1;
  Logger.warn(
    `[e2e] [${specName}] Emulator serial missing — restarting ` +
    `(attempt ${emulatorRestartCount}/${MAX_EMULATOR_RESTARTS}).`,
  );

  const emulatorPort = process.env.EMULATOR_PORT || DEFAULT_EMULATOR_PORT;
  const emulatorOptions = (process.env.EMULATOR_OPTIONS || '').split(' ').filter(Boolean);

  await runAndroidDebugBridgeCommand(['-s', `emulator-${emulatorPort}`, 'emu', 'kill']).catch(() => {});
  await execFileAsync('pkill', ['-9', '-f', 'qemu-system']).catch(() => {});

  const emulatorBinary = await resolveEmulatorBinaryPath();
  const relaunchedEmulator = spawn(
    emulatorBinary,
    ['-avd', avdName, '-port', emulatorPort, ...emulatorOptions],
    { detached: true, stdio: 'ignore' },
  );
  relaunchedEmulator.unref();

  await runAndroidDebugBridgeCommand(['wait-for-device']).catch(() => {});

  const deadline = Date.now() + EMULATOR_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isEmulatorReady()) {
      Logger.info(`[e2e] [${specName}] Emulator relaunched and booted — proceeding with session.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, EMULATOR_POLL_INTERVAL_MS));
  }

  emulatorDead = true;
  Logger.error(
    `[e2e] [${specName}] Emulator did not cold-boot within ${EMULATOR_BOOT_TIMEOUT_MS} ms; ` +
    'marking the emulator dead — remaining specs will fail fast.',
  );
}

/**
 * Pre-session guard against the single-crash cascade. Offline serial → adb
 * reconnect; missing serial (dead process) → capped relaunch; past the cap the
 * emulator is flagged dead and later specs fail fast instead of dead-waiting.
 */
export async function ensureEmulatorHealthy(specName: string): Promise<void> {
  if (resolveTarget() !== 'emulator') return;

  if (emulatorDead) {
    Logger.error(
      `[e2e] [${specName}] Emulator previously marked dead after ${MAX_EMULATOR_RESTARTS} failed restarts — failing fast.`,
    );
    return;
  }

  if (await isEmulatorReady()) return;

  Logger.warn(`[e2e] [${specName}] Emulator not ready before session — attempting recovery.`);

  if (await isEmulatorSerialPresent()) {
    await reconnectEmulator(specName);
  } else {
    await restartEmulator(specName);
  }
}
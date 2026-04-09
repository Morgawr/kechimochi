/**
 * WebdriverIO configuration for kechimochi e2e tests.
 */

import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { prepareTestDir, cleanupTestDir, E2E_PACKAGE_VERSION } from './helpers/setup.js';
import { startSyncMockServer, stopSyncMockServer } from './helpers/sync-mock.js';
import { Logger } from '../src/core/logger';

interface TauriSessionCaps {
    port?: number;
    'tauri:options': {
    args?: string[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const STABLE_RUN_ID = process.env.TEST_RUN_ID || new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-').slice(0, 19);
const LOGS_DIR = path.join(__dirname, 'logs', `test_run_${STABLE_RUN_ID}`);

if (process.env.TEST_RUN_ID) {
    Logger.info(`[e2e] Worker process using inherited TEST_RUN_ID: ${STABLE_RUN_ID}`);
}

let tauriDriver: ChildProcess;
let tauriDriverExitCode: number | null | undefined;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 3000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(250);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });

    if (isOpen) {
      return;
    }

    await delay(100);
  }

  throw new Error(`tauri-driver did not open port ${port} within ${timeoutMs}ms`);
}

function resolveTauriDriverCommand(): string {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || '';
    const cargoBin = path.join(userProfile, '.cargo', 'bin', 'tauri-driver.exe');
    if (userProfile && existsSync(cargoBin)) {
      return cargoBin;
    }
  }
  return 'tauri-driver';
}

function resolveNativeDriverPath(): string | null {
  if (process.env.EDGE_DRIVER_PATH && existsSync(process.env.EDGE_DRIVER_PATH)) {
    return process.env.EDGE_DRIVER_PATH;
  }
  if (process.env.WEBKIT_DRIVER_PATH && existsSync(process.env.WEBKIT_DRIVER_PATH)) {
    return process.env.WEBKIT_DRIVER_PATH;
  }

  if (process.platform === 'win32') {
    const local = path.resolve(__dirname, '..', 'node_modules', '.bin', 'edgedriver.cmd');
    if (existsSync(local)) return local;
  } else {
    // Linux/macOS
    const systemWebKit = '/usr/bin/WebKitWebDriver';
    if (existsSync(systemWebKit)) return systemWebKit;

    const local = path.resolve(__dirname, '..', 'node_modules', '.bin', 'edgedriver');
    if (existsSync(local)) return local;
  }

  return null;
}

// Ensure tauri-driver is closed even on unexpected exits
function onShutdown(fn: () => void) {
  const cleanup = () => {
    try { fn(); } finally { process.exit(); }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

onShutdown(() => { tauriDriver?.kill(); });

async function moveArtifactsToFinalDir(stageDir: string, specName: string, finalDir: string): Promise<void> {
  const { mkdirSync, existsSync, cpSync, rmSync, readdirSync } = await import('node:fs');
  if (!existsSync(stageDir)) return;
  try {
    const stagedFiles = readdirSync(stageDir, { recursive: true });
    Logger.info(`[e2e] [${specName}] Staging area contains: ${stagedFiles.join(', ')}`);
    mkdirSync(finalDir, { recursive: true });
    cpSync(stageDir, finalDir, { recursive: true });
    rmSync(stageDir, { recursive: true, force: true });
  } catch (err) {
    Logger.error(`[e2e] [${specName}] Failed to move artifacts:`, err);
  }
}

async function seedSyncBackupManagementFixture(testDir: string): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const syncDir = path.join(testDir, 'sync');
  const syncConfigPath = path.join(syncDir, 'sync_config.json');

  mkdirSync(syncDir, { recursive: true });
  writeFileSync(syncConfigPath, JSON.stringify({
    sync_profile_id: 'prof_e2e_test',
    profile_name: 'E2E Test Profile',
    google_account_email: 'test@example.com',
    remote_manifest_name: 'kechimochi-manifest-prof_e2e_test.json',
    last_sync_status: 'clean',
    device_name: 'E2E Device',
  }));

  writeFileSync(path.join(syncDir, 'pre_sync_backup_1.zip'), Buffer.alloc(1024 * 1024));
  writeFileSync(path.join(syncDir, 'pre_sync_backup_2.zip'), Buffer.alloc(1024 * 1024));
  writeFileSync(path.join(syncDir, 'important_data.txt'), 'do not touch');
}

function buildAppOverrideArgs(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `--kechimochi-env=${key}=${value}`);
}

export const config: WebdriverIO.Config = {
  // ==================
  // Runner Configuration
  // ==================
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,

  // ==================
  // Specs
  // ==================
  specs: [
    path.join(__dirname, 'specs', '**', '*.spec.ts'),
  ],

  // ==================
  // Capabilities
  // ==================
  maxInstances: Number.parseInt(process.env.E2E_MAX_INSTANCES || '2', 10),
  capabilities: [{
    'tauri:options': {
      application: path.resolve(
        __dirname, '..', 'src-tauri', 'target', 'debug', 'kechimochi'
      ),
    },
  } as WebdriverIO.Capabilities],

  // ==================
  // Test Configuration
  // ==================
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // ==================
  // Services
  // ==================
  services: [
    // Visual regression testing
    ['visual', {
      baselineFolder: path.join(__dirname, 'screenshots', 'baseline'),
      formatImageName: '{tag}',
      // We force exact absolute paths in interactions.ts to avoid "Ghost folders"
      savePerInstance: false,
      autoSaveBaseline: true,
      blockOutStatusBar: true,
      blockOutToolBar: true,
      clearRuntimeFolder: false, // Set to false to prevent it from clearing our custom dirs
      misMatchTolerance: 10,
      compareOptions: {
        threshold: 0.5,
        includeAA: true,
      },
      // FORCE no subfolders by zeroing out segments
      companyName: '',
      projectName: '',
      browserName: '',
      browserVersion: '',
    }],
    // OCR text recognition
    ['ocr', {
      contrast: 0.25,
      imagesFolder: path.join(os.tmpdir(), 'kechimochi-ocr-junk'),
    }],
  ],

  // ==================
  // Hooks
  // ==================

  /**
   * Prepare the isolated test data directory before any session starts.
   */
  onPrepare: async () => {
    // Ensure logs directory exists
    const { mkdirSync } = await import('node:fs');
    mkdirSync(LOGS_DIR, { recursive: true });
    process.env.TEST_RUN_ID = STABLE_RUN_ID;

    Logger.info(`[e2e] Test run ID: ${STABLE_RUN_ID}`);
    Logger.info(`[e2e] Logs directory: ${LOGS_DIR}`);
  },

  /**
   * Spawn tauri-driver right before each WebDriver session.
   * This is the correct hook per the official Tauri docs.
   */
  beforeSession: async (_config: unknown, caps: TauriSessionCaps, specs: string[]) => {
    const specFile = specs[0];
    const specName = path.basename(specFile, '.spec.ts');
    const isUpdateSpec = specName === 'update-notifications';
    const isSyncSpec = specName === 'cloud-sync' || specName === 'startup-cloud-sync';
    const isSyncBackupManagementSpec = specName === 'sync-backup-management';
    const isStartupSchemaMismatchSpec = specName === 'startup-schema-mismatch';
    const isFreshInstallSpec = specName === 'startup-cloud-sync';
    
    // 1. Isolated Data Directory for this session
    const testDir = prepareTestDir({
      extraSettings: isUpdateSpec
        ? {
            updates_auto_check_enabled: 'true',
            updates_last_seen_release_version: '0.0.1',
            updates_e2e_release_version: E2E_PACKAGE_VERSION,
          }
        : undefined,
      overrideSchemaVersion: isStartupSchemaMismatchSpec ? 999 : undefined,
      freshInstall: isFreshInstallSpec,
    });
    process.env.KECHIMOCHI_DATA_DIR = testDir;

    if (isSyncBackupManagementSpec) {
      await seedSyncBackupManagementFixture(testDir);
    }

    let syncEnv: Record<string, string> = {};
    if (isSyncSpec || isSyncBackupManagementSpec) {
      // Force a file-backed token store so CI does not depend on desktop keyring availability.
      syncEnv = {
        KECHIMOCHI_SYNC_TEST_TOKEN_STORE_PATH: path.join(testDir, 'e2e_google_tokens.json'),
      };
    }
    if (isFreshInstallSpec) {
      syncEnv = {
        ...syncEnv,
        KECHIMOCHI_E2E_SKIP_LEGACY_LOCAL_PROFILE_MIGRATION: '1',
      };
    }
    if (isSyncSpec) {
      const syncMock = await startSyncMockServer();
      syncEnv = {
        ...syncEnv,
        KECHIMOCHI_GOOGLE_CLIENT_ID: syncMock.clientId,
        KECHIMOCHI_GOOGLE_AUTH_ENDPOINT: syncMock.authEndpoint,
        KECHIMOCHI_GOOGLE_TOKEN_ENDPOINT: syncMock.tokenEndpoint,
        KECHIMOCHI_GOOGLE_DRIVE_API_BASE_URL: syncMock.driveApiBaseUrl,
        KECHIMOCHI_GOOGLE_DRIVE_UPLOAD_BASE_URL: syncMock.driveUploadBaseUrl,
        KECHIMOCHI_SYNC_TEST_AUTO_OPEN: '1',
      };
      Logger.info(`[e2e] [${specName}] Using local sync mock server at ${syncMock.baseUrl}`);
    }

    // 2. Dynamic Port Assignment (offset by worker ID)
    // WDIO_WORKER_ID looks like "0-0", "0-1", etc.
    const workerIndex = Number.parseInt(process.env.WDIO_WORKER_ID?.split('-')[1] || '0', 10);
    const tauriDriverPort = 4444 + workerIndex;
    const nativeDriverPort = 5555 + workerIndex;
    
    // Update capability port so WDIO connects to the correct driver
    config.port = tauriDriverPort;
    caps.port = tauriDriverPort;

    // 3. Create a transient staging directory in /tmp
    const STAGE_DIR = path.join(os.tmpdir(), `kechimochi-e2e-${randomUUID()}`);
    const { mkdirSync, appendFileSync, existsSync } = await import('node:fs');
    mkdirSync(STAGE_DIR, { recursive: true });

    process.env.SPEC_STAGE_DIR = STAGE_DIR;
    process.env.SPEC_NAME = specName;

    // 4. Pass isolated overrides to the app via CLI args because tauri-driver does not forward envs.
    caps['tauri:options'].args = [
      ...(caps['tauri:options'].args ?? []),
      ...buildAppOverrideArgs({
        KECHIMOCHI_DATA_DIR: testDir,
        ...syncEnv,
      }),
    ];

    // 5. Proactively create the requested subfolders
    mkdirSync(path.join(STAGE_DIR, 'visual', 'actual'), { recursive: true });
    mkdirSync(path.join(STAGE_DIR, 'visual', 'diff'), { recursive: true });
    mkdirSync(path.join(STAGE_DIR, 'ocr'), { recursive: true });

    const logFile = path.join(STAGE_DIR, 'tauri-driver.log');
    appendFileSync(logFile, `[e2e] [${specName}] Session Started at ${new Date().toISOString()}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Worker ID: ${process.env.WDIO_WORKER_ID}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Staging Dir: ${STAGE_DIR}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Data Dir: ${testDir}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Driver Port: ${tauriDriverPort}\n\n`);

    // Helper to log safely even if stageDir disappears during move
    const log = (msg: string | Buffer) => {
      if (existsSync(STAGE_DIR)) {
        try { appendFileSync(logFile, msg); } catch { /* ignore transient fs errors */ }
      }
    };

    Logger.info(`\n[e2e] [${specName}] Worker ${process.env.WDIO_WORKER_ID} starting...`);
    Logger.info(`[e2e] [${specName}] Port: ${tauriDriverPort}, Data: ${testDir}`);

    // 5. Spawn driver
    const nativeDriverPath = resolveNativeDriverPath();
    const tauriDriverArgs = [
      '--port', tauriDriverPort.toString(),
      '--native-port', nativeDriverPort.toString(),
    ];
    if (nativeDriverPath) {
      tauriDriverArgs.push('--native-driver', nativeDriverPath);
    }

    tauriDriver = spawn(
      resolveTauriDriverCommand(),
      tauriDriverArgs,
      {
        stdio: [null, 'pipe', 'pipe'],
        env: {
          ...process.env,
          KECHIMOCHI_DATA_DIR: testDir,
          ...syncEnv,
          RUST_LOG: 'debug',
          TAURI_DEBUG: '1'
        },
      }
    );

    tauriDriver.stdout?.on('data', log);
    tauriDriver.stderr?.on('data', log);

    // Wait for driver
    Logger.info(`[e2e] [${specName}] Waiting for tauri-driver on port ${tauriDriverPort}...`);
    await waitForPort(tauriDriverPort, '127.0.0.1', 3000);

    tauriDriver.on('error', (error: Error) => {
      Logger.error(`[e2e] [${specName}] tauri-driver error:`, error);
      log(`[e2e] tauri-driver error: ${error.message}\n`);
      process.exit(1);
    });

    tauriDriver.on('exit', (code: number | null) => {
      Logger.info(`[e2e] [${specName}] tauri-driver process exited with code: ${code}`);
      log(`[e2e] tauri-driver process exited with code: ${code}\n`);
      tauriDriverExitCode = code;
    });
  },

  /**
   * Move staged artifacts to final destination and kill driver.
   */
  afterSession: async () => {
    // 1. Signal driver to stop
    if (tauriDriver) {
      const { appendFileSync } = await import('node:fs');
      tauriDriver.kill('SIGTERM');

      // 2. WAIT for it to actually die before moving files
      let attempts = 0;
      while (tauriDriverExitCode === undefined && attempts < 15) {
        await delay(200);
        attempts++;
      }

      const stageDir = process.env.SPEC_STAGE_DIR;
      if (stageDir) {
        const logFile = path.join(stageDir, 'tauri-driver.log');
        const finalCode = tauriDriverExitCode;
        try { appendFileSync(logFile, `\n[e2e] Session Complete with exit code: ${finalCode}\n`); } catch { /* ignore transient fs errors */ }
      }
    }

    const stageDir = process.env.SPEC_STAGE_DIR;
    const specName = process.env.SPEC_NAME;
    const finalDir = path.join(LOGS_DIR, specName || 'unknown');

    if (stageDir && specName) {
      await moveArtifactsToFinalDir(stageDir, specName, finalDir);
    }

    await stopSyncMockServer();

    // 3. Clean up the isolated data directory
    const testDir = process.env.KECHIMOCHI_DATA_DIR;
    if (testDir && specName) {
      cleanupTestDir(testDir);
      Logger.info(`[e2e] [${specName}] Cleaned up isolated data directory: ${testDir}`);
    }
  },

  /**
   * After each test, capture screenshot on failure.
   */
  afterTest: async (test: { title?: string }, _context: unknown, { passed }: { passed: boolean }) => {
    if (!passed) {
      const stageDir = process.env.SPEC_STAGE_DIR;
      if (stageDir) {
        const sanitizedTitle = (test.title || 'unknown').replaceAll(/[^a-zA-Z0-9]/g, '_');
        const failDir = path.join(stageDir, 'failures');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(failDir, { recursive: true });
        await browser.saveScreenshot(path.join(failDir, `${sanitizedTitle}.png`));
      }
    }
  },

  /**
   * Clean up the temp test directory after the full run.
   */
  onComplete: () => {
    // No-op: Isolation directories are now cleaned up in afterSession
  },
};

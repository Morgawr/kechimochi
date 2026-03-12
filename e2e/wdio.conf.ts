/**
 * WebdriverIO configuration for kechimochi e2e tests.
 */

import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { prepareTestDir, cleanupTestDir } from './helpers/setup.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const STABLE_RUN_ID = process.env.TEST_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOGS_DIR = path.join(__dirname, 'logs', `test_run_${STABLE_RUN_ID}`);

if (process.env.TEST_RUN_ID) {
    console.log(`[e2e] Worker process using inherited TEST_RUN_ID: ${STABLE_RUN_ID}`);
}

interface ExtendedChildProcess extends ChildProcess {
  _finalExitCode?: number | null;
}

let tauriDriver: ExtendedChildProcess;

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
  maxInstances: parseInt(process.env.E2E_MAX_INSTANCES || '2'),
  capabilities: [{
    'tauri:options': {
      application: path.resolve(
        __dirname, '..', 'src-tauri', 'target', 'debug', 'kechimochi'
      ),
    },
  } as any],

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
      misMatchTolerance: 10.0,
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
    const { mkdirSync } = await import('fs');
    mkdirSync(LOGS_DIR, { recursive: true });
    process.env.TEST_RUN_ID = STABLE_RUN_ID;

    console.log(`[e2e] Test run ID: ${STABLE_RUN_ID}`);
    console.log(`[e2e] Logs directory: ${LOGS_DIR}`);
  },

  /**
   * Spawn tauri-driver right before each WebDriver session.
   * This is the correct hook per the official Tauri docs.
   */
  beforeSession: async (config: any, caps: any, specs: string[]) => {
    const specFile = specs[0];
    const specName = path.basename(specFile, '.spec.ts');
    
    // 1. Isolated Data Directory for this session
    const testDir = prepareTestDir();
    process.env.KECHIMOCHI_DATA_DIR = testDir;

    // 2. Dynamic Port Assignment (offset by worker ID)
    // WDIO_WORKER_ID looks like "0-0", "0-1", etc.
    const workerIndex = parseInt(process.env.WDIO_WORKER_ID?.split('-')[1] || '0');
    const tauriDriverPort = 4444 + workerIndex;
    const nativeDriverPort = 5555 + workerIndex;
    
    // Update capability port so WDIO connects to the correct driver
    config.port = tauriDriverPort;
    caps.port = tauriDriverPort;

    // 3. Create a transient staging directory in /tmp
    const STAGE_DIR = path.join(os.tmpdir(), `kechimochi-e2e-${Math.random().toString(36).slice(2)}`);
    const { mkdirSync, appendFileSync, existsSync } = await import('fs');
    mkdirSync(STAGE_DIR, { recursive: true });

    process.env.SPEC_STAGE_DIR = STAGE_DIR;
    process.env.SPEC_NAME = specName;

    // 4. Pass isolated environment to the app via capabilities
    caps['tauri:options'].envs = {
        ...caps['tauri:options'].envs,
        KECHIMOCHI_DATA_DIR: testDir
    };

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
        try { appendFileSync(logFile, msg); } catch { }
      }
    };

    console.log(`\n[e2e] [${specName}] Worker ${process.env.WDIO_WORKER_ID} starting...`);
    console.log(`[e2e] [${specName}] Port: ${tauriDriverPort}, Data: ${testDir}`);

    // 5. Spawn driver
    tauriDriver = spawn(
      'tauri-driver',
      [
        '--port', tauriDriverPort.toString(),
        '--native-port', nativeDriverPort.toString()
      ],
      {
        stdio: [null, 'pipe', 'pipe'],
        env: {
          ...process.env,
          KECHIMOCHI_DATA_DIR: testDir,
          RUST_LOG: 'debug',
          TAURI_DEBUG: '1'
        },
      }
    );

    tauriDriver.stdout?.on('data', log);
    tauriDriver.stderr?.on('data', log);

    // Wait for driver
    console.log(`[e2e] [${specName}] Initializing tauri-driver (3s)...`);
    const { execSync } = await import('child_process');
    try { execSync('sleep 3'); } catch { }

    tauriDriver.on('error', (error: Error) => {
      console.error(`[e2e] [${specName}] tauri-driver error:`, error);
      log(`[e2e] tauri-driver error: ${error.message}\n`);
      process.exit(1);
    });

    tauriDriver.on('exit', (code: number | null) => {
      console.log(`[e2e] [${specName}] tauri-driver process exited with code: ${code}`);
      log(`[e2e] tauri-driver process exited with code: ${code}\n`);
      tauriDriver._finalExitCode = code;
    });
  },

  /**
   * Move staged artifacts to final destination and kill driver.
   */
  afterSession: async () => {
    await stopTauriDriver();

    const stageDir = process.env.SPEC_STAGE_DIR;
    const specName = process.env.SPEC_NAME;
    const testDir = process.env.KECHIMOCHI_DATA_DIR;

    if (stageDir && specName) {
      await relocateArtifacts(stageDir, specName);
    }

    if (testDir && specName) {
      cleanupTestData(testDir, specName);
    }
  },

  /**
   * After each test, capture screenshot on failure.
   */
  afterTest: async (test: any, _context: any, { passed }: { passed: boolean }) => {
    if (!passed) {
      const stageDir = process.env.SPEC_STAGE_DIR;
      if (stageDir) {
        const sanitizedTitle = (test.title || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
        const failDir = path.join(stageDir, 'failures');
        const { mkdirSync } = await import('fs');
        mkdirSync(failDir, { recursive: true });
        await browser.saveScreenshot(path.join(failDir, `${sanitizedTitle}.png`));
      }
    }
  },

  /**
   * Clean up the temp test directory after the full run.
   */
};

async function stopTauriDriver() {
  if (tauriDriver) {
    const { appendFileSync } = await import('fs');
    tauriDriver.kill('SIGTERM');

    let attempts = 0;
    while (tauriDriver && (tauriDriver as any)._finalExitCode === undefined && attempts < 15) {
      const { execSync } = await import('child_process');
      try { execSync('sleep 0.2'); } catch { }
      attempts++;
    }

    const stageDir = process.env.SPEC_STAGE_DIR;
    if (stageDir) {
      const logFile = path.join(stageDir, 'tauri-driver.log');
      const finalCode = (tauriDriver as any)._finalExitCode;
      try { appendFileSync(logFile, `\n[e2e] Session Complete with exit code: ${finalCode}\n`); } catch { }
    }
  }
}

async function relocateArtifacts(stageDir: string, specName: string) {
  const { mkdirSync, existsSync, cpSync, rmSync, readdirSync } = await import('fs');
  const finalDir = path.join(LOGS_DIR, specName);

  if (existsSync(stageDir)) {
    try {
      const stagedFiles = readdirSync(stageDir, { recursive: true });
      console.log(`[e2e] [${specName}] Staging area contains: ${stagedFiles.join(', ')}`);

      mkdirSync(finalDir, { recursive: true });
      cpSync(stageDir, finalDir, { recursive: true });
      rmSync(stageDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[e2e] [${specName}] Failed to move artifacts:`, err);
    }
  }
}

function cleanupTestData(testDir: string, specName: string) {
  cleanupTestDir(testDir);
  console.log(`[e2e] [${specName}] Cleaned up isolated data directory: ${testDir}`);
}

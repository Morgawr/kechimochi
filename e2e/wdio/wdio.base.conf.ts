/**
 * Shared WebdriverIO configuration factory.
 *
 * Call makeConfig(driver, specGlobs) to produce a platform-specific config.
 * Each platform conf (wdio.desktop.conf.ts, wdio.web.conf.ts, …) does exactly
 * that and adds only the capability block that differs per platform.
 */

import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareTestDir, cleanupTestDir } from '../helpers/setup.js';
import { startSyncMockServer, stopSyncMockServer } from '../helpers/sync-mock.js';
import { assertRegistryMatchesSpecs, getSpecSetup } from '../config/spec-setup.js';
import { Logger } from '../../src/logger';
import { moveArtifactsToFinalDirectory, seedSyncBackupFixture } from './config-helpers.js';
import type { PlatformDriver } from '../drivers/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Run-ID (shared across all workers in a single run) ────────────────────
const STABLE_RUN_ID =
  process.env.TEST_RUN_ID ||
  new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-').slice(0, 19);

const LOGS_DIR = path.join(__dirname, '..', 'logs', `test_run_${STABLE_RUN_ID}`);

if (process.env.TEST_RUN_ID) {
  Logger.info(`[e2e] Worker process using inherited TEST_RUN_ID: ${STABLE_RUN_ID}`);
}

// ── Config factory ─────────────────────────────────────────────────────────

/**
 * Returns a WebdriverIO config object wired to the supplied platform driver.
 *
 * @param driver     - Platform driver (desktop / web / android).
 * @param specGlobs  - Array of glob patterns relative to the specs/ directory.
 *                     The spec directory IS the platform contract: shared/ runs
 *                     everywhere; desktop/ web/ android/ run on that one platform;
 *                     non-mobile/ runs on the resizable-viewport platforms only
 *                     (desktop + web, never android). e.g. ['shared/**',
 *                     'non-mobile/**', 'desktop/**'].
 */
export function makeConfig(
  driver: PlatformDriver,
  specGlobs: string[],
): WebdriverIO.Config {
  const resolvedSpecGlobs = specGlobs.map(glob =>
    path.join(__dirname, '..', 'specs', glob, '*.spec.ts'),
  );

  return {
    // ── Runner ─────────────────────────────────────────────────────────
    // The connection (hostname/port/protocol) is platform-specific and is set
    // entirely by each platform conf.
    runner: 'local',

    // ── Specs ──────────────────────────────────────────────────────────
    specs: resolvedSpecGlobs,

    // ── Capabilities ───────────────────────────────────────────────────
    // Each platform conf overrides this after calling makeConfig().
    maxInstances: Number.parseInt(process.env.E2E_MAX_INSTANCES || '2', 10),
    capabilities: [],

    // ── Test config ────────────────────────────────────────────────────
    logLevel: 'warn',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    // WDIO calculates Content-Length itself, but Node 26's Undici dispatcher
    // rejects that explicit header before a local WebDriver request is sent.
    // Fetch derives the same value from the string body when the header is
    // omitted, which works across the supported Node versions and drivers.
    transformRequest: (requestOptions: RequestInit): RequestInit => {
      const headers = new Headers(requestOptions.headers);
      headers.delete('content-length');
      return { ...requestOptions, headers };
    },

    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
      ui: 'bdd',
      timeout: 60000,
    },

    // ── Services ───────────────────────────────────────────────────────
    services: [
      ['visual', {
        baselineFolder: path.join(__dirname, '..', 'screenshots', 'baseline'),
        formatImageName: '{tag}',
        savePerInstance: false,
        autoSaveBaseline: false,
        blockOutStatusBar: true,
        blockOutToolBar: true,
        clearRuntimeFolder: false,
        misMatchTolerance: 5,
        compareOptions: {
          threshold: 0.5,
          includeAA: true,
        },
        companyName: '',
        projectName: '',
        browserName: '',
        browserVersion: '',
      }],
      ['ocr', {
        contrast: 0.25,
        imagesFolder: path.join(os.tmpdir(), 'kechimochi-ocr-junk'),
      }],
    ],

    // ── Hooks ──────────────────────────────────────────────────────────

    onPrepare: async () => {
      assertRegistryMatchesSpecs(path.join(__dirname, '..', 'specs'));

      const { mkdirSync } = await import('node:fs');
      mkdirSync(LOGS_DIR, { recursive: true });
      process.env.TEST_RUN_ID = STABLE_RUN_ID;

      Logger.info(`[e2e] Test run ID: ${STABLE_RUN_ID}`);
      Logger.info(`[e2e] Logs directory: ${LOGS_DIR}`);
    },

    beforeSession: async (_config: unknown, caps: Record<string, unknown>, specs: string[]) => {
      const specFile = specs[0];
      const specName = path.basename(specFile, '.spec.ts');
      const setup = getSpecSetup(specName);

      // 1. Isolated data directory for this session.
      const testDirectory = prepareTestDir({
        extraSettings: Object.keys(setup.extraSettings).length > 0
          ? setup.extraSettings
          : undefined,
        overrideSchemaVersion: setup.overrideSchemaVersion,
        freshInstall: setup.freshInstall,
      });
      process.env.KECHIMOCHI_DATA_DIR = testDirectory;

      if (setup.instanceLockOwner) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(
          path.join(testDirectory, '.kechimochi.instance.owner'),
          setup.instanceLockOwner,
        );
      }

      if (setup.needsSyncBackupFixture) {
        await seedSyncBackupFixture(testDirectory);
      }

      // 2. Build the env vars to pass into the launched process.
      let sessionEnv: Record<string, string> = {
        KECHIMOCHI_DATA_DIR: testDirectory,
      };

      if (setup.instanceLockOwner) {
        sessionEnv = {
          ...sessionEnv,
          KECHIMOCHI_E2E_FORCE_INSTANCE_LOCK_CONTENTION: '1',
        };
      }

      if (setup.needsTokenStoreOverride || setup.needsSyncBackupFixture) {
        sessionEnv = {
          ...sessionEnv,
          KECHIMOCHI_SYNC_TEST_TOKEN_STORE_PATH: path.join(testDirectory, 'e2e_google_tokens.json'),
        };
      }

      if (setup.skipLegacyLocalProfileMigration) {
        sessionEnv = {
          ...sessionEnv,
          KECHIMOCHI_E2E_SKIP_LEGACY_LOCAL_PROFILE_MIGRATION: '1',
        };
      }

      if (setup.needsSyncMock) {
        const syncMock = await startSyncMockServer();
        sessionEnv = {
          ...sessionEnv,
          KECHIMOCHI_GOOGLE_CLIENT_ID: syncMock.clientId,
          KECHIMOCHI_GOOGLE_AUTH_ENDPOINT: syncMock.authEndpoint,
          KECHIMOCHI_GOOGLE_TOKEN_ENDPOINT: syncMock.tokenEndpoint,
          KECHIMOCHI_GOOGLE_DRIVE_API_BASE_URL: syncMock.driveApiBaseUrl,
          KECHIMOCHI_GOOGLE_DRIVE_UPLOAD_BASE_URL: syncMock.driveUploadBaseUrl,
          KECHIMOCHI_SYNC_TEST_AUTO_OPEN: '1',
        };
        Logger.info(`[e2e] [${specName}] Using local sync mock server at ${syncMock.baseUrl}`);
      }

      // 3. Worker-offset port assignment.
      // WDIO_WORKER_ID looks like "0-0", "0-1", etc.
      const workerIndex = Number.parseInt(
        process.env.WDIO_WORKER_ID?.split('-')[1] || '0',
        10,
      );

      // 4. Create a transient staging directory in /tmp.
      const stageDirectory = path.join(os.tmpdir(), `kechimochi-e2e-${randomUUID()}`);
      const { mkdirSync, appendFileSync } = await import('node:fs');
      mkdirSync(stageDirectory, { recursive: true });
      mkdirSync(path.join(stageDirectory, 'visual', 'actual'), { recursive: true });
      mkdirSync(path.join(stageDirectory, 'visual', 'diff'), { recursive: true });
      mkdirSync(path.join(stageDirectory, 'ocr'), { recursive: true });

      process.env.SPEC_STAGE_DIR = stageDirectory;
      process.env.SPEC_NAME = specName;

      appendFileSync(
        path.join(stageDirectory, 'session.log'),
        `[e2e] [${specName}] Data Dir: ${testDirectory}\n`,
      );

      // 5. Merge env into caps and start the platform driver.
      driver.injectEnv(caps, sessionEnv);

      // Also expose the env to the Node process so helpers that read
      // process.env.KECHIMOCHI_DATA_DIR keep working.
      for (const [key, value] of Object.entries(sessionEnv)) {
        process.env[key] = value;
      }

      const driverPort = await driver.start({
        specName,
        workerIndex,
        stageDirectory,
      });

      // 6. Point WDIO at the driver port for this session.
      // A null return means the driver manages its own port (e.g. the web
      // driver lets WDIO auto-select the chromedriver port).
      if (driverPort !== null) {
        (caps as Record<string, unknown>)['port'] = driverPort;
        // Update the top-level config port too (desktop path needs this).
        (_config as WebdriverIO.Config).port = driverPort;
      }
    },

    afterSession: async () => {
      await driver.stop();

      const stageDirectory = process.env.SPEC_STAGE_DIR;
      const specName = process.env.SPEC_NAME;
      const finalDirectory = path.join(LOGS_DIR, specName || 'unknown');

      if (stageDirectory && specName) {
        await moveArtifactsToFinalDirectory(stageDirectory, specName, finalDirectory);
      }

      await stopSyncMockServer();

      const testDirectory = process.env.KECHIMOCHI_DATA_DIR;
      if (testDirectory && specName) {
        cleanupTestDir(testDirectory);
        Logger.info(`[e2e] [${specName}] Cleaned up isolated data directory: ${testDirectory}`);
      }
    },

    afterTest: async (
      test: { title?: string },
      _context: unknown,
      { passed }: { passed: boolean },
    ) => {
      if (!passed) {
        const stageDirectory = process.env.SPEC_STAGE_DIR;
        if (stageDirectory) {
          const sanitizedTitle = (test.title || 'unknown').replaceAll(/[^a-zA-Z0-9]/g, '_');
          const failureDirectory = path.join(stageDirectory, 'failures');
          const { mkdirSync } = await import('node:fs');
          mkdirSync(failureDirectory, { recursive: true });
          await browser.saveScreenshot(path.join(failureDirectory, `${sanitizedTitle}.png`));
        }
      }
    },

    onComplete: () => {
      // No-op: isolation directories are cleaned up in afterSession.
    },
  };
}

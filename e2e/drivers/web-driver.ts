/**
 * Web platform driver — manages the web_server process and chromedriver lifecycle.
 *
 * Each worker session:
 *   1. Picks a collision-free port from the web-server pool (8000 + workerIndex).
 *   2. Spawns `cargo run --bin web_server` with KECHIMOCHI_DATA_DIR and PORT injected.
 *   3. Waits until the port is open, then returns it for WDIO to target via baseUrl.
 *   4. On stop(), kills the server process.
 *
 * Port pools are disjoint from the desktop pool (4444/5555) so parallel runs
 * of desktop + web E2E on the same machine don't collide.
 */

import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger } from '../../src/logger';
import { delay, waitForPort, onShutdown } from './process-utils.js';
import type { PlatformDriver, DriverStartContext } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Base port for web_server instances. Worker N uses 8000+N. */
export const WEB_SERVER_BASE_PORT = 8000;

// ── Internal state ─────────────────────────────────────────────────────────
let webServerProcess: ChildProcess | undefined;
let webServerExitCode: number | null | undefined;

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveWebServerBinary(): string {
  // Use the pre-compiled debug binary if available (e2e:web pre-builds it).
  const debugBinary = path.resolve(
    __dirname, '..', '..', 'src-tauri', 'target', 'debug',
    process.platform === 'win32' ? 'web_server.exe' : 'web_server',
  );
  const releaseBinary = path.resolve(
    __dirname, '..', '..', 'src-tauri', 'target', 'release',
    process.platform === 'win32' ? 'web_server.exe' : 'web_server',
  );

  if (existsSync(debugBinary)) return debugBinary;
  if (existsSync(releaseBinary)) return releaseBinary;

  throw new Error(
    'web_server binary not found. Run `npm run e2e:web` (which pre-builds it) or ' +
    '`cargo build --manifest-path src-tauri/Cargo.toml --bin web_server` first.',
  );
}

onShutdown(() => { webServerProcess?.kill(); });

// ── PlatformDriver implementation ──────────────────────────────────────────

export const webDriver: PlatformDriver = {

  async start(context: DriverStartContext): Promise<number | null> {
    const { specName, workerIndex, stageDirectory } = context;

    const port = WEB_SERVER_BASE_PORT + workerIndex;
    webServerExitCode = undefined;

    const logFile = path.join(stageDirectory, 'web-server.log');

    if (existsSync(stageDirectory)) {
      appendFileSync(logFile, `[e2e] [${specName}] web_server starting on port ${port}\n`);
    }

    Logger.info(`[e2e] [${specName}] Starting web_server on port ${port}`);

    const binaryPath = resolveWebServerBinary();
    Logger.info(`[e2e] [${specName}] web_server binary: ${binaryPath}`);

    webServerProcess = spawn(
      binaryPath,
      [],
      {
        stdio: [null, 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: port.toString(),
          HOST: '127.0.0.1',
          KECHIMOCHI_DATA_DIR: process.env.KECHIMOCHI_DATA_DIR ?? '',
        },
      },
    );

    const log = (message: string | Buffer) => {
      if (existsSync(stageDirectory)) {
        try { appendFileSync(logFile, message); } catch { /* ignore transient errors */ }
      }
    };

    webServerProcess.stdout?.on('data', log);
    webServerProcess.stderr?.on('data', log);

    webServerProcess.on('error', (error: Error) => {
      Logger.error(`[e2e] [${specName}] web_server error:`, error);
      log(`[e2e] web_server error: ${error.message}\n`);
    });

    webServerProcess.on('exit', (code: number | null) => {
      Logger.info(`[e2e] [${specName}] web_server exited with code: ${code}`);
      log(`[e2e] web_server exited with code: ${code}\n`);
      webServerExitCode = code;
    });

    Logger.info(`[e2e] [${specName}] Waiting for web_server on port ${port}...`);
    await waitForPort(port, { timeoutMs: 30000, labelForError: 'web_server' });
    Logger.info(`[e2e] [${specName}] web_server is ready on port ${port}`);

    // Expose the server URL so wdio.web.conf.ts can set baseUrl, and so
    // specs that call browser.url('/') resolve against the right origin.
    process.env.WEB_SERVER_PORT = port.toString();
    process.env.WEB_SERVER_URL = `http://127.0.0.1:${port}`;

    // Return null to signal that WDIO should manage the WebDriver (chromedriver)
    // port itself via its built-in driver manager — see wdio.base.conf.ts.
    return null;
  },

  async stop(): Promise<void> {
    if (!webServerProcess) return;

    const serverProcess = webServerProcess;
    serverProcess.kill('SIGTERM');

    // The next session in this worker reuses the same fixed port, so wait for the
    // process to actually exit (and release the port) before returning. Force-kill
    // if it ignores SIGTERM, and only drop the reference once it is gone so the
    // onShutdown safety net can still reach it.
    let attempts = 0;
    while (webServerExitCode === undefined && attempts < 25) {
      await delay(200);
      attempts++;
    }
    if (webServerExitCode === undefined) {
      serverProcess.kill('SIGKILL');
      await delay(200);
    }

    webServerProcess = undefined;
  },

  injectEnv(_caps: Record<string, unknown>, _env: Record<string, string>): void {
    // Web mode: environment is injected into the web_server child process in
    // start(), not into WebDriver capabilities.  Both params are unused here —
    // we only need the baseUrl, which is set in the wdio.web.conf.ts
    // capabilities block, and start() reads env from process.env (the base
    // config already writes process.env).
  },
};
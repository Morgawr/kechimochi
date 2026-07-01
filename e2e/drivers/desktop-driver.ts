/**
 * Desktop platform driver — wraps the tauri-driver lifecycle.
 */

import path from 'node:path';
import {type ChildProcess, spawn} from 'node:child_process';
import {appendFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Logger} from '../../src/logger';
import {delay, killProcessTree, onShutdown, waitForPort} from './process-utils.js';
import type {DriverStartContext, PlatformDriver} from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Port constants ─────────────────────────────────────────────────────────

/** Base port for tauri-driver instances.  Worker N uses 4444+N. */
export const TAURI_DRIVER_BASE_PORT = 4444;

/** Base port for the native WebDriver (WebKit/Edge) instances.  Worker N uses 5555+N. */
export const NATIVE_DRIVER_BASE_PORT = 5555;

// ── Internal process state ─────────────────────────────────────────────────
// Each desktop-driver instance owns one child process.
let tauriDriverProcess: ChildProcess | undefined;
let tauriDriverExitCode: number | null | undefined;

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveTauriDriverCommand(): string {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || '';
    const cargoBin = path.join(userProfile, '.cargo', 'bin', 'tauri-driver.exe');
    if (userProfile && existsSync(cargoBin)) return cargoBin;
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
    const local = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'edgedriver.cmd');
    if (existsSync(local)) return local;
  } else {
    const systemWebKit = '/usr/bin/WebKitWebDriver';
    if (existsSync(systemWebKit)) return systemWebKit;

    const local = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'edgedriver');
    if (existsSync(local)) return local;
  }

  return null;
}

onShutdown(() => { if (tauriDriverProcess) killProcessTree(tauriDriverProcess, 'SIGTERM'); });

// ── PlatformDriver implementation ──────────────────────────────────────────

export const desktopDriver: PlatformDriver = {

  async start(context: DriverStartContext): Promise<number> {
    const { specName, workerIndex, stageDirectory } = context;

    // Reset exit-code tracker for this new session.
    tauriDriverExitCode = undefined;

    const tauriDriverPort = TAURI_DRIVER_BASE_PORT + workerIndex;
    const nativeDriverPort = NATIVE_DRIVER_BASE_PORT + workerIndex;

    const logFile = path.join(stageDirectory, 'tauri-driver.log');
    const log = (message: string | Buffer) => {
      if (existsSync(stageDirectory)) {
        try { appendFileSync(logFile, message); } catch { /* ignore transient fs errors */ }
      }
    };

    appendFileSync(logFile, `[e2e] [${specName}] Session Started at ${new Date().toISOString()}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Worker ID: ${process.env.WDIO_WORKER_ID}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Staging Dir: ${stageDirectory}\n`);
    appendFileSync(logFile, `[e2e] [${specName}] Driver Port: ${tauriDriverPort}\n\n`);

    Logger.info(`\n[e2e] [${specName}] Worker ${process.env.WDIO_WORKER_ID} starting...`);
    Logger.info(`[e2e] [${specName}] Port: ${tauriDriverPort}, Data: ${process.env.KECHIMOCHI_DATA_DIR}`);

    const nativeDriverPath = resolveNativeDriverPath();
    const tauriDriverArgs = [
      '--port', tauriDriverPort.toString(),
      '--native-port', nativeDriverPort.toString(),
    ];
    if (nativeDriverPath) {
      tauriDriverArgs.push('--native-driver', nativeDriverPath);
    }

    tauriDriverProcess = spawn(
      resolveTauriDriverCommand(),
      tauriDriverArgs,
      {
        stdio: [null, 'pipe', 'pipe'],
        // POSIX: make tauri-driver a process-group leader so stop() can kill the whole tree
        // (tauri-driver, WebKitWebDriver, app) in one signal, even if the app gets orphaned.
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          RUST_LOG: 'debug',
          TAURI_DEBUG: '1',
        },
      },
    );

    tauriDriverProcess.stdout?.on('data', log);
    tauriDriverProcess.stderr?.on('data', log);

    Logger.info(`[e2e] [${specName}] Waiting for tauri-driver on port ${tauriDriverPort}...`);
    await waitForPort(tauriDriverPort, { timeoutMs: 3000, socketTimeoutMs: 250, pollMs: 100, labelForError: 'tauri-driver' });

    tauriDriverProcess.on('error', (error: Error) => {
      Logger.error(`[e2e] [${specName}] tauri-driver error:`, error);
      log(`[e2e] tauri-driver error: ${error.message}\n`);
      process.exit(1);
    });

    tauriDriverProcess.on('exit', (code: number | null) => {
      Logger.info(`[e2e] [${specName}] tauri-driver process exited with code: ${code}`);
      log(`[e2e] tauri-driver process exited with code: ${code}\n`);
      tauriDriverExitCode = code;
    });

    return tauriDriverPort;
  },

  async stop(): Promise<void> {
    if (!tauriDriverProcess) return;

    // Kill, give tauri-driver time to do its thing, then final sweep
    killProcessTree(tauriDriverProcess, 'SIGTERM');
    let attempts = 0;
    while (tauriDriverExitCode === undefined && attempts < 15) {
      await delay(200);
      attempts++;
    }
    killProcessTree(tauriDriverProcess, 'SIGKILL');

    tauriDriverProcess = undefined;

    const stageDirectory = process.env.SPEC_STAGE_DIR;
    if (stageDirectory) {
      const logFile = path.join(stageDirectory, 'tauri-driver.log');
      try {
        appendFileSync(logFile, `\n[e2e] Session Complete with exit code: ${tauriDriverExitCode}\n`);
      } catch { /* ignore transient fs errors */ }
    }
  },

  injectEnv(caps: Record<string, unknown>, env: Record<string, string>): void {
    const tauriOptions = caps['tauri:options'] as Record<string, unknown> | undefined;
    if (tauriOptions) {
      const existing = (tauriOptions['envs'] as Record<string, string> | undefined) ?? {};
      tauriOptions['envs'] = { ...existing, ...env };
    }
  },
};
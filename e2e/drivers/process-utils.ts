/**
 * Shared child-process lifecycle helpers for the desktop and web drivers.
 */

import net from 'node:net';
import type { ChildProcess } from 'node:child_process';

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch { /* process group already gone (ESRCH) */ }
}

interface WaitForPortOptions {
  host?: string;
  timeoutMs?: number;
  socketTimeoutMs?: number;
  pollMs?: number;
  labelForError?: string;
}

export async function waitForPort(
  port: number,
  { host = '127.0.0.1', timeoutMs = 30000, socketTimeoutMs = 500, pollMs = 200, labelForError = 'server' }: WaitForPortOptions = {},
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(socketTimeoutMs);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });

    if (isOpen) return;
    await delay(pollMs);
  }

  throw new Error(`${labelForError} did not open port ${port} within ${timeoutMs}ms`);
}

export function onShutdown(fn: () => void): void {
  const cleanup = () => {
    try { fn(); } finally { process.exit(); }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
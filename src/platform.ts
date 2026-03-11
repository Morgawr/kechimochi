/**
 * Platform-agnostic network utilities.
 *
 * Use these instead of importing `invoke` from `@tauri-apps/api/core` directly.
 * In desktop mode they delegate to Tauri commands; in web mode they go through
 * the HTTP server proxy — automatically, with no per-call branching required.
 */

import { getServices } from './services/index';

export async function fetchExternalJson(
    url: string,
    method: string,
    body?: string,
    headers?: Record<string, string>,
): Promise<string> {
    return getServices().fetchExternalJson(url, method, body, headers);
}

export async function fetchRemoteBytes(url: string): Promise<number[]> {
    return getServices().fetchRemoteBytes(url);
}

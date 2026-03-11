/**
 * Service factory.
 *
 * Call `initServices()` once at application startup (before anything else).
 * After that, every module calls `getServices()` to get the active adapter.
 *
 * Runtime detection: if `window.__TAURI_INTERNALS__` is present we are inside
 * the Tauri webview and use the desktop adapter; otherwise we use the web
 * (HTTP) adapter.
 */
import type { AppServices } from './types';

export type { AppServices };

let _services: AppServices | null = null;

function isDesktopRuntime(): boolean {
    const w = window as any;
    // Different Tauri versions/execution modes expose different globals.
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) return true;

    // Fallback for contexts where globals are not yet injected at detection time.
    const ua = navigator.userAgent || '';
    return /\bTauri\b/i.test(ua);
}

export function getServices(): AppServices {
    if (!_services) {
        throw new Error(
            '[kechimochi] Services have not been initialised. ' +
            'Make sure initServices() is awaited before anything else runs.'
        );
    }
    return _services;
}

export async function initServices(): Promise<AppServices> {
    const isDesktop = isDesktopRuntime();
    if (isDesktop) {
        const { DesktopServices } = await import('./desktop');
        _services = new DesktopServices();
    } else {
        const { WebServices } = await import('./web');
        _services = new WebServices();
    }
    return _services;
}

import { save as tauriSave, open as tauriOpen, type SaveDialogOptions, type OpenDialogOptions } from '@tauri-apps/plugin-dialog';
import { Logger } from './logger';

/**
 * Wrapper for Tauri's save dialog that allows for E2E testing overrides.
 */
export async function save(options?: SaveDialogOptions): Promise<string | null> {
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.mockSavePath) {
        Logger.info("[Dialog] Using mockSavePath:", g.mockSavePath);
        return g.mockSavePath as string;
    }
    return tauriSave(options);
}

/**
 * Wrapper for Tauri's open dialog that allows for E2E testing overrides.
 */
export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.mockOpenPath) {
        Logger.info("[Dialog] Using mockOpenPath:", g.mockOpenPath);
        return g.mockOpenPath as string | string[];
    }
    return tauriOpen(options);
}

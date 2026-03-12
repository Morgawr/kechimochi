import { describe, it, expect, vi, beforeEach } from 'vitest';
import { save, open } from '../../src/utils/dialogs';
import { save as tauriSave, open as tauriOpen } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
    open: vi.fn(),
}));

describe('utils/dialogs.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (window as any).mockSavePath;
        delete (window as any).mockOpenPath;
    });

    it('save should return mock path if window.mockSavePath exists', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        (window as any).mockSavePath = '/mock/save/path';
        const result = await save();
        expect(result).toBe('/mock/save/path');
        expect(tauriSave).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('save should call tauriSave if no mock exists', async () => {
        vi.mocked(tauriSave).mockResolvedValue('/tauri/path' as any);
        const result = await save({ title: 'T' });
        expect(tauriSave).toHaveBeenCalledWith({ title: 'T' });
        expect(result).toBe('/tauri/path');
    });

    it('open should return mock path if window.mockOpenPath exists', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        (window as any).mockOpenPath = '/mock/open/path';
        const result = await open();
        expect(result).toBe('/mock/open/path');
        expect(tauriOpen).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('open should call tauriOpen if no mock exists', async () => {
        vi.mocked(tauriOpen).mockResolvedValue('/tauri/open/path' as any);
        const result = await open({ title: 'T' });
        expect(tauriOpen).toHaveBeenCalledWith({ title: 'T' });
        expect(result).toBe('/tauri/open/path');
    });
});

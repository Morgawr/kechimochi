import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initialProfilePrompt, showInitialSetupPrompt } from '../../src/modals/profile';

describe('modals/profile.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    it('should resolve a new local profile from the first-run setup modal', async () => {
        const promise = showInitialSetupPrompt('Default', { allowCloudSync: true });
        
        const overlay = document.querySelector('.modal-overlay') as HTMLElement;
        expect(overlay).toBeDefined();
        
        const input = overlay.querySelector('#initial-prompt-input') as HTMLInputElement;
        const confirmBtn = overlay.querySelector('#initial-prompt-confirm') as HTMLButtonElement;
        
        expect(confirmBtn.disabled).toBe(true);
        
        input.value = 'My Profile';
        input.dispatchEvent(new Event('input'));
        
        expect(confirmBtn.disabled).toBe(false);
        
        confirmBtn.click();
        
        const result = await promise;
        expect(result).toEqual({ action: 'create_local', profileName: 'My Profile' });
        
        vi.advanceTimersByTime(300);
        expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('should resolve the sync action from the first-run setup modal', async () => {
        const promise = showInitialSetupPrompt('Default', { allowCloudSync: true });

        const syncBtn = document.querySelector('#initial-prompt-sync') as HTMLButtonElement;
        syncBtn.click();

        const result = await promise;
        expect(result).toEqual({ action: 'sync_remote' });
    });

    it('should resolve the input name on Enter key for the legacy local-only prompt', async () => {
        const promise = initialProfilePrompt('Default');
        
        const input = document.querySelector('#initial-prompt-input') as HTMLInputElement;
        input.value = 'Enter Profile';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        
        const result = await promise;
        expect(result).toBe('Enter Profile');
    });
});

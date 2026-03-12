import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initialProfilePrompt } from '../../src/modals/profile';

describe('modals/profile.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    it('should show the prompt and resolve the input name on confirm click', async () => {
        const promise = initialProfilePrompt('Default');
        
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
        expect(result).toBe('My Profile');
        
        vi.advanceTimersByTime(300);
        expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('should resolve the input name on Enter key', async () => {
        const promise = initialProfilePrompt('Default');
        
        const input = document.querySelector('#initial-prompt-input') as HTMLInputElement;
        input.value = 'Enter Profile';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        
        const result = await promise;
        expect(result).toBe('Enter Profile');
    });
});

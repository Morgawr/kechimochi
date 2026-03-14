import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as base from '../../src/modals/base';

describe('modals/base.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runAllTimers();
    });

    describe('customPrompt', () => {
        it('should resolve with input value on confirm', async () => {
            const promise = base.customPrompt('Title', 'Default');
            const input = document.querySelector('#prompt-input') as HTMLInputElement;
            const confirmBtn = document.querySelector('#prompt-confirm') as HTMLButtonElement;
            
            input.value = 'New Value';
            confirmBtn.click();
            
            expect(await promise).toBe('New Value');
        });

        it('should resolve with null on cancel', async () => {
            const promise = base.customPrompt('Title');
            const cancelBtn = document.querySelector('#prompt-cancel') as HTMLButtonElement;
            
            cancelBtn.click();
            
            expect(await promise).toBeNull();
        });

        it('should resolve with input value on Enter key', async () => {
            const promise = base.customPrompt('Title');
            const input = document.querySelector('#prompt-input') as HTMLInputElement;
            input.value = 'Key Value';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(await promise).toBe('Key Value');
        });

        it('should resolve with null on Escape key', async () => {
            const promise = base.customPrompt('Title');
            const input = document.querySelector('#prompt-input') as HTMLInputElement;
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(await promise).toBeNull();
        });
    });

    describe('customConfirm', () => {
        it('should resolve true on OK', async () => {
            const promise = base.customConfirm('Title', 'Text');
            document.getElementById('confirm-ok')!.click();
            expect(await promise).toBe(true);
        });

        it('should resolve false on Cancel', async () => {
            const promise = base.customConfirm('Title', 'Text');
            document.getElementById('confirm-cancel')!.click();
            expect(await promise).toBe(false);
        });
    });

    describe('customAlert', () => {
        it('should resolve on OK', async () => {
            const promise = base.customAlert('Title', 'Text');
            const alertOk = document.getElementById('alert-ok');
            expect(alertOk).not.toBeNull();
            alertOk!.click();
            await expect(promise).resolves.toBeUndefined();
        });
    });
});

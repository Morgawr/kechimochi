import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as base from '../../src/modals/base';

describe('modals/base.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
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

        it('should handle Enter and Escape keys', async () => {
            const promise1 = base.customPrompt('Title');
            const input1 = document.querySelector('#prompt-input') as HTMLInputElement;
            input1.value = 'Key Value';
            input1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(await promise1).toBe('Key Value');

            const promise2 = base.customPrompt('Title');
            const input2 = document.querySelector('#prompt-input') as HTMLInputElement;
            input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(await promise2).toBeNull();
        });
    });

    describe('customConfirm', () => {
        it('should resolve true on OK and false on Cancel', async () => {
            const promiseTrue = base.customConfirm('Title', 'Text');
            document.getElementById('confirm-ok')!.click();
            expect(await promiseTrue).toBe(true);

            const promiseFalse = base.customConfirm('Title', 'Text');
            document.getElementById('confirm-cancel')!.click();
            expect(await promiseFalse).toBe(false);
        });
    });

    describe('customAlert', () => {
        it('should resolve on OK', async () => {
            const promise = base.customAlert('Title', 'Text');
            document.getElementById('alert-ok')!.click();
            await promise;
            // Passes if it resolves
        });
    });
});

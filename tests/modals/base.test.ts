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

        it('should sanitize an invalid confirm button class', async () => {
            const promise = base.customConfirm('Title', 'Text', 'bad"class');
            const confirmBtn = document.getElementById('confirm-ok') as HTMLButtonElement;

            expect(confirmBtn.className).toContain('btn-danger');

            confirmBtn.click();
            expect(await promise).toBe(true);
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

        it('should constrain alert width and wrap long content safely', async () => {
            const promise = base.customAlert('Title', '/home/morg/local/share/com.morg.kechimochi/sync/pre_sync_backup_20260402T061548Z.zip');
            const body = document.getElementById('alert-body') as HTMLParagraphElement;
            const modal = body.closest('.modal-content') as HTMLDivElement;

            expect(modal.getAttribute('style')).toContain('max-width: 520px');
            expect(modal.getAttribute('style')).toContain('width: min(92vw, 520px)');
            expect(body.getAttribute('style')).toContain('overflow-wrap: anywhere');
            expect(body.getAttribute('style')).toContain('word-break: break-word');

            document.getElementById('alert-ok')!.click();
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('createOverlay', () => {
        it('should append an active overlay and remove it after cleanup', () => {
            const { overlay, cleanup } = base.createOverlay();

            expect(document.body.contains(overlay)).toBe(true);
            expect(overlay.classList.contains('active')).toBe(true);
            expect(overlay.dataset.modalId).toBeTruthy();

            cleanup();
            expect(overlay.classList.contains('active')).toBe(false);

            vi.runAllTimers();
            expect(document.body.contains(overlay)).toBe(false);
        });
    });

    describe('showBlockingStatus', () => {
        it('should render escaped content and close idempotently', () => {
            const status = base.showBlockingStatus('<Export>', 'In "progress"');
            const overlay = document.querySelector('.modal-overlay') as HTMLDivElement;

            expect(overlay.innerHTML).toContain('&lt;Export&gt;');
            expect(overlay.textContent).toContain('In "progress"');
            expect(overlay.querySelector('[aria-busy="true"]')).not.toBeNull();

            status.close();
            status.close();

            vi.runAllTimers();
            expect(document.querySelector('.modal-overlay')).toBeNull();
        });

        it('should update blocking status text and progress bar', () => {
            const status = base.showBlockingStatus('Sync', 'Starting...');
            status.setText?.('Uploading covers...');
            status.setProgress?.(3, 5, '3 / 5');

            const text = document.querySelector('#blocking-status-text') as HTMLParagraphElement;
            const progress = document.querySelector('#blocking-status-progress') as HTMLDivElement;
            const bar = document.querySelector('#blocking-status-progress-bar') as HTMLDivElement;
            const label = document.querySelector('#blocking-status-progress-label') as HTMLParagraphElement;

            expect(text.textContent).toBe('Uploading covers...');
            expect(progress.style.display).toBe('block');
            expect(bar.style.width).toBe('60%');
            expect(label.textContent).toBe('3 / 5');
        });
    });
});

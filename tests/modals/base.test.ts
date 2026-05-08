import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as base from '../../src/modal_base';
import { configureBackStack, resetBackStack } from '../../src/back_stack';

describe('modals/base.ts', () => {
    let backHandler: (() => boolean | Promise<boolean>) | null = null;

    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
        backHandler = null;
        resetBackStack();
        configureBackStack({
            subscribe: async (handler) => {
                backHandler = handler;
                return () => {
                    backHandler = null;
                };
            },
            onEmpty: () => undefined,
        });
    });

    afterEach(() => {
        vi.runAllTimers();
        resetBackStack();
        vi.unstubAllGlobals();
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

        it('should resolve with null when clicking the backdrop', async () => {
            const promise = base.customPrompt('Title');
            const overlay = document.querySelector('.modal-overlay') as HTMLDivElement;

            overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            overlay.click();

            expect(await promise).toBeNull();
        });

        it('should not dismiss when a pointer starts inside the modal and ends outside', async () => {
            const promise = base.customPrompt('Title');
            const overlay = document.querySelector('.modal-overlay') as HTMLDivElement;
            const content = overlay.querySelector('.modal-content') as HTMLDivElement;

            content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            overlay.click();

            await Promise.resolve();
            expect(document.body.contains(overlay)).toBe(true);

            (document.querySelector('#prompt-cancel') as HTMLButtonElement).click();
            await expect(promise).resolves.toBeNull();
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

        it('should dismiss the top cancelable overlay through the back stack', async () => {
            const promptPromise = base.customPrompt('First');
            const confirmPromise = base.customConfirm('Second', 'Text');

            await vi.waitFor(() => expect(backHandler).not.toBeNull());
            await backHandler?.();
            await expect(confirmPromise).resolves.toBe(false);

            await backHandler?.();
            await expect(promptPromise).resolves.toBeNull();
        });

        it('should keep overlays centered within the visual viewport', () => {
            const viewport = Object.assign(new EventTarget(), {
                offsetTop: 120,
                height: 260,
            });
            vi.stubGlobal('visualViewport', viewport);
            let rafCallback: FrameRequestCallback | undefined;
            vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
                rafCallback = callback;
                return 1;
            }));
            vi.stubGlobal('cancelAnimationFrame', vi.fn());

            const { overlay, cleanup } = base.createOverlay();
            overlay.innerHTML = '<div class="modal-content">Content</div>';
            const content = overlay.querySelector<HTMLElement>('.modal-content')!;
            vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
                width: 400,
                height: 300,
                top: 0,
                left: 0,
                right: 400,
                bottom: 300,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });
            rafCallback?.(0);

            expect(overlay.style.top).toBe('120px');
            expect(overlay.style.height).toBe('260px');
            expect(overlay.classList.contains('modal-overlay--top-aligned')).toBe(true);

            cleanup();
        });

        it('should defer datalist opening until the keyboard resize happens', () => {
            const viewport = Object.assign(new EventTarget(), {
                offsetTop: 0,
                height: 640,
            });
            const rafCallbacks: FrameRequestCallback[] = [];
            vi.stubGlobal('visualViewport', viewport);
            vi.stubGlobal('innerHeight', 700);
            vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            }));
            vi.stubGlobal('cancelAnimationFrame', vi.fn());

            document.body.innerHTML = `
                <input id="activity-media" list="media-datalist" />
                <datalist id="media-datalist"><option value="One"></option></datalist>
            `;
            const input = document.querySelector<HTMLInputElement>('#activity-media')!;
            const blurSpy = vi.spyOn(input, 'blur');
            const focusSpy = vi.spyOn(input, 'focus');
            const stopDeferring = base.focusInput(input, { deferDatalistUntilKeyboard: true });

            expect(input.hasAttribute('list')).toBe(false);
            expect(focusSpy).toHaveBeenCalledTimes(1);
            expect(blurSpy).not.toHaveBeenCalled();

            viewport.height = 300;
            viewport.dispatchEvent(new Event('resize'));
            expect(blurSpy).toHaveBeenCalledTimes(1);
            expect(input.getAttribute('list')).toBe('media-datalist');

            rafCallbacks.shift()?.(0);
            expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });

            stopDeferring();
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

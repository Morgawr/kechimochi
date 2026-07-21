import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showLogActivityModal, showExportCsvModal } from '../../src/activity_modal';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { buildCalendar } from '../../src/calendar';
import { Logger } from '../../src/logger';

vi.mock('../../src/api', () => ({
    getAllMedia: vi.fn(),
    addLog: vi.fn(),
    updateLog: vi.fn(),
    addMedia: vi.fn(),
    updateMedia: vi.fn(),
}));

vi.mock('../../src/calendar', () => ({
    buildCalendar: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({
    customPrompt: vi.fn(),
    customAlert: vi.fn(),
    focusInput: vi.fn((input: HTMLInputElement) => {
        input.focus();
        return vi.fn();
    }),
    createCancelableOverlay: vi.fn((onDismiss: () => void, options?: { closeOnEscape?: boolean }) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        let isClosed = false;
        const cleanup = vi.fn(() => {
            if (isClosed) return;
            isClosed = true;
            overlay.remove();
        });
        const dismiss = vi.fn(() => {
            if (isClosed) return;
            cleanup();
            onDismiss();
        });
        if (options?.closeOnEscape) {
            globalThis.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    dismiss();
                }
            });
        }
        return {
            overlay,
            cleanup,
            dismiss,
        }
    })
}));

describe('modals/activity.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        vi.useFakeTimers();
        HTMLInputElement.prototype.setCustomValidity = vi.fn();
        vi.stubGlobal('setCustomValidity', vi.fn());
        vi.mocked(buildCalendar).mockImplementation((container: HTMLElement, initialDate: string, onSelect: (d: string) => void) => {
            if (!container) return;
            container.innerHTML = `<button type="button" class="mock-calendar-day" data-date="${initialDate}">${initialDate}</button>`;
            container.querySelector<HTMLButtonElement>('.mock-calendar-day')?.addEventListener('click', () => onSelect(initialDate));
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    describe('showLogActivityModal', () => {
        it('should log activity for existing media', async () => {
            const mockMedia = [{ id: 10, title: 'Item 1', status: 'Active', tracking_status: 'Ongoing' }];
            vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
            
            const promise = showLogActivityModal();
            
            // Wait for DOM
            await vi.waitFor(() => document.querySelector('.modal-overlay'));
            
            const form = document.querySelector('#add-activity-form') as HTMLFormElement;
            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            
            titleInput.value = 'Item 1';
            durationInput.value = '45';
            
            form.dispatchEvent(new Event('submit'));
            
            const result = await promise;
            expect(result).toBe(true);
            expect(api.addLog).toHaveBeenCalledWith({
                media_id: 10,
                duration_minutes: 45,
                characters: 0,
                date: expect.any(String),
                activity_type: 'Reading',
                notes: ''
            });
        });

        it('should default activity type from the selected existing media title', async () => {
            const mockMedia = [
                {
                    id: 10,
                    title: 'Anime Item',
                    default_activity_type: 'Watching',
                    status: 'Active',
                    language: 'Japanese',
                    description: '',
                    cover_image: '',
                    extra_data: '{}',
                    content_type: 'Anime',
                    tracking_status: 'Ongoing'
                }
            ];
            vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia);

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const typeSelect = document.querySelector('#activity-type') as HTMLSelectElement;
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;

            expect(typeSelect.value).toBe('Reading');

            titleInput.value = 'Anime Item';
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            durationInput.value = '45';

            expect(typeSelect.value).toBe('Watching');

            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            const result = await promise;
            expect(result).toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({
                media_id: 10,
                activity_type: 'Watching'
            }));
        });

        it('should show the selected media variant as disambiguating context', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{
                id: 10,
                title: 'Horimiya',
                variant: 'Anime',
                default_activity_type: 'Watching',
                status: 'Active',
                language: 'Japanese',
                description: '',
                cover_image: '',
                extra_data: '{}',
                content_type: 'Anime',
                tracking_status: 'Ongoing'
            }]);

            const promise = showLogActivityModal('Horimiya');
            await vi.waitFor(() => document.querySelector('#activity-media-variant'));

            const variant = document.querySelector('#activity-media-variant') as HTMLElement;
            expect(variant.textContent).toBe('Anime');
            expect(variant.style.display).toBe('block');

            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });

        it('should create new media if it does not exist', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customPrompt } = await import('../../src/modal_base');
            vi.mocked(customPrompt).mockResolvedValue('Manga');
            vi.mocked(api.addMedia).mockResolvedValue(99);

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));
            
            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            
            titleInput.value = 'New Series';
            durationInput.value = '20';
            
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            
            const result = await promise;
            expect(result).toBe(true);
            expect(customPrompt).toHaveBeenCalled();
            expect(api.addMedia).toHaveBeenCalledWith(expect.objectContaining({
                title: 'New Series',
                tracking_status: 'Ongoing'
            }));
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({ media_id: 99 }));
        });

        it('should keep the modal open if creating new media is cancelled', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customPrompt } = await import('../../src/modal_base');
            vi.mocked(customPrompt).mockResolvedValue('');

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            (document.querySelector('#activity-media') as HTMLInputElement).value = 'Cancelled Series';
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '20';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            await Promise.resolve();

            expect(customPrompt).toHaveBeenCalled();
            expect(api.addMedia).not.toHaveBeenCalled();
            expect(api.addLog).not.toHaveBeenCalled();
            expect(document.querySelector('.modal-overlay')).not.toBeNull();

            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });
        
        it('should resolve false on cancel', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#activity-cancel'));
            
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            
            const result = await promise;
            expect(result).toBe(false);
        });

        it('should handle prefilled title and focus duration', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            showLogActivityModal('Prefilled');
            await vi.waitFor(() => document.querySelector('#activity-duration'));
            
            expect((document.querySelector('#activity-media') as HTMLInputElement).value).toBe('Prefilled');
            expect(document.activeElement?.id).toBe('activity-duration');
        });

        it('should reactive archived media when logging activity', async () => {
            const mockMedia = [{ id: 10, title: 'Archived Item', status: 'Archived', tracking_status: 'Ongoing' }];
            vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
            
            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));
            
            (document.querySelector('#activity-media') as HTMLInputElement).value = 'Archived Item';
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '10';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            
            await promise;
            expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ status: 'Active' }));
        });

        it('should close on Escape key', async () => {
             vi.mocked(api.getAllMedia).mockResolvedValue([]);
             const promise = showLogActivityModal();
             await vi.waitFor(() => document.querySelector('.modal-overlay'));
             
             globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
             
             const result = await promise;
             expect(result).toBe(false);
        });

        it('should show alert if both duration and characters are 0', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Item 1', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);
            const { customAlert } = await import('../../src/modal_base');
            
            showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));
            
            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            titleInput.value = 'Item 1';
            // Duration and characters are 0 by default
            
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            
            await vi.waitFor(() => {
                expect(customAlert).toHaveBeenCalledWith("Input Required", expect.any(String));
            });
        });

        it('should show alert when the submitted title is empty', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customAlert } = await import('../../src/modal_base');

            showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            (document.querySelector('#activity-duration') as HTMLInputElement).value = '15';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await vi.waitFor(() => {
                expect(customAlert).toHaveBeenCalledWith("Required Field", "Please enter a Media Title.");
            });
            expect(api.addLog).not.toHaveBeenCalled();
        });

        it('should have custom validation message for media title', async () => {
             vi.mocked(api.getAllMedia).mockResolvedValue([]);
             showLogActivityModal();
             await vi.waitFor(() => document.querySelector('#activity-media'));
             
             const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
             expect(titleInput.getAttribute('oninvalid')).toContain('Media Title is required');
        });

        it('should handle edit mode correctly', async () => {
            const editLog = {
                id: 123,
                media_id: 456,
                title: 'Test Media',
                activity_type: 'Reading',
                duration_minutes: 30,
                characters: 100,
                date: '2024-03-01',
                language: 'Japanese',
                notes: ''
            };
            
            vi.mocked(api.getAllMedia).mockResolvedValue([{ 
                id: 456, 
                title: 'Test Media',
                default_activity_type: 'Reading',
                status: 'Active',
                language: 'Japanese',
                description: '',
                cover_image: '',
                extra_data: '{}',
                content_type: 'Novel',
                tracking_status: 'Ongoing'
            }]);
            
            const promise = showLogActivityModal(undefined, editLog);
            await vi.waitFor(() => document.querySelector('#activity-media'));
            
            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            expect(titleInput.value).toBe('Test Media');
            expect(titleInput.disabled).toBe(true);
            
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            expect(durationInput.value).toBe('30');
            durationInput.value = '45';
            
            const confirmBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
            confirmBtn.click();
            
            await promise;
            
            expect(api.updateLog).toHaveBeenCalledWith(expect.objectContaining({
                id: 123,
                duration_minutes: 45
            }));
        });

        it('should use the edit log title fallback and selected activity type when the disabled title input is empty', async () => {
            const editLog = {
                id: 123,
                media_id: 456,
                title: 'Edit Fallback',
                activity_type: 'Listening',
                duration_minutes: 0,
                characters: 100,
                date: '2024-03-01',
                language: 'Japanese',
                notes: ''
            };
            vi.mocked(api.getAllMedia).mockResolvedValue([]);

            const promise = showLogActivityModal(undefined, editLog);
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            (document.querySelector('#activity-media') as HTMLInputElement).value = '';
            (document.querySelector('#activity-characters') as HTMLInputElement).value = '250';
            (document.querySelector('#activity-type') as HTMLSelectElement).value = 'Listening';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await expect(promise).resolves.toBe(true);
            expect(api.updateLog).toHaveBeenCalledWith({
                id: 123,
                media_id: 456,
                duration_minutes: 0,
                characters: 250,
                date: '2024-03-01',
                activity_type: 'Listening',
                notes: ''
            });
        });

        it('should use the mobile date input when the mobile date field is visible', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 10, title: 'Mobile Item', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            (document.querySelector('#activity-media') as HTMLInputElement).value = 'Mobile Item';
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '30';
            (document.querySelector('#mobile-date-field') as HTMLElement).style.display = 'flex';
            (document.querySelector('#mobile-date-input') as HTMLInputElement).value = '2026-06-10';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({
                date: '2026-06-10'
            }));
        });

        it('should show and interact with Android media suggestions', async () => {
            document.body.dataset.runtime = 'mobile-app';
            Object.defineProperty(globalThis.navigator, 'userAgent', {
                value: 'Mozilla/5.0 Android',
                configurable: true,
            });
            const titleKeydownListeners: EventListener[] = [];
            const originalAddEventListener = HTMLInputElement.prototype.addEventListener;
            vi.spyOn(HTMLInputElement.prototype, 'addEventListener').mockImplementation(function (
                this: HTMLInputElement,
                type: string,
                listener: EventListenerOrEventListenerObject,
                options?: boolean | AddEventListenerOptions,
            ) {
                if (this.id === 'activity-media' && type === 'keydown' && typeof listener === 'function') {
                    titleKeydownListeners.push(listener as EventListener);
                }
                return originalAddEventListener.call(this, type, listener, options);
            });
            vi.mocked(api.getAllMedia).mockResolvedValue([
                { id: 1, title: 'Blue Box', default_activity_type: 'Reading', status: 'Active', tracking_status: 'Ongoing' },
                { id: 2, title: 'Blue Lock', default_activity_type: 'Watching', status: 'Active', tracking_status: 'Ongoing' },
                { id: 3, title: 'Archived Blue', default_activity_type: 'Reading', status: 'Archived', tracking_status: 'Ongoing' },
                { id: 4, title: 'Paused Blue', default_activity_type: 'Reading', status: 'Active', tracking_status: 'Paused' },
            ] as unknown as Media[]);

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#activity-media-suggestions'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const typeSelect = document.querySelector('#activity-type') as HTMLSelectElement;
            const suggestions = document.querySelector('#activity-media-suggestions') as HTMLElement;
            titleInput.setCustomValidity = vi.fn();

            expect(titleInput.getAttribute('list')).toBeNull();
            titleInput.focus();
            titleInput.value = 'blue';
            titleInput.dispatchEvent(new Event('input'));

            expect(suggestions.style.display).toBe('block');
            expect(suggestions.textContent).toContain('Blue Box');
            expect(suggestions.textContent).toContain('Blue Lock');
            expect(suggestions.textContent).not.toContain('Archived Blue');
            expect(suggestions.textContent).not.toContain('Paused Blue');

            suggestions.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            suggestions.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(titleInput.value).toBe('blue');
            expect(suggestions.style.display).toBe('block');

            const firstSuggestion = suggestions.querySelector<HTMLButtonElement>('.activity-media-suggestion')!;
            firstSuggestion.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            firstSuggestion.click();

            expect(titleInput.value).toBe('Blue Box');
            expect(typeSelect.value).toBe('Reading');
            expect(suggestions.style.display).toBe('none');

            titleInput.focus();
            titleInput.value = 'missing';
            titleInput.dispatchEvent(new Event('input'));
            expect(suggestions.style.display).toBe('none');

            titleInput.value = 'Blue Lock';
            titleInput.dispatchEvent(new Event('input'));
            expect(suggestions.style.display).toBe('block');
            titleKeydownListeners[titleKeydownListeners.length - 1]?.({ key: 'Escape' } as KeyboardEvent);
            expect(suggestions.style.display).toBe('none');

            titleInput.dispatchEvent(new Event('blur'));
            expect(vi.getTimerCount()).toBeGreaterThan(0);
            vi.advanceTimersByTime(120);
            expect(suggestions.style.display).toBe('none');

            (document.querySelector('#activity-duration') as HTMLInputElement).value = '25';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({
                media_id: 2,
                activity_type: 'Watching'
            }));
        });

        it('should clear pending suggestion timers after successful save', async () => {
            document.body.dataset.runtime = 'mobile-app';
            Object.defineProperty(globalThis.navigator, 'userAgent', {
                value: 'Mozilla/5.0 Android',
                configurable: true,
            });
            vi.mocked(api.getAllMedia).mockResolvedValue([
                { id: 1, title: 'Timer Item', default_activity_type: 'Reading', status: 'Active', tracking_status: 'Ongoing' },
            ] as unknown as Media[]);
            const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            titleInput.setCustomValidity = vi.fn();
            titleInput.focus();
            titleInput.value = 'Timer Item';
            titleInput.dispatchEvent(new Event('input'));
            titleInput.dispatchEvent(new Event('blur'));
            expect(vi.getTimerCount()).toBeGreaterThan(0);

            (document.querySelector('#activity-duration') as HTMLInputElement).value = '10';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await expect(promise).resolves.toBe(true);
            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('should clear pending suggestion timers when cancelling the mobile suggestions modal', async () => {
            document.body.dataset.runtime = 'mobile-app';
            Object.defineProperty(globalThis.navigator, 'userAgent', {
                value: 'Mozilla/5.0 Android',
                configurable: true,
            });
            vi.mocked(api.getAllMedia).mockResolvedValue([
                { id: 1, title: 'Cancel Timer Item', default_activity_type: 'Reading', status: 'Active', tracking_status: 'Ongoing' },
            ] as unknown as Media[]);
            const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

            const promise = showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            titleInput.focus();
            titleInput.dispatchEvent(new Event('blur'));
            expect(vi.getTimerCount()).toBeGreaterThan(0);

            (document.querySelector('#activity-cancel') as HTMLElement).click();

            await expect(promise).resolves.toBe(false);
            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('should log and alert when saving activity fails', async () => {
            const error = new Error('database unavailable');
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 10, title: 'Broken Item', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);
            vi.mocked(api.addLog).mockRejectedValueOnce(error);
            const { customAlert } = await import('../../src/modal_base');
            const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

            showLogActivityModal();
            await vi.waitFor(() => document.querySelector('#add-activity-form'));

            (document.querySelector('#activity-media') as HTMLInputElement).value = 'Broken Item';
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '20';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await vi.waitFor(() => {
                expect(errorSpy).toHaveBeenCalledWith("Failed to save activity", error);
                expect(customAlert).toHaveBeenCalledWith("Error", `Failed to save activity: ${error}`);
            });
            expect(document.querySelector('.modal-overlay')).not.toBeNull();
        });
    });

    describe('showExportCsvModal', () => {
        it('should resolve with "all" mode by default', async () => {
            const promise = showExportCsvModal();
            await vi.waitFor(() => document.querySelector('#export-confirm'));
            
            (document.querySelector('#export-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result?.mode).toBe('all');
        });

        it('should resolve with custom range if selected', async () => {
            const promise = showExportCsvModal();
            await vi.waitFor(() => document.querySelector('input[value="range"]'));
            
            const rangeRadio = document.querySelector('input[value="range"]') as HTMLInputElement;
            rangeRadio.checked = true;
            rangeRadio.dispatchEvent(new Event('change'));
            
            (document.querySelector('#export-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result?.mode).toBe('range');
            expect(result?.start).toBeDefined();
        });
    });
});

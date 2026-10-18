import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showActivityCsvConflictModal, showLogActivityModal, showExportCsvModal } from '../../src/activity_modal';
import * as api from '../../src/api';
import { ActivitySummary, Media } from '../../src/api';
import { buildCalendar } from '../../src/calendar';
import type { DateAnchor } from '../../src/time';
import { Logger } from '../../src/logger';
import { setEpisodeDurationOverride } from '../../src/media/media_actions';

vi.mock('../../src/api', () => ({
    getAllMedia: vi.fn(),
    getSetting: vi.fn().mockResolvedValue(null),
    addLog: vi.fn(),
    updateLog: vi.fn(),
    addMedia: vi.fn(),
    updateMedia: vi.fn(),
}));

vi.mock('../../src/calendar', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/calendar')>()),
    buildCalendar: vi.fn(),
}));

vi.mock('../../src/media/media_actions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/media/media_actions')>()),
    setEpisodeDurationOverride: vi.fn(),
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

function queryOrThrow(selector: string): Element {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Not rendered yet: ${selector}`);
    return element;
}

function makeMedia(overrides: Partial<Media> = {}): Media {
    return {
        id: 10,
        title: 'Higurashi',
        default_activity_type: 'Watching',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Anime',
        tracking_status: 'Ongoing',
        ...overrides,
    };
}

function getEpisodeElements() {
    return {
        durationField: document.querySelector<HTMLElement>('#activity-duration-field')!,
        episodeDurationHint: document.querySelector<HTMLElement>('#activity-episode-duration-hint')!,
        decrementButton: document.querySelector<HTMLButtonElement>('button[aria-label="Remove one episode"]')!,
        incrementButton: document.querySelector<HTMLButtonElement>('button[aria-label="Add one episode"]')!,
        editButton: document.querySelector<HTMLButtonElement>('button[aria-label="Change episode duration"]')!,
        durationValue: document.querySelector<HTMLElement>('#activity-episode-duration-value')!,
    };
}

function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('modals/activity.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        HTMLInputElement.prototype.setCustomValidity = vi.fn();
        vi.stubGlobal('setCustomValidity', vi.fn());
        vi.mocked(buildCalendar).mockImplementation((container: HTMLElement, initialDate: string, onSelect: (d: string) => void) => {
            container.innerHTML = `<button type="button" class="mock-calendar-day" data-date="${initialDate}">${initialDate}</button>`;
            container.querySelector<HTMLButtonElement>('.mock-calendar-day')?.addEventListener('click', () => onSelect(initialDate));
            return {
                setValue: vi.fn(),
                getViewAnchor: () => initialDate as DateAnchor,
                focus: vi.fn(),
                focusScopeTab: vi.fn(),
                destroy: vi.fn(),
            };
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
            
            const promise = showLogActivityModal(10);

            // Wait for DOM
            await vi.waitFor(() => queryOrThrow('.modal-overlay'));
            
            const form = document.querySelector('#add-activity-form') as HTMLFormElement;
            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            
            expect(titleInput.value).toBe('Item 1');
            durationInput.value = '45';
            
            form.dispatchEvent(new Event('submit'));
            
            const result = await promise;
            expect(result).toBe(true);
            expect(api.addLog).toHaveBeenCalledWith({
                media_id: 10,
                duration_minutes: 45,
                characters: 0,
                date: expect.any(String),
                date_precision: 'day',
                activity_type: 'Reading',
                notes: ''
            });
        });

        it('should default activity type from the selected existing media ID', async () => {
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

            const promise = showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            const typeSelect = document.querySelector('#activity-type') as HTMLSelectElement;
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;

            expect(titleInput.value).toBe('Anime Item');
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

        it('routes duplicate titles by the explicitly selected media ID and keeps activity type independent', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([
                {
                    id: 10,
                    title: 'Horimiya',
                    variant: 'Anime',
                    default_activity_type: 'Watching',
                    status: 'Active',
                    tracking_status: 'Ongoing',
                },
                {
                    id: 11,
                    title: 'Horimiya',
                    variant: 'Manga',
                    default_activity_type: 'Reading',
                    status: 'Active',
                    tracking_status: 'Ongoing',
                },
            ] as Media[]);

            const promise = showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#activity-media'));

            const titleInput = document.querySelector<HTMLInputElement>('#activity-media')!;
            titleInput.value = 'Horimiya';
            titleInput.dispatchEvent(new Event('input'));

            const suggestions = document.querySelectorAll<HTMLButtonElement>('.activity-media-suggestion');
            expect(suggestions).toHaveLength(2);
            expect(Array.from(suggestions).map(button => button.textContent)).toEqual([
                expect.stringContaining('Anime'),
                expect.stringContaining('Manga'),
            ]);

            document.querySelector<HTMLButtonElement>('[data-media-id="11"]')!.click();
            expect(document.querySelector('#activity-media-variant')?.textContent).toBe('Manga');
            expect((document.querySelector('#activity-type') as HTMLSelectElement).value).toBe('Reading');

            // Per-log activity type is independent from media identity/defaults.
            (document.querySelector('#activity-type') as HTMLSelectElement).value = 'Listening';
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '25';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({
                media_id: 11,
                activity_type: 'Listening',
            }));
        });

        it('does not guess an existing media from a typed title without an explicit selection', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([
                { id: 10, title: 'Horimiya', variant: 'Anime', status: 'Active', tracking_status: 'Ongoing' },
                { id: 11, title: 'Horimiya', variant: 'Manga', status: 'Active', tracking_status: 'Ongoing' },
            ] as Media[]);
            const { customAlert } = await import('../../src/modal_base');

            const promise = showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#activity-media'));
            const titleInput = document.querySelector<HTMLInputElement>('#activity-media')!;
            titleInput.value = 'Horimiya';
            titleInput.dispatchEvent(new Event('input'));
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '20';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await vi.waitFor(() => expect(customAlert).toHaveBeenCalledWith(
                'Select Media',
                expect.stringContaining('multiple variants'),
            ));
            expect(api.addLog).not.toHaveBeenCalled();
            expect(api.addMedia).not.toHaveBeenCalled();

            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
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

            const promise = showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#activity-media-variant'));

            const variantRow = document.querySelector('#activity-media-variant-row') as HTMLElement;
            expect(document.querySelector('#activity-media-variant')!.textContent).toBe('Anime');
            expect(variantRow.hidden).toBe(false);
            expect(variantRow.title).toBe('Variant: Anime');

            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });

        it('should hide the variant when the selected media has none', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([makeMedia({ variant: '' })]);

            void showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            expect((document.querySelector('#activity-media-variant-row') as HTMLElement).hidden).toBe(true);
        });

        it('should collapse notes behind a toggle that expands and focuses them', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([makeMedia()]);
            void showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));
            const notesToggle = document.querySelector<HTMLButtonElement>('#activity-notes-toggle')!;
            const notesSection = document.querySelector<HTMLElement>('#activity-notes-section')!;

            expect(notesSection.hidden).toBe(true);
            expect(notesToggle.getAttribute('aria-expanded')).toBe('false');

            notesToggle.click();

            expect(notesSection.hidden).toBe(false);
            expect(notesToggle.hidden).toBe(true);
            expect(document.activeElement).toBe(document.querySelector('#activity-notes'));
        });

        it('should show notes expanded when editing a log that has notes', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([makeMedia()]);
            const editLog: ActivitySummary = {
                id: 1,
                media_id: 10,
                title: 'Higurashi',
                activity_type: 'Watching',
                duration_minutes: 24,
                characters: 0,
                date: '2024-03-01',
                date_precision: 'day',
                language: 'Japanese',
                notes: 'Rewatch',
            };

            void showLogActivityModal(undefined, editLog);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            expect((document.querySelector('#activity-notes-section') as HTMLElement).hidden).toBe(false);
            expect((document.querySelector('#activity-notes-toggle') as HTMLElement).hidden).toBe(true);
            expect((document.querySelector('#activity-notes') as HTMLTextAreaElement).value).toBe('Rewatch');
        });

        it('should create new media if it does not exist', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customPrompt } = await import('../../src/modal_base');
            vi.mocked(customPrompt).mockResolvedValue('Manga');
            vi.mocked(api.addMedia).mockResolvedValue(99);

            const promise = showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));
            
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
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

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
            await vi.waitFor(() => queryOrThrow('#activity-cancel'));
            
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            
            const result = await promise;
            expect(result).toBe(false);
        });

        it('should handle prefilled title and focus duration', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{
                id: 12,
                title: 'Prefilled',
                default_activity_type: 'Reading',
                status: 'Active',
                tracking_status: 'Ongoing',
            }] as Media[]);
            void showLogActivityModal(12);
            await vi.waitFor(() => queryOrThrow('#activity-duration'));
            
            expect((document.querySelector('#activity-media') as HTMLInputElement).value).toBe('Prefilled');
            expect(document.activeElement?.id).toBe('activity-duration');
        });

        it('should reactive archived media when logging activity', async () => {
            const mockMedia = [{ id: 10, title: 'Archived Item', status: 'Archived', tracking_status: 'Ongoing' }];
            vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
            
            const promise = showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));
            
            (document.querySelector('#activity-duration') as HTMLInputElement).value = '10';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            
            await promise;
            expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ status: 'Active' }));
        });

        it('should close on Escape key', async () => {
             vi.mocked(api.getAllMedia).mockResolvedValue([]);
             const promise = showLogActivityModal();
             await vi.waitFor(() => queryOrThrow('.modal-overlay'));
             
             globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
             
             const result = await promise;
             expect(result).toBe(false);
        });

        it('should open a new log with empty characters and a disabled submit button that explains why', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Item 1', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);

            void showLogActivityModal(1);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const charactersInput = document.querySelector('#activity-characters') as HTMLInputElement;
            const submitButton = document.querySelector('#activity-submit') as HTMLButtonElement;
            expect(charactersInput.value).toBe('');
            expect(charactersInput.placeholder).toBe('e.g. 1500');
            expect(submitButton.disabled).toBe(true);
            expect(submitButton.title).toBe('Please enter a duration, a character count, or both.');
        });

        it('should enable the submit button once a character count is entered', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Item 1', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);

            void showLogActivityModal(1);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const charactersInput = document.querySelector('#activity-characters') as HTMLInputElement;
            charactersInput.value = '500';
            charactersInput.dispatchEvent(new Event('input'));

            const submitButton = document.querySelector('#activity-submit') as HTMLButtonElement;
            expect(submitButton.disabled).toBe(false);
            expect(submitButton.hasAttribute('title')).toBe(false);
        });

        it('should log zero characters when the characters field is left empty', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 10, title: 'Time Only', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);

            const promise = showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));
            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            durationInput.value = '20';
            durationInput.dispatchEvent(new Event('input'));
            (document.querySelector('#activity-submit') as HTMLButtonElement).click();

            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 20, characters: 0 }));
        });

        it('should list every missing input when Enter is pressed before the log is complete', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customAlert } = await import('../../src/modal_base');

            void showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const enterPress = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            document.querySelector('#activity-characters')!.dispatchEvent(enterPress);

            expect(enterPress.defaultPrevented).toBe(true);
            expect(customAlert).toHaveBeenCalledWith(
                'Input Required',
                'Please enter a media title, and also a duration, a character count, or both.',
            );
            expect(api.addLog).not.toHaveBeenCalled();
        });

        it('should not show the missing-inputs alert for Enter in the notes field', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customAlert } = await import('../../src/modal_base');

            void showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            document.querySelector('#activity-notes')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

            expect(customAlert).not.toHaveBeenCalled();
        });

        it('should pick a highlighted suggestion on Enter without the missing-inputs alert and re-check the submit button', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 1, title: 'Blue Box', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);
            const { customAlert } = await import('../../src/modal_base');

            void showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const submitButton = document.querySelector('#activity-submit') as HTMLButtonElement;
            expect(submitButton.title).toBe('Please enter a media title, and also a duration, a character count, or both.');

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            titleInput.focus();
            expect(titleInput.value).toBe('');
            titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

            expect(titleInput.value).toBe('Blue Box');
            expect(customAlert).not.toHaveBeenCalled();
            expect(submitButton.title).toBe('Please enter a duration, a character count, or both.');
        });

        it('should show an empty characters field when editing a log without characters', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const editLog: ActivitySummary = {
                id: 5,
                media_id: 6,
                title: 'Time Only',
                activity_type: 'Reading',
                duration_minutes: 40,
                characters: 0,
                date: '2024-03-01',
                date_precision: 'day',
                language: 'Japanese',
                notes: ''
            };

            void showLogActivityModal(undefined, editLog);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            expect((document.querySelector('#activity-characters') as HTMLInputElement).value).toBe('');
            expect((document.querySelector('#activity-submit') as HTMLButtonElement).disabled).toBe(false);
        });

        it('should leave the submit button disabled and not submit for an unparseable duration', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 10, title: 'Validation', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);

            void showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            durationInput.value = '-1';
            durationInput.dispatchEvent(new Event('input'));

            const submitButton = document.querySelector('#activity-submit') as HTMLButtonElement;
            expect(submitButton.disabled).toBe(true);

            submitButton.click();
            expect(api.addLog).not.toHaveBeenCalled();
        });

        it('should not save when submitted with an empty title', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);

            void showLogActivityModal();
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const durationInput = document.querySelector('#activity-duration') as HTMLInputElement;
            durationInput.value = '15';
            durationInput.dispatchEvent(new Event('input'));
            expect((document.querySelector('#activity-submit') as HTMLButtonElement).disabled).toBe(true);

            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
            await Promise.resolve();

            expect(api.addLog).not.toHaveBeenCalled();
            expect(api.addMedia).not.toHaveBeenCalled();
        });

        it('should have custom validation message for media title', async () => {
             vi.mocked(api.getAllMedia).mockResolvedValue([]);
             void showLogActivityModal();
             await vi.waitFor(() => queryOrThrow('#activity-media'));
             
             const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
             expect(titleInput.getAttribute('oninvalid')).toContain('Media Title is required');
        });

        it('should handle edit mode correctly', async () => {
            const editLog: ActivitySummary = {
                id: 123,
                media_id: 456,
                title: 'Test Media',
                activity_type: 'Reading',
                duration_minutes: 30,
                characters: 100,
                date: '2024-03-01',
                date_precision: 'day',
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
            await vi.waitFor(() => queryOrThrow('#activity-media'));
            
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
            const editLog: ActivitySummary = {
                id: 123,
                media_id: 456,
                title: 'Edit Fallback',
                activity_type: 'Listening',
                duration_minutes: 0,
                characters: 100,
                date: '2024-03-01',
                date_precision: 'day',
                language: 'Japanese',
                notes: ''
            };
            vi.mocked(api.getAllMedia).mockResolvedValue([]);

            const promise = showLogActivityModal(undefined, editLog);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

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
                date_precision: 'day',
                activity_type: 'Listening',
                notes: ''
            });
        });

        it('should save the date picked in the calendar', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([{ id: 10, title: 'Mobile Item', status: 'Active', tracking_status: 'Ongoing' }] as unknown as Media[]);
            let pickDate: (date: string) => void = () => {};
            vi.mocked(buildCalendar).mockImplementation((_container: HTMLElement, initialDate: string, onSelect: (d: string) => void) => {
                pickDate = onSelect;
                return {
                    setValue: vi.fn(),
                    getViewAnchor: () => initialDate as DateAnchor,
                    focus: vi.fn(),
                    focusScopeTab: vi.fn(),
                    destroy: vi.fn(),
                };
            });

            const promise = showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            (document.querySelector('#activity-duration') as HTMLInputElement).value = '30';
            pickDate('2026-06-10');
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({
                date: '2026-06-10'
            }));
        });

        it('should show and interact with deterministic media suggestions across runtimes', async () => {
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
            await vi.waitFor(() => queryOrThrow('#activity-media-suggestions'));

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

            titleInput.dispatchEvent(new Event('input'));
            const blueLockSuggestion = suggestions.querySelector<HTMLButtonElement>('[data-media-id="2"]')!;
            blueLockSuggestion.click();
            expect(typeSelect.value).toBe('Watching');

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
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            const titleInput = document.querySelector('#activity-media') as HTMLInputElement;
            titleInput.setCustomValidity = vi.fn();
            titleInput.focus();
            titleInput.value = 'Timer Item';
            titleInput.dispatchEvent(new Event('input'));
            document.querySelector<HTMLButtonElement>('[data-media-id="1"]')!.click();
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
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

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

            void showLogActivityModal(10);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));

            (document.querySelector('#activity-duration') as HTMLInputElement).value = '20';
            document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));

            await vi.waitFor(() => {
                expect(errorSpy).toHaveBeenCalledWith("Failed to save activity", error);
                expect(customAlert).toHaveBeenCalledWith("Error", `Failed to save activity: ${error}`);
            });
            expect(document.querySelector('.modal-overlay')).not.toBeNull();
        });
    });

    describe('showLogActivityModal episodes', () => {
        const openModalFor = async (media: Media[], initialMediaId?: number, editLog?: ActivitySummary) => {
            vi.mocked(api.getAllMedia).mockResolvedValue(media);
            const result = showLogActivityModal(initialMediaId, editLog);
            await vi.waitFor(() => queryOrThrow('#add-activity-form'));
            return { result };
        };

        const submit = () => document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
        const durationInput = () => document.querySelector<HTMLInputElement>('#activity-duration')!;
        const submitButton = () => document.querySelector<HTMLButtonElement>('#activity-submit')!;

        const readEpisodeControlsVisibility = () => {
            const { durationField, decrementButton, incrementButton } = getEpisodeElements();
            return {
                hasInlineActions: durationField.classList.contains('has-inline-actions'),
                isDecrementShown: !decrementButton.hidden,
                isIncrementShown: !incrementButton.hidden,
            };
        };
        const EPISODE_CONTROLS_SHOWN = { hasInlineActions: true, isDecrementShown: true, isIncrementShown: true };
        const EPISODE_CONTROLS_HIDDEN = { hasInlineActions: false, isDecrementShown: false, isIncrementShown: false };

        it('should show the episode controls and episode duration only for anime', async () => {
            await openModalFor([makeMedia()], 10);
            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_SHOWN);
            expect(getEpisodeElements().episodeDurationHint.hidden).toBe(false);
            expect(getEpisodeElements().durationValue.textContent).toBe('24m');
        });

        it('should hide the episode controls for non-anime media', async () => {
            await openModalFor([makeMedia({ content_type: 'Manga', default_activity_type: 'Reading' })], 10);
            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_HIDDEN);
            expect(getEpisodeElements().episodeDurationHint.hidden).toBe(true);
        });

        it('should hide the episode controls when no media is selected', async () => {
            await openModalFor([makeMedia()]);
            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_HIDDEN);
        });

        it('should save the default episode duration per added episode', async () => {
            const { result: promise } = await openModalFor([makeMedia()], 10);
            const { incrementButton } = getEpisodeElements();

            incrementButton.click();
            incrementButton.click();
            incrementButton.click();

            expect(durationInput().value).toBe('3ep');
            submit();
            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({ media_id: 10, duration_minutes: 72 }));
        });

        it('should add episodes on top of a typed duration', async () => {
            const { result: promise } = await openModalFor([makeMedia()], 10);
            typeInto(durationInput(), '50m');

            for (let episodeIndex = 0; episodeIndex < 5; episodeIndex++) {
                getEpisodeElements().incrementButton.click();
            }

            expect(durationInput().value).toBe('5ep 50m');
            submit();
            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 170 }));
        });

        it('should use the media episode duration override', async () => {
            const { result: promise } = await openModalFor([makeMedia({ extra_data: '{"Episode duration":"45m"}' })], 10);
            const { incrementButton, durationValue } = getEpisodeElements();

            expect(durationValue.textContent).toBe('45m');
            incrementButton.click();
            incrementButton.click();

            submit();
            await expect(promise).resolves.toBe(true);
            expect(api.addLog).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 90 }));
        });

        it('should show the compact total in the duration hint for anime', async () => {
            await openModalFor([makeMedia()], 10);

            getEpisodeElements().incrementButton.click();
            getEpisodeElements().incrementButton.click();
            getEpisodeElements().incrementButton.click();

            expect(document.querySelector('#activity-duration-hint')!.textContent).toBe('1h 12m');
        });

        it('should keep the detailed duration hint for non-anime media', async () => {
            await openModalFor([makeMedia({ content_type: 'Manga', default_activity_type: 'Reading' })], 10);

            typeInto(durationInput(), '72');

            expect(document.querySelector('#activity-duration-hint')!.textContent).toBe('72 minutes (1h 12m)');
        });

        it('should only touch the episodes when stepping a mixed duration', async () => {
            await openModalFor([makeMedia()], 10);
            typeInto(durationInput(), '1h');

            getEpisodeElements().incrementButton.click();
            getEpisodeElements().incrementButton.click();

            expect(durationInput().value).toBe('2ep 1h');
        });

        it('should enable the decrement button for episodes typed into the duration field', async () => {
            await openModalFor([makeMedia()], 10);

            typeInto(durationInput(), '4ep 6m');

            expect(getEpisodeElements().decrementButton.disabled).toBe(false);
        });

        it('should remove the episodes from the duration field when the count reaches zero', async () => {
            await openModalFor([makeMedia()], 10);
            typeInto(durationInput(), '1ep 6m');
            const { decrementButton } = getEpisodeElements();

            decrementButton.click();

            expect(durationInput().value).toBe('6m');
            expect(decrementButton.disabled).toBe(true);
        });

        it('should disable the decrement button at zero episodes', async () => {
            await openModalFor([makeMedia()], 10);
            const { decrementButton, incrementButton } = getEpisodeElements();

            expect(decrementButton.disabled).toBe(true);
            incrementButton.click();
            expect(decrementButton.disabled).toBe(false);
        });

        it('should disable the episode controls while the duration cannot be parsed', async () => {
            await openModalFor([makeMedia()], 10);

            typeInto(durationInput(), '1x');

            const { incrementButton, decrementButton, episodeDurationHint } = getEpisodeElements();
            expect(incrementButton.disabled).toBe(true);
            expect(decrementButton.disabled).toBe(true);
            expect(episodeDurationHint.hidden).toBe(false);
        });

        it('should move focus to the duration field after a step with a precise pointer', async () => {
            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
            await openModalFor([makeMedia()], 10);
            const { incrementButton } = getEpisodeElements();
            incrementButton.focus();

            incrementButton.click();

            expect(document.activeElement).toBe(durationInput());
        });

        it('should leave focus on the step button on touch screens', async () => {
            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
            await openModalFor([makeMedia()], 10);
            const { incrementButton } = getEpisodeElements();
            incrementButton.focus();

            incrementButton.click();

            expect(document.activeElement).toBe(incrementButton);
        });

        it('should hide the episode field and reject episodes after switching to non-anime media', async () => {
            const { result: promise } = await openModalFor([
                makeMedia(),
                makeMedia({ id: 11, title: 'Umineko', content_type: 'Visual Novel', default_activity_type: 'Reading' }),
            ], 10);
            typeInto(durationInput(), '3ep');

            const titleInput = document.querySelector<HTMLInputElement>('#activity-media')!;
            titleInput.focus();
            typeInto(titleInput, 'Umineko');
            document.querySelector<HTMLButtonElement>('[data-media-id="11"]')!.click();

            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_HIDDEN);
            expect(getEpisodeElements().episodeDurationHint.hidden).toBe(true);
            expect(submitButton().disabled).toBe(true);
            await vi.advanceTimersByTimeAsync(1000);
            expect(document.querySelector('#activity-duration-hint')!.textContent).toBe('Pick an anime from the suggestions to log episodes.');

            submit();
            expect(api.addLog).not.toHaveBeenCalled();
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });

        it('should hide the episode controls once the title no longer matches the selected anime', async () => {
            await openModalFor([makeMedia()], 10);

            typeInto(document.querySelector<HTMLInputElement>('#activity-media')!, 'Higurashi Kai');

            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_HIDDEN);
        });

        it('should not count episodes for a title changed without an input event', async () => {
            const { customPrompt } = await import('../../src/modal_base');
            vi.mocked(customPrompt).mockResolvedValue('Anime');
            vi.mocked(api.addMedia).mockResolvedValue(99);
            const { result: promise } = await openModalFor([makeMedia()], 10);
            typeInto(durationInput(), '3ep');

            document.querySelector<HTMLInputElement>('#activity-media')!.value = 'Higurashi Kai';
            submit();
            await vi.advanceTimersByTimeAsync(0);

            expect(customPrompt).not.toHaveBeenCalled();
            expect(api.addMedia).not.toHaveBeenCalled();
            expect(api.addLog).not.toHaveBeenCalled();
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });

        it('should show the episode controls when editing an anime log, starting from the saved minutes', async () => {
            const editLog: ActivitySummary = {
                id: 123,
                media_id: 10,
                title: 'Higurashi',
                activity_type: 'Watching',
                duration_minutes: 72,
                characters: 0,
                date: '2024-03-01',
                date_precision: 'day',
                language: 'Japanese',
                notes: '',
            };
            const { result: promise } = await openModalFor([makeMedia()], undefined, editLog);
            const { decrementButton, incrementButton } = getEpisodeElements();

            expect(readEpisodeControlsVisibility()).toEqual(EPISODE_CONTROLS_SHOWN);
            expect(durationInput().value).toBe('72');
            expect(decrementButton.disabled).toBe(true);

            incrementButton.click();
            expect(durationInput().value).toBe('1ep 72m');
            submit();
            await promise;
            expect(api.updateLog).toHaveBeenCalledWith(expect.objectContaining({ id: 123, duration_minutes: 96 }));
        });

        it('should apply an episode duration saved from the edit button and report the media change on cancel', async () => {
            const updatedMedia = makeMedia({ extra_data: '{"Episode duration":"30m"}' });
            vi.mocked(setEpisodeDurationOverride).mockResolvedValue({ committed: true, updatedMedia });
            const { result: promise } = await openModalFor([makeMedia()], 10);
            const { editButton, durationValue, incrementButton } = getEpisodeElements();

            editButton.click();
            await vi.waitFor(() => expect(durationValue.textContent).toBe('30m'));
            expect(document.activeElement).toBe(editButton);
            incrementButton.click();

            expect(setEpisodeDurationOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
            expect(document.querySelector('#activity-duration-hint')!.textContent).toBe('30m');
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(true);
        });

        it('should keep the episode duration and report no change when the edit button is dismissed', async () => {
            vi.mocked(setEpisodeDurationOverride).mockResolvedValue({ committed: false });
            const { result: promise } = await openModalFor([makeMedia()], 10);
            const { editButton, durationValue } = getEpisodeElements();

            editButton.click();
            await vi.waitFor(() => expect(setEpisodeDurationOverride).toHaveBeenCalled());

            expect(durationValue.textContent).toBe('24m');
            (document.querySelector('#activity-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBe(false);
        });

        it('should show a mixed episode placeholder and episode tooltip for anime', async () => {
            await openModalFor([makeMedia()], 10);
            expect(durationInput().placeholder).toBe('e.g. 2ep 1h');
            expect(durationInput().title).toContain('"3ep"');
        });

        it('should show the time placeholder for non-anime media', async () => {
            await openModalFor([makeMedia({ content_type: 'Manga', default_activity_type: 'Reading' })], 10);
            expect(durationInput().placeholder).toBe('e.g. 1h30m');
        });
    });

    describe('showExportCsvModal', () => {
        it('should resolve with "all" mode by default', async () => {
            const promise = showExportCsvModal();
            await vi.waitFor(() => queryOrThrow('#export-confirm'));
            
            (document.querySelector('#export-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result?.mode).toBe('all');
        });

        it('should resolve with custom range if selected', async () => {
            const promise = showExportCsvModal();
            await vi.waitFor(() => queryOrThrow('input[value="range"]'));
            
            const rangeRadio = document.querySelector('input[value="range"]') as HTMLInputElement;
            rangeRadio.checked = true;
            rangeRadio.dispatchEvent(new Event('change'));
            
            (document.querySelector('#export-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result?.mode).toBe('range');
            expect(result?.start).toBeDefined();
        });
    });

    describe('showActivityCsvConflictModal', () => {
        const analysis = {
            rows: [],
            groups: [{
                content: {
                    log_name: '<img src=x onerror=alert(1)>',
                    media_variant: 'Manga',
                    date: '2026-07-22',
                    duration: 30,
                    characters: 100,
                    activity_type: 'Reading',
                    notes: '<script>alert(1)</script>',
                },
                incoming_count: 2,
                existing_count: 1,
                media_exists: true,
            }],
        };

        it('requires an explicit choice, escapes content, and returns skip resolutions', async () => {
            const { customAlert } = await import('../../src/modal_base');
            const promise = showActivityCsvConflictModal(analysis);
            await vi.waitFor(() => queryOrThrow('#activity-conflict-confirm'));

            expect(document.querySelector('.activity-csv-conflict')?.textContent).toContain('<img src=x onerror=alert(1)>');
            expect(document.querySelector('.activity-csv-conflict img')).toBeNull();
            expect(document.querySelector('.activity-csv-conflict script')).toBeNull();
            (document.querySelector('#activity-conflict-confirm') as HTMLButtonElement).click();
            await vi.waitFor(() => expect(customAlert).toHaveBeenCalledWith(
                'Resolution Required',
                expect.stringContaining('every possible duplicate'),
            ));

            (document.querySelector('#activity-conflict-skip-all') as HTMLButtonElement).click();
            (document.querySelector('#activity-conflict-confirm') as HTMLButtonElement).click();
            await expect(promise).resolves.toEqual([{
                content: analysis.groups[0].content,
                action: 'skip_possible_overlaps',
            }]);
        });

        it('can import all rows separately or cancel without a resolution', async () => {
            const importPromise = showActivityCsvConflictModal(analysis);
            await vi.waitFor(() => queryOrThrow('#activity-conflict-import-all'));
            (document.querySelector('#activity-conflict-import-all') as HTMLButtonElement).click();
            (document.querySelector('#activity-conflict-confirm') as HTMLButtonElement).click();
            await expect(importPromise).resolves.toEqual([{
                content: analysis.groups[0].content,
                action: 'import_all',
            }]);

            const cancelPromise = showActivityCsvConflictModal(analysis);
            await vi.waitFor(() => queryOrThrow('#activity-conflict-cancel'));
            (document.querySelector('#activity-conflict-cancel') as HTMLButtonElement).click();
            await expect(cancelPromise).resolves.toBeNull();
        });

        it('returns immediately when there are no existing matches', async () => {
            await expect(showActivityCsvConflictModal({
                rows: [],
                groups: [{ ...analysis.groups[0], existing_count: 0 }],
            })).resolves.toEqual([]);
        });
    });
});

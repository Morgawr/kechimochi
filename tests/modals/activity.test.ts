import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showLogActivityModal, showExportCsvModal } from '../../src/activity_modal';
import * as api from '../../src/api';
import { Media } from '../../src/api';

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
    createOverlay: vi.fn(() => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        return {
            overlay,
            cleanup: vi.fn(() => overlay.remove())
        }
    })
}));

describe('modals/activity.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        vi.useFakeTimers();
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
                activity_type: 'Reading'
            });
        });

        it('should default activity type from the selected existing media title', async () => {
            const mockMedia = [
                {
                    id: 10,
                    title: 'Anime Item',
                    media_type: 'Watching',
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
                media_type: 'Reading',
                duration_minutes: 30,
                characters: 100,
                date: '2024-03-01',
                language: 'Japanese'
            };
            
            vi.mocked(api.getAllMedia).mockResolvedValue([{ 
                id: 456, 
                title: 'Test Media',
                media_type: 'Reading',
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

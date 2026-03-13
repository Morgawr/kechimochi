import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showLogActivityModal, showExportCsvModal } from '../../src/modals/activity';
import * as api from '../../src/api';
import { Media } from '../../src/api';

vi.mock('../../src/api', () => ({
    getAllMedia: vi.fn(),
    addLog: vi.fn(),
    addMedia: vi.fn(),
    updateMedia: vi.fn(),
}));

vi.mock('../../src/modals/calendar', () => ({
    buildCalendar: vi.fn(),
}));

vi.mock('../../src/modals/base', () => ({
    customPrompt: vi.fn(),
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
                date: expect.any(String)
            });
        });

        it('should create new media if it does not exist', async () => {
            vi.mocked(api.getAllMedia).mockResolvedValue([]);
            const { customPrompt } = await import('../../src/modals/base');
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
            expect(api.addMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Series' }));
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

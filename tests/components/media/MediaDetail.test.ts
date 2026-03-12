import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaDetail } from '../../../src/components/media/MediaDetail';
import * as api from '../../../src/api';

vi.mock('../../../src/api', () => ({
    getMilestones: vi.fn(),
    readFileBytes: vi.fn(),
    updateMedia: vi.fn(),
    getLogsForMedia: vi.fn(() => Promise.resolve([])),
    getSetting: vi.fn(),
    deleteMedia: vi.fn(),
    addMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    clearMilestones: vi.fn(),
    downloadAndSaveImage: vi.fn(),
}));

vi.mock('../../../src/importers', () => ({
    fetchMetadataForUrl: vi.fn(),
    getAvailableSourcesForContentType: vi.fn(() => ['VNDB']),
}));

import * as importers from '../../../src/importers';

vi.mock('../../../src/modals', () => ({
    customConfirm: vi.fn(),
    customAlert: vi.fn(),
    customPrompt: vi.fn(),
    showAddMilestoneModal: vi.fn(),
    showLogActivityModal: vi.fn(),
    showImportMergeModal: vi.fn(),
    showJitenSearchModal: vi.fn(),
}));

import * as modals from '../../../src/modals';

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:abc');

describe('MediaDetail', () => {
    let container: HTMLElement;
    const mockMedia = {
        id: 1,
        title: 'Test Media',
        status: 'Active',
        media_type: 'Reading',
        content_type: 'Novel',
        tracking_status: 'Ongoing',
        language: 'Japanese',
        description: 'Test Desc',
        extra_data: '{"Author":"Writer"}',
        cover_image: '/path/to/img.jpg'
    };
    const mockCallbacks = {
        onBack: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onNavigate: vi.fn(),
        onDelete: vi.fn(),
    };

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
    });

    it('should render media details correctly', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        
        await vi.waitUntil(() => (component as any).state.imgSrc === 'blob:abc');
        component.render();

        expect(container.textContent).toContain('Author');
        expect(container.textContent).toContain('Writer');
    });

    it('should handle extra field deletion', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const deleteExtraBtn = container.querySelector('.delete-extra-btn') as HTMLElement;
        await deleteExtraBtn.click();

        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
            extra_data: '{}'
        }));
    });

    it('should handle media deletion', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const deleteBtn = container.querySelector('#btn-delete-media-detail') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => expect(mockCallbacks.onDelete).toHaveBeenCalled());
        expect(modals.customConfirm).toHaveBeenCalled();
        expect(api.deleteMedia).toHaveBeenCalledWith(1);
    });

    it('should handle adding a milestone', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const newMilestone = { name: 'M1', duration: 100 };
        vi.mocked(modals.showAddMilestoneModal).mockResolvedValue(newMilestone as any);

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const addBtn = container.querySelector('#btn-add-milestone') as HTMLElement;
        await addBtn.click();

        expect(modals.showAddMilestoneModal).toHaveBeenCalled();
        expect(api.addMilestone).toHaveBeenCalledWith(newMilestone);
    });

    it('should edit fields on double click', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const titleEl = container.querySelector('#media-title') as HTMLElement;
        titleEl.dispatchEvent(new Event('dblclick'));

        const input = container.querySelector('.edit-input') as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = 'New Title';
        input.dispatchEvent(new Event('blur'));

        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
    });

    it('should handle metadata import', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const mockScraped = {
            title: 'Scraped',
            description: 'Scraped Desc',
            coverImageUrl: 'scraped.jpg',
            extraData: { 'Genre': 'New' }
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as any);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            description: 'Scraped Desc',
            extraData: { 'Genre': 'New' },
            coverImageUrl: 'scraped.jpg'
        });

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        vi.mocked(modals.customPrompt).mockResolvedValue('https://vndb.org/v1');
        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        await vi.waitFor(() => expect(modals.showImportMergeModal).toHaveBeenCalled());
        expect(api.updateMedia).toHaveBeenCalled();
    });

    it('should handle failed metadata import', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(importers.fetchMetadataForUrl).mockRejectedValue(new Error('Network error'));
        vi.mocked(modals.customPrompt).mockResolvedValue('https://badurl.com');

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith("Import Failed", expect.stringContaining("Network error")));
    });

    it('should handle image download failure during import', async () => {
        const mockScraped = {
            title: 'Scraped',
            coverImageUrl: 'scraped.jpg',
            extraData: {}
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as any);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            coverImageUrl: 'scraped.jpg',
            extraData: {}
        } as any);
        vi.mocked(api.downloadAndSaveImage).mockRejectedValue(new Error('Download failed'));
        vi.mocked(modals.customPrompt).mockResolvedValue('https://vndb.org/v1');

        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        const originalError = console.error;
        console.error = vi.fn();

        await vi.waitFor(() => expect(api.downloadAndSaveImage).toHaveBeenCalled());
        // The error is just logged to console, so it shouldn't alert and it should still update the media
        expect(api.updateMedia).toHaveBeenCalled();

        console.error = originalError;
    });

    it('should handle tracking status changes', async () => {
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const statusSelect = container.querySelector('#media-tracking-status') as HTMLSelectElement;
        statusSelect.value = 'Paused';
        statusSelect.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ tracking_status: 'Paused' })));
    });

    it('should handle marking as complete', async () => {
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const completeBtn = container.querySelector('#btn-mark-complete') as HTMLElement;
        completeBtn.click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ tracking_status: 'Complete' })));
    });

    it('should handle clearing metadata', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const clearBtn = container.querySelector('#btn-clear-meta') as HTMLElement;
        clearBtn.click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ extra_data: '{}' })));
    });

    it('should handle deleting all milestones', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const milestones = [{ id: 1, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        (component as any).state.milestones = milestones;
        component.render();

        const clearMilestonesBtn = container.querySelector('#btn-clear-milestones') as HTMLElement;
        clearMilestonesBtn.click();

        await vi.waitFor(() => expect(api.clearMilestones).toHaveBeenCalled());
    });

    it('should handle individual milestone deletion', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const milestones = [{ id: 123, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        (component as any).state.milestones = milestones;
        component.render();

        const deleteBtn = container.querySelector('.delete-milestone-btn') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => expect(api.deleteMilestone).toHaveBeenCalledWith(123));
    });

    it('should open log activity modal', async () => {
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        component.render();

        const logBtn = container.querySelector('#btn-new-media-entry') as HTMLElement;
        logBtn.click();

        await vi.waitFor(() => expect(modals.showLogActivityModal).toHaveBeenCalledWith(mockMedia.title));
    });

    it('should handle milestone deletion error', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.deleteMilestone).mockRejectedValue(new Error('Failed!'));
        const milestones = [{ id: 123, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        (component as any).state.milestones = milestones;
        component.render();

        const deleteBtn = container.querySelector('.delete-milestone-btn') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalled());
    });

    it('should handle all milestones deletion error', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.clearMilestones).mockRejectedValue(new Error('Failed!'));
        const component = new MediaDetail(container, { ...mockMedia } as any, [], [mockMedia as any], 0, mockCallbacks);
        (component as any).state.milestones = [{ id: 1, name: 'M1', duration: 10 }];
        component.render();

        const clearBtn = container.querySelector('#btn-clear-milestones') as HTMLElement;
        clearBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalled());
    });
});

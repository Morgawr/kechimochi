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

import { Media, Milestone } from '../../../src/api';
import * as importers from '../../../src/importers';
import { ScrapedMetadata } from '../../../src/importers';
vi.mock('../../../src/importers', () => ({
    fetchMetadataForUrl: vi.fn(),
    isValidImporterUrl: vi.fn(),
    getImportersForContentType: vi.fn(() => []),
    getAvailableSourcesForContentType: vi.fn(() => []),
}));

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
const mockServices = {
    isDesktop: vi.fn(() => true),
    supportsWindowControls: vi.fn(() => true),
    loadCoverImage: vi.fn(),
    pickAndUploadCover: vi.fn(),
};
vi.mock('../../../src/services', () => ({
    getServices: vi.fn(() => mockServices),
}));

// Mock URL.createObjectURL
vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:abc'),
    revokeObjectURL: vi.fn(),
});

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
        mockServices.isDesktop.mockReturnValue(true);
        mockServices.loadCoverImage.mockResolvedValue('https://covers.example/test.jpg');
        mockServices.pickAndUploadCover.mockResolvedValue('/path/to/new.jpg');
    });

    it('should render media details correctly', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        
        // @ts-expect-error - accessing private state for testing
        await vi.waitUntil(() => component.state.imgSrc === 'blob:abc');
        component.render();

        expect(container.textContent).toContain('Author');
        expect(container.textContent).toContain('Writer');
    });

    it('should load web cover images via services when not on desktop', async () => {
        mockServices.isDesktop.mockReturnValue(false);
        vi.mocked(api.getMilestones).mockResolvedValue([]);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();

        // @ts-expect-error - accessing private state for testing
        await vi.waitUntil(() => component.state.imgSrc === 'https://covers.example/test.jpg');

        expect(mockServices.loadCoverImage).toHaveBeenCalledWith('/path/to/img.jpg');
        expect(api.readFileBytes).not.toHaveBeenCalled();
    });

    it('should render character counts in stats and milestones', async () => {
        const milestones = [{ id: 1, name: 'M1', duration: 100, characters: 5000 }];
        vi.mocked(api.getMilestones).mockResolvedValue(milestones as unknown as Milestone[]);
        const mockLogs = [
            { id: 1, duration_minutes: 60, characters: 1000, date: '2024-03-01', media_id: 1, title: 'T1', media_type: 'Reading', language: 'Japanese' },
            { id: 2, duration_minutes: 30, characters: 500, date: '2024-03-02', media_id: 1, title: 'T1', media_type: 'Reading', language: 'Japanese' }
        ] as unknown as api.ActivitySummary[];
        vi.mocked(api.getLogsForMedia).mockResolvedValue(mockLogs);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, mockLogs, [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        
        await vi.waitUntil(() => container.querySelector('.milestone-item') !== null);
        
        expect(container.textContent).toContain('5,000 chars');
        expect(container.textContent).toContain('Total Chars: 1,500');
    });

    it('should hide duration in milestones if it is 0', async () => {
        const milestones = [{ id: 1, name: 'M1', duration: 0, characters: 5000 }];
        vi.mocked(api.getMilestones).mockResolvedValue(milestones as unknown as Milestone[]);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        
        await vi.waitUntil(() => container.querySelector('.milestone-item') !== null);
        
        expect(container.textContent).toContain('5,000 chars');
        expect(container.textContent).not.toContain('0m');
    });

    it('should preserve original extra field casing while editing keys', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);

        const component = new MediaDetail(
            container,
            { ...mockMedia, extra_data: '{"Character Count":"10,000"}' } as unknown as Media,
            [],
            [mockMedia as unknown as Media],
            0,
            mockCallbacks
        );
        component.triggerMount();
        component.render();

        const extraKey = container.querySelector('.editable-extra-key[data-key="Character Count"]') as HTMLElement;
        expect(extraKey.style.textTransform).toBe('uppercase');
        extraKey.dispatchEvent(new Event('dblclick'));

        const input = container.querySelector('.edit-input') as HTMLInputElement;
        expect(input.value).toBe('Character Count');
        expect(input.style.textTransform).toBe('none');
    });

    it('should compute reading speed with case-insensitive character count keys', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const completedMedia = {
            ...mockMedia,
            tracking_status: 'Complete',
            extra_data: '{"CHARACTER COUNT":"10,000"}'
        };
        const mockLogs = [
            { id: 1, duration_minutes: 60, characters: 1000, date: '2024-03-01', media_id: 1, title: 'T1', media_type: 'Reading', language: 'Japanese' }
        ] as unknown as api.ActivitySummary[];

        const component = new MediaDetail(container, completedMedia as unknown as Media, mockLogs, [completedMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();

        await vi.waitFor(() => expect(container.textContent).toContain('Est. Reading Speed'));
        expect(container.textContent).toContain('10,000 char/hr');
    });

    it('should handle extra field deletion', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const deleteExtraBtn = container.querySelector('.delete-extra-btn') as HTMLElement;
        deleteExtraBtn.click();

        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
            extra_data: '{}'
        }));
    });

    it('should handle media deletion', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.customConfirm).mockResolvedValue(true);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const deleteBtn = container.querySelector('#btn-delete-media-detail') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => {
            expect(mockCallbacks.onDelete).toHaveBeenCalled();
            expect(modals.customConfirm).toHaveBeenCalled();
            expect(api.deleteMedia).toHaveBeenCalledWith(1);
        });
    });

    it('should revoke object URLs on destroy', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        // @ts-expect-error - accessing private state for testing
        await vi.waitUntil(() => component.state.imgSrc === 'blob:abc');

        component.destroy();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:abc');
    });

    it('should handle adding a milestone', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const newMilestone = { name: 'M1', duration: 100 };
        vi.mocked(modals.showAddMilestoneModal).mockResolvedValue(newMilestone as unknown as Milestone);
        const logs = [
            { id: 1, duration_minutes: 40, characters: 200, date: '2024-03-01', media_id: 1, title: 'T1', media_type: 'Reading', language: 'Japanese' },
            { id: 2, duration_minutes: 20, characters: 300, date: '2024-03-02', media_id: 1, title: 'T1', media_type: 'Reading', language: 'Japanese' }
        ] as unknown as api.ActivitySummary[];

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, logs, [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const addBtn = container.querySelector('#btn-add-milestone') as HTMLElement;
        addBtn.click();

        await vi.waitFor(() => {
            expect(modals.showAddMilestoneModal).toHaveBeenCalledWith('Test Media', { duration: 60, characters: 500 });
            expect(api.addMilestone).toHaveBeenCalledWith(newMilestone);
        });
    });

    it('should edit fields on double click', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const titleEl = container.querySelector('#media-title') as HTMLElement;
        titleEl.dispatchEvent(new Event('dblclick'));

        const input = container.querySelector('.edit-input') as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = 'New Title';
        input.dispatchEvent(new Event('blur'));

        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
    });

    it('should collapse long descriptions and toggle expansion', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const longDescription = `${'Long description. '.repeat(40)}\nExtra line\nAnother line\nYet another line\nOne more line`;
        const component = new MediaDetail(container, { ...mockMedia, description: longDescription } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const description = container.querySelector('#media-description') as HTMLElement;
        const toggle = container.querySelector('#media-description-toggle') as HTMLButtonElement;

        expect(description.classList.contains('is-collapsed')).toBe(true);
        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('see more');

        toggle.click();

        await vi.waitFor(() => {
            const updatedDescription = container.querySelector('#media-description') as HTMLElement;
            const updatedToggle = container.querySelector('#media-description-toggle') as HTMLButtonElement;
            expect(updatedDescription.classList.contains('is-collapsed')).toBe(false);
            expect(updatedToggle.getAttribute('aria-expanded')).toBe('true');
            expect(updatedToggle.textContent).toContain('see less');
        });
    });

    it('should not show a toggle for short descriptions', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const component = new MediaDetail(container, { ...mockMedia, description: 'Short description' } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        expect(container.querySelector('#media-description-toggle')).toBeNull();
        expect(container.querySelector('#media-description')?.classList.contains('is-collapsed')).toBe(false);
    });

    it('should handle metadata import', async () => {
        vi.mocked(importers.getAvailableSourcesForContentType).mockReturnValue(['MockSource']);
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const mockScraped = {
            title: 'Scraped',
            description: 'Scraped Desc',
            coverImageUrl: 'scraped.jpg',
            extraData: { 'Genre': 'New' }
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as unknown as ScrapedMetadata);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            description: 'Scraped Desc',
            extraData: { 'Genre': 'New' },
            coverImageUrl: 'scraped.jpg'
        });

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        vi.mocked(modals.customPrompt).mockResolvedValue('https://vndb.org/v1');
        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        await vi.waitFor(() => expect(modals.showImportMergeModal).toHaveBeenCalled());
        expect(api.updateMedia).toHaveBeenCalled();
    });

    it('should clear metadata only when confirmed', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.customConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const clearBtn = container.querySelector('#btn-clear-meta') as HTMLButtonElement;
        clearBtn.click();
        await vi.waitFor(() => expect(modals.customConfirm).toHaveBeenCalledTimes(1));
        expect(api.updateMedia).not.toHaveBeenCalled();

        clearBtn.click();
        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ extra_data: '{}' })));
    });

    it('should do nothing when adding an extra field is cancelled', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.customPrompt).mockResolvedValue(null);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        (container.querySelector('#btn-add-extra') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(modals.customPrompt).toHaveBeenCalled());
        expect(api.updateMedia).not.toHaveBeenCalled();
    });

    it('should merge duplicate extra field names case-insensitively when adding a field', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.customPrompt).mockResolvedValueOnce('author').mockResolvedValueOnce('Rewriter');

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        (container.querySelector('#btn-add-extra') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalled());
        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
            extra_data: '{"Author":"Rewriter"}'
        }));
    });

    it('should merge imported extra field names case-insensitively', async () => {
        vi.mocked(importers.getAvailableSourcesForContentType).mockReturnValue(['MockSource']);
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const mockScraped = {
            title: 'Scraped',
            extraData: { 'genre': 'New' }
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as unknown as ScrapedMetadata);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            extraData: { 'genre': 'New' }
        });

        const component = new MediaDetail(
            container,
            { ...mockMedia, extra_data: '{"Genre":"Old"}' } as unknown as Media,
            [],
            [mockMedia as unknown as Media],
            0,
            mockCallbacks
        );
        component.triggerMount();
        component.render();

        vi.mocked(modals.customPrompt).mockResolvedValue('https://vndb.org/v1');
        (container.querySelector('#btn-import-meta') as HTMLElement).click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalled());
        expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
            extra_data: '{"Genre":"New"}'
        }));
    });

    it('should refresh logs after creating a new media entry', async () => {
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([{
            id: 99,
            title: 'Updated',
            media_id: 1,
            media_type: 'Reading',
            language: 'Japanese',
            date: '2024-03-02',
            duration_minutes: 45,
            characters: 0,
        }] as unknown as api.ActivitySummary[]);

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        (container.querySelector('#btn-new-media-entry') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(api.getLogsForMedia).toHaveBeenCalledWith(1));
    });

    it('should automatically update content type if Unknown during metadata import', async () => {
        const unknownMedia = { ...mockMedia, content_type: 'Unknown', media_type: 'None' };
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        const mockScraped = {
            title: 'Scraped',
            contentType: 'Anime',
            extraData: {}
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as unknown as ScrapedMetadata);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            extraData: {}
        } as unknown as { extraData: Record<string, string> });

        const component = new MediaDetail(container, unknownMedia as unknown as Media, [], [unknownMedia as unknown as Media], 0, mockCallbacks);
        component.render();

        vi.mocked(modals.customPrompt).mockResolvedValue('https://jiten.moe/decks/1');
        
        // Use performMetadataImport directly since it's private but we need to test its logic
        // Alternatively, trigger it via search-jiten button
        const searchJitenBtn = container.querySelector('#btn-search-jiten') as HTMLElement;
        vi.mocked(modals.showJitenSearchModal).mockResolvedValue('https://jiten.moe/decks/1');
        searchJitenBtn.click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
            content_type: 'Anime',
            media_type: 'Watching'
        })));
    });

    it('should handle failed metadata import', async () => {
        vi.mocked(importers.getAvailableSourcesForContentType).mockReturnValue(['MockSource']);
        vi.mocked(api.getMilestones).mockResolvedValue([]);
        vi.mocked(importers.fetchMetadataForUrl).mockRejectedValue(new Error('Network error'));
        vi.mocked(modals.customPrompt).mockResolvedValue('https://badurl.com');

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalledWith("Import Failed", expect.stringContaining("Network error")));
    });

    it('should handle image download failure during import', async () => {
        vi.mocked(importers.getAvailableSourcesForContentType).mockReturnValue(['MockSource']);
        const mockScraped = {
            title: 'Scraped',
            coverImageUrl: 'scraped.jpg',
            extraData: {}
        };
        vi.mocked(importers.fetchMetadataForUrl).mockResolvedValue(mockScraped as unknown as ScrapedMetadata);
        vi.mocked(modals.showImportMergeModal).mockResolvedValue({
            coverImageUrl: 'scraped.jpg',
            extraData: {}
        } as unknown as ScrapedMetadata);
        vi.mocked(api.downloadAndSaveImage).mockRejectedValue(new Error('Download failed'));
        vi.mocked(modals.customPrompt).mockResolvedValue('https://vndb.org/v1');

        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const importBtn = container.querySelector('#btn-import-meta') as HTMLElement;
        importBtn.click();

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await vi.waitFor(() => expect(api.downloadAndSaveImage).toHaveBeenCalled());
        // The error is just logged to console, so it shouldn't alert and it should still update the media
        expect(api.updateMedia).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('should handle tracking status changes', async () => {
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const statusSelect = container.querySelector('#media-tracking-status') as HTMLSelectElement;
        statusSelect.value = 'Paused';
        statusSelect.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ tracking_status: 'Paused' })));
    });

    it('should handle marking as complete', async () => {
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const completeBtn = container.querySelector('#btn-mark-complete') as HTMLElement;
        completeBtn.click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ tracking_status: 'Complete' })));
    });

    it('should handle clearing metadata', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const clearBtn = container.querySelector('#btn-clear-meta') as HTMLElement;
        clearBtn.click();

        await vi.waitFor(() => expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ extra_data: '{}' })));
    });

    it('should handle deleting all milestones', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const milestones = [{ id: 1, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        // @ts-expect-error - accessing private state
        component.state.milestones = milestones as unknown as Milestone[];
        component.render();

        const clearMilestonesBtn = container.querySelector('#btn-clear-milestones') as HTMLElement;
        clearMilestonesBtn.click();

        await vi.waitFor(() => expect(api.clearMilestones).toHaveBeenCalled());
    });

    it('should handle individual milestone deletion', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        const milestones = [{ id: 123, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        // @ts-expect-error - accessing private state
        component.state.milestones = milestones as unknown as Milestone[];
        component.render();

        const deleteBtn = container.querySelector('.delete-milestone-btn') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => expect(api.deleteMilestone).toHaveBeenCalledWith(123));
    });

    it('should open log activity modal', async () => {
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        component.render();

        const logBtn = container.querySelector('#btn-new-media-entry') as HTMLElement;
        logBtn.click();

        await vi.waitFor(() => expect(modals.showLogActivityModal).toHaveBeenCalledWith(mockMedia.title));
    });

    it('should handle milestone deletion error', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.deleteMilestone).mockRejectedValue(new Error('Failed!'));
        const milestones = [{ id: 123, name: 'M1', duration: 10 }];
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        component.triggerMount();
        // @ts-expect-error - accessing private state
        component.state.milestones = milestones as unknown as Milestone[];
        component.render();

        const deleteBtn = container.querySelector('.delete-milestone-btn') as HTMLElement;
        deleteBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalled());
    });

    it('should handle all milestones deletion error', async () => {
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        vi.mocked(api.clearMilestones).mockRejectedValue(new Error('Failed!'));
        const component = new MediaDetail(container, { ...mockMedia } as unknown as Media, [], [mockMedia as unknown as Media], 0, mockCallbacks);
        // @ts-expect-error - accessing private state
        component.state.milestones = [{ id: 1, name: 'M1', duration: 10 }] as unknown as Milestone[];
        component.triggerMount();
        component.render();

        const clearBtn = container.querySelector('#btn-clear-milestones') as HTMLElement;
        clearBtn.click();

        await vi.waitFor(() => expect(modals.customAlert).toHaveBeenCalled());
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaGrid } from '../../../src/components/media/MediaGrid';
import { MediaItem } from '../../../src/components/media/MediaItem';
import { showAddMediaModal } from '../../../src/modals';
import * as api from '../../../src/api';
import { Media } from '../../../src/api';

vi.mock('../../../src/components/media/MediaItem', () => ({
    MediaItem: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    }))
}));

vi.mock('../../../src/modals', () => ({
    showAddMediaModal: vi.fn(),
}));

vi.mock('../../../src/api', () => ({
    addMedia: vi.fn(),
}));

describe('MediaGrid', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('should render items correctly', async () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Anime' },
            { id: 2, title: 'Item 2', status: 'Active', content_type: 'Manga' },
        ];
        const component = new MediaGrid(
            container,
            { mediaList: mediaList as unknown as Media[], searchQuery: '', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            vi.fn()
        );

        component.render();
        
        // Items are rendered in batches using setTimeout
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Library');
    });

    it('should filter items based on search query', async () => {
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active' },
            { id: 2, title: 'Beta', status: 'Active' },
        ];
        const component = new MediaGrid(
            container,
            { mediaList: mediaList as unknown as Media[], searchQuery: 'Alp', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            vi.fn()
        );

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(1);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Alpha' }), expect.anything());
    });

    it('should trigger add media flow', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue({ title: 'New', type: 'Anime', contentType: 'Anime' });
        vi.mocked(api.addMedia).mockResolvedValue(123);
        const onDataChange = vi.fn();

        const component = new MediaGrid(
            container,
            { mediaList: [], searchQuery: '', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            onDataChange
        );

        component.render();
        const addBtn = container.querySelector('#btn-add-media-grid') as HTMLElement;
        addBtn.click();

        await vi.waitUntil(() => onDataChange.mock.calls.length > 0);

        expect(showAddMediaModal).toHaveBeenCalled();
        expect(api.addMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'New' }));
        expect(onDataChange).toHaveBeenCalledWith(123);
    });

    it('should not add media when the modal is cancelled', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue(null);
        const onDataChange = vi.fn();

        const component = new MediaGrid(
            container,
            { mediaList: [], searchQuery: '', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            onDataChange
        );

        component.render();
        (container.querySelector('#btn-add-media-grid') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(showAddMediaModal).toHaveBeenCalled());
        expect(api.addMedia).not.toHaveBeenCalled();
        expect(onDataChange).not.toHaveBeenCalled();
    });

    it('should notify filter changes and hide archived items', () => {
        const onFilterChange = vi.fn();
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Beta', status: 'Archived', content_type: 'Anime', tracking_status: 'Paused' },
        ];

        const component = new MediaGrid(
            container,
            { mediaList: mediaList as unknown as Media[], searchQuery: '', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            vi.fn(),
            onFilterChange
        );

        component.render();
        vi.runAllTimers();

        const hideArchived = container.querySelector('#grid-hide-archived') as HTMLInputElement;
        hideArchived.checked = true;
        hideArchived.dispatchEvent(new Event('change'));
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(3);
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            typeFilter: 'All',
            statusFilter: 'All',
            hideArchived: true,
        });
    });

    it('should refresh data and show empty-state text when filters match nothing', async () => {
        const onDataChange = vi.fn().mockResolvedValue(undefined);
        const component = new MediaGrid(
            container,
            { mediaList: [{ id: 1, title: 'Only Item', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as unknown as Media], searchQuery: 'zzz', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
            vi.fn(),
            onDataChange
        );

        component.render();
        expect(container.textContent).toContain('No media matches your filters.');

        const refreshBtn = container.querySelector('#btn-refresh-grid') as HTMLButtonElement;
        refreshBtn.click();

        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalled());
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaGrid } from '../../../src/components/media/MediaGrid';
import { MediaItem } from '../../../src/components/media/MediaItem';
import { showAddMediaModal } from '../../../src/modals';
import * as api from '../../../src/api';

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
            { mediaList: mediaList as any, searchQuery: '', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
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
            { mediaList: mediaList as any, searchQuery: 'Alp', typeFilter: 'All', statusFilter: 'All', hideArchived: false },
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
});

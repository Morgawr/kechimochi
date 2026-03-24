import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaView } from '../../src/components/media_view';
import * as api from '../../src/api';
import { Media } from '../../src/api';
import { MediaGrid } from '../../src/components/media/MediaGrid';
import { MediaDetail } from '../../src/components/media/MediaDetail';

vi.mock('../../src/api', () => ({
    getAllMedia: vi.fn(),
    getLogsForMedia: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/components/media/MediaGrid', () => ({
    MediaGrid: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        destroy: vi.fn(),
    }))
}));

vi.mock('../../src/components/media/MediaDetail', () => ({
    MediaDetail: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        destroy: vi.fn(),
    }))
}));

describe('MediaView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.clearAllMocks();
        vi.mocked(api.getSetting).mockResolvedValue(null);
    });

    afterEach(() => {
        container.remove();
    });

    it('should load data and render grid by default', async () => {
        const mockMedia = [{ id: 1, title: 'Test' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getSetting).mockResolvedValue('true');

        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        expect(api.getAllMedia).toHaveBeenCalled();
        expect(MediaGrid).toHaveBeenCalled();
        expect(vi.mocked(MediaGrid).mock.calls[0][1]).toEqual(expect.objectContaining({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: true,
        }));
        // @ts-expect-error - accessing private state
        expect(component.state.viewMode).toBe('grid');
    });

    it('should switch to detail view when a media item is clicked in the grid', async () => {
        const mockMedia = [{ id: 1, title: 'T1' }, { id: 2, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        // Simulate grid item click via callback passed to MediaGrid
        const onSelect = vi.mocked(MediaGrid).mock.calls[0][2];
        onSelect(2); // select ID 2

        await vi.waitFor(() => {
            // @ts-expect-error - accessing private state
            expect(component.state.viewMode).toBe('detail');
            // @ts-expect-error - accessing private state
            expect(component.state.currentIndex).toBe(1);
        });
        expect(MediaDetail).toHaveBeenCalled();
    });

    it('should handle keyboard navigation in detail view', async () => {
        const mockMedia = [{ id: 1, title: 'T1' }, { id: 2, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        // @ts-expect-error - accessing private state
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state
        component.state.currentMediaList = mockMedia as unknown as Media[];
        
        component.render();

        // We need the root element to be present for the listener to trigger
        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toBe(1));

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.viewMode).toBe('grid'));
    });

    it('should handle grid filter changes and persist hideArchived', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        const onFilterChange = vi.mocked(MediaGrid).mock.calls[0][4];
        onFilterChange!({
            statusFilters: ['Ongoing'],
            typeFilters: ['Anime'],
            hideArchived: true
        });

        expect(api.setSetting).toHaveBeenCalledWith('grid_hide_archived', 'true');
        // @ts-expect-error - accessing private state
        expect(component.state.gridFilters).toEqual({
            searchQuery: '',
            statusFilters: ['Ongoing'],
            typeFilters: ['Anime'],
            hideArchived: true
        });
    });

    it('should fall back to grid if media not found in detail view', async () => {
        const component = new MediaView(container);
        // @ts-expect-error - accessing private state
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state
        component.state.currentMediaList = [];
        // @ts-expect-error - accessing private state
        component.state.isInitialized = true;
        
        component.render();
        // @ts-expect-error - accessing private state
        expect(component.state.viewMode).toBe('grid');
    });

    it('should handle navigation and jumping to media', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);
        
        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        // 1. Jump to media
        const onDataChange = vi.mocked(MediaGrid).mock.calls[0][3];
        await onDataChange(20);
        expect(api.getAllMedia).toHaveBeenCalledTimes(2);

        // 2. Render Detail (starts at index 1 because of jump to 20)
        // @ts-expect-error - calling private method
        component.renderDetail(container);
        const detailCallbacks = vi.mocked(MediaDetail).mock.calls[0][5];

        // 3. Detail callbacks
        detailCallbacks.onNext(); // 1 -> 0
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toEqual(0));

        detailCallbacks.onPrev(); // 0 -> 1
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toEqual(1));

        detailCallbacks.onNavigate(0); // Jump to index 0
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toEqual(0));

        detailCallbacks.onBack();
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.viewMode).toEqual('grid'));

        // 4. Delete callback
        // @ts-expect-error - accessing private state
        component.state.viewMode = 'detail';
        detailCallbacks.onDelete();
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.viewMode).toEqual('grid'));
    });

    it('should handle keyboard navigation', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as unknown as Media[]);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);
        
        const component = new MediaView(container);
        await vi.waitFor(() => {
            component.render();
            // @ts-expect-error - accessing private state
            if (!component.state.isInitialized) throw new Error('Not initialized');
        });

        // Must be in detail view and have media root element
        container.innerHTML = '<div id="media-root"></div>';
        // @ts-expect-error - accessing private state
        component.state.viewMode = 'detail';
        // @ts-expect-error - accessing private state
        component.state.currentMediaList = mockMedia as unknown as Media[];
        // @ts-expect-error - accessing private state
        component.state.currentIndex = 0;

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toEqual(1));

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.currentIndex).toEqual(0));

        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        // @ts-expect-error - accessing private state
        await vi.waitFor(() => expect(component.state.viewMode).toEqual('grid'));
    });
});

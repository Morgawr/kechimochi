import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaView } from '../../src/components/media_view';
import * as api from '../../src/api';
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
    });

    afterEach(() => {
        container.remove();
    });

    it('should load data and render grid by default', async () => {
        const mockMedia = [{ id: 1, title: 'Test' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as any);
        vi.mocked(api.getSetting).mockResolvedValue('false');

        const component = new MediaView(container);
        await component.render();

        expect(api.getAllMedia).toHaveBeenCalled();
        expect(MediaGrid).toHaveBeenCalled();
        expect((component as any).state.viewMode).toBe('grid');
    });

    it('should switch to detail view when a media item is clicked in the grid', async () => {
        const mockMedia = [{ id: 1, title: 'T1' }, { id: 2, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        await component.render();

        // Simulate grid item click via callback passed to MediaGrid
        const onSelect = vi.mocked(MediaGrid).mock.calls[0][2];
        onSelect(2); // select ID 2

        await component.render();

        expect((component as any).state.viewMode).toBe('detail');
        expect((component as any).state.currentIndex).toBe(1);
        expect(MediaDetail).toHaveBeenCalled();
    });

    it('should handle keyboard navigation in detail view', async () => {
        const mockMedia = [{ id: 1, title: 'T1' }, { id: 2, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);

        const component = new MediaView(container);
        (component as any).state.viewMode = 'detail';
        (component as any).state.isInitialized = true;
        (component as any).state.currentMediaList = mockMedia as any;
        
        await component.render();

        // We need the root element to be present for the listener to trigger
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect((component as any).state.currentIndex).toBe(1);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect((component as any).state.viewMode).toBe('grid');
    });

    it('should handle grid filter changes', async () => {
        vi.mocked(api.getAllMedia).mockResolvedValue([]);
        const component = new MediaView(container);
        await component.render();

        const onFilterChange = vi.mocked(MediaGrid).mock.calls[0][4];
        onFilterChange!({ hideArchived: true });

        expect(api.setSetting).toHaveBeenCalledWith('grid_hide_archived', 'true');
    });

    it('should fall back to grid if media not found in detail view', async () => {
        const component = new MediaView(container);
        (component as any).state.viewMode = 'detail';
        (component as any).state.currentMediaList = [];
        
        await component.render();
        expect((component as any).state.viewMode).toBe('grid');
    });

    it('should handle navigation and jumping to media', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);
        
        const component = new MediaView(container);
        await component.render();

        // 1. Jump to media
        const onDataChange = vi.mocked(MediaGrid).mock.calls[0][3];
        await onDataChange(20);
        expect(api.getAllMedia).toHaveBeenCalledTimes(2);

        // 2. Render Detail (starts at index 1 because of jump to 20)
        await (component as any).renderDetail(container);
        const detailCallbacks = vi.mocked(MediaDetail).mock.calls[0][5];

        // 3. Detail callbacks
        detailCallbacks.onNext(); // 1 -> 0
        await vi.waitFor(() => expect((component as any).state.currentIndex).toEqual(0));

        detailCallbacks.onPrev(); // 0 -> 1
        await vi.waitFor(() => expect((component as any).state.currentIndex).toEqual(1));

        detailCallbacks.onNavigate(0); // Jump to index 0
        await vi.waitFor(() => expect((component as any).state.currentIndex).toEqual(0));

        detailCallbacks.onBack();
        await vi.waitFor(() => expect((component as any).state.viewMode).toEqual('grid'));

        // 4. Delete callback
        (component as any).state.viewMode = 'detail';
        detailCallbacks.onDelete();
        await vi.waitFor(() => expect((component as any).state.viewMode).toEqual('grid'));
    });

    it('should handle keyboard navigation', async () => {
        const mockMedia = [{ id: 10, title: 'T1' }, { id: 20, title: 'T2' }];
        vi.mocked(api.getAllMedia).mockResolvedValue(mockMedia as any);
        vi.mocked(api.getLogsForMedia).mockResolvedValue([]);
        
        const component = new MediaView(container);
        await component.render();

        // Must be in detail view and have media root element
        container.innerHTML = '<div id="media-root"></div>';
        (component as any).state.viewMode = 'detail';
        (component as any).state.currentMediaList = mockMedia;
        (component as any).state.currentIndex = 0;

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        await vi.waitFor(() => expect((component as any).state.currentIndex).toEqual(1));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        await vi.waitFor(() => expect((component as any).state.currentIndex).toEqual(0));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await vi.waitFor(() => expect((component as any).state.viewMode).toEqual('grid'));
    });
});

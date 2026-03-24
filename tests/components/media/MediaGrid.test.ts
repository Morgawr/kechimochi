import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const createState = (overrides: Partial<{
    mediaList: Media[];
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
}> = {}) => ({
    mediaList: [],
    searchQuery: '',
    typeFilters: [],
    statusFilters: [],
    hideArchived: false,
    ...overrides
});

describe('MediaGrid', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should render items correctly', () => {
        const mediaList = [
            { id: 1, title: 'Item 1', status: 'Active', content_type: 'Anime' },
            { id: 2, title: 'Item 2', status: 'Active', content_type: 'Manga' },
        ];
        const component = new MediaGrid(
            container,
            createState({ mediaList: mediaList as Media[] }),
            vi.fn(),
            vi.fn()
        );

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Library');
    });

    it('should filter items based on search query', () => {
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active' },
            { id: 2, title: 'Beta', status: 'Active' },
        ];
        const component = new MediaGrid(
            container,
            createState({ mediaList: mediaList as Media[], searchQuery: 'Alp' }),
            vi.fn(),
            vi.fn()
        );

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(1);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Alpha' }), expect.anything());
    });

    it('should keep the filter tray collapsed by default and toggle it open and closed', () => {
        const component = new MediaGrid(
            container,
            createState(),
            vi.fn(),
            vi.fn()
        );

        component.render();

        const panel = container.querySelector('#media-grid-filter-panel') as HTMLElement;
        expect(panel.classList.contains('is-collapsed')).toBe(true);
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect((container.querySelector('#btn-toggle-filters') as HTMLButtonElement).textContent).toContain('Filters');
        expect((container.querySelector('#btn-toggle-filters') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');

        const toggle = container.querySelector('#btn-toggle-filters') as HTMLButtonElement;
        toggle.click();

        const expandedPanel = container.querySelector('#media-grid-filter-panel') as HTMLElement;
        expect(expandedPanel.classList.contains('is-expanded')).toBe(true);
        expect(expandedPanel.getAttribute('aria-hidden')).toBe('false');
        expect(container.querySelectorAll('.media-grid-chip-list').length).toBe(2);
        expect((container.querySelector('#btn-toggle-filters') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');

        (container.querySelector('#btn-toggle-filters') as HTMLButtonElement).click();
        expect((container.querySelector('#media-grid-filter-panel') as HTMLElement).classList.contains('is-collapsed')).toBe(true);
    });

    it('should show an active filter count when the tray is collapsed', () => {
        const component = new MediaGrid(
            container,
            createState({
                statusFilters: ['Ongoing'],
                typeFilters: ['Anime']
            }),
            vi.fn(),
            vi.fn()
        );

        component.render();

        expect(container.querySelector('.media-grid-filter-count')?.textContent).toBe('2');
    });

    it('should filter cumulatively across status and type selections', () => {
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Beta', status: 'Active', content_type: 'Visual Novel', tracking_status: 'Ongoing' },
            { id: 3, title: 'Gamma', status: 'Active', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 4, title: 'Delta', status: 'Active', content_type: 'Anime', tracking_status: 'Complete' },
        ];
        const component = new MediaGrid(
            container,
            createState({
                mediaList: mediaList as Media[],
                statusFilters: ['Ongoing'],
                typeFilters: ['Anime', 'Visual Novel']
            }),
            vi.fn(),
            vi.fn()
        );

        component.render();
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(2);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Alpha' }), expect.anything());
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Beta' }), expect.anything());
    });

    it('should clear status and type filters when All is clicked', () => {
        const onFilterChange = vi.fn();
        const component = new MediaGrid(
            container,
            createState({
                mediaList: [{ id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media],
                statusFilters: ['Ongoing'],
                typeFilters: ['Anime']
            }),
            vi.fn(),
            vi.fn(),
            onFilterChange
        );

        component.render();
        (container.querySelector('#btn-toggle-filters') as HTMLButtonElement).click();

        (container.querySelector('[data-filter-group="status"][data-filter-value="All"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: ['Anime'],
            hideArchived: false,
        });

        (container.querySelector('[data-filter-group="type"][data-filter-value="All"]') as HTMLButtonElement).click();
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: false,
        });
    });

    it('should keep hide archived separate from chip filtering', () => {
        const onFilterChange = vi.fn();
        const mediaList = [
            { id: 1, title: 'Alpha', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 2, title: 'Beta', status: 'Archived', content_type: 'Anime', tracking_status: 'Paused' },
        ];

        const component = new MediaGrid(
            container,
            createState({ mediaList: mediaList as Media[] }),
            vi.fn(),
            vi.fn(),
            onFilterChange
        );

        component.render();
        vi.runAllTimers();
        vi.mocked(MediaItem).mockClear();

        const hideArchived = container.querySelector('#grid-hide-archived') as HTMLInputElement;
        hideArchived.checked = true;
        hideArchived.dispatchEvent(new Event('change'));
        vi.runAllTimers();

        expect(MediaItem).toHaveBeenCalledTimes(1);
        expect(vi.mocked(MediaItem)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Alpha' }), expect.anything());
        expect(onFilterChange).toHaveBeenLastCalledWith({
            searchQuery: '',
            statusFilters: [],
            typeFilters: [],
            hideArchived: true,
        });
    });

    it('should trigger add media flow', async () => {
        vi.mocked(showAddMediaModal).mockResolvedValue({ title: 'New', type: 'Anime', contentType: 'Anime' });
        vi.mocked(api.addMedia).mockResolvedValue(123);
        const onDataChange = vi.fn();

        const component = new MediaGrid(
            container,
            createState(),
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
            createState(),
            vi.fn(),
            onDataChange
        );

        component.render();
        (container.querySelector('#btn-add-media-grid') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(showAddMediaModal).toHaveBeenCalled());
        expect(api.addMedia).not.toHaveBeenCalled();
        expect(onDataChange).not.toHaveBeenCalled();
    });

    it('should refresh data and show empty-state text when filters match nothing', async () => {
        const onDataChange = vi.fn().mockResolvedValue(undefined);
        const component = new MediaGrid(
            container,
            createState({
                mediaList: [{ id: 1, title: 'Only Item', status: 'Active', content_type: 'Anime', tracking_status: 'Ongoing' } as Media],
                searchQuery: 'zzz'
            }),
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

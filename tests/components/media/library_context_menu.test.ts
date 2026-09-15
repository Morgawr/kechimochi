import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLibraryContextMenu } from '../../../src/media/library_context_menu';
import type { Media } from '../../../src/api';
import * as mediaActions from '../../../src/media/media_actions';

vi.mock('../../../src/api', () => ({
    getLogsForMedia: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../../src/media/media_actions', () => ({
    canAddMilestone: vi.fn((media: Media) => Boolean(media.uid?.trim())),
    canMarkComplete: vi.fn((media: Media) => media.tracking_status !== 'Complete'),
    addLogForMedia: vi.fn(() => Promise.resolve({ committed: true })),
    addMilestoneForMedia: vi.fn(() => Promise.resolve({ committed: true })),
    markMediaComplete: vi.fn(() => Promise.resolve({ committed: true })),
    toggleMediaArchived: vi.fn(() => Promise.resolve({ committed: true })),
    deleteMediaWithConfirmation: vi.fn(() => Promise.resolve({ committed: false })),
}));

function openMenu(overrides: Partial<Media> = {}, onActionCommitted = vi.fn()) {
    const media: Media = {
        id: 1,
        uid: 'uid-1',
        title: 'Some Media',
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Manga',
        tracking_status: 'Ongoing',
        ...overrides,
    };
    openLibraryContextMenu({ media, clientX: 10, clientY: 10, onActionCommitted });
    return { media, onActionCommitted };
}

function menuItemLabels(): string[] {
    return Array.from(document.querySelectorAll('.popup-menu-item span')).map((el) => el.textContent ?? '');
}

describe('openLibraryContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it.each([
        { media: 'an ongoing media', overrides: {}, labels: ['Add log', 'Add milestone', 'Mark complete', 'Archive', 'Delete'] },
        { media: 'an already complete media', overrides: { tracking_status: 'Complete' }, labels: ['Add log', 'Add milestone', 'Archive', 'Delete'] },
        { media: 'a media with no uid', overrides: { uid: undefined }, labels: ['Add log', 'Mark complete', 'Archive', 'Delete'] },
        { media: 'an archived media', overrides: { status: 'Archived' }, labels: ['Add log', 'Add milestone', 'Mark complete', 'Unarchive', 'Delete'] },
    ])('offers the right items in order for $media', ({ overrides, labels }) => {
        openMenu(overrides);
        expect(menuItemLabels()).toEqual(labels);
    });

    it('separates Delete from the rest and marks it as danger', () => {
        openMenu();

        const separator = document.querySelector('.popup-menu-separator');
        expect(separator?.nextElementSibling?.getAttribute('data-action-id')).toBe('delete');
        expect(document.querySelector('.popup-menu-item-danger')?.textContent).toContain('Delete');
    });

    it('reports a committed action to its caller, and a cancelled one not at all', async () => {
        const { media, onActionCommitted } = openMenu();

        document.querySelector<HTMLButtonElement>('[data-action-id="markComplete"]')!.click();
        await vi.waitFor(() => expect(onActionCommitted).toHaveBeenCalledOnce());
        expect(mediaActions.markMediaComplete).toHaveBeenCalledWith(media);

        openMenu({}, onActionCommitted);
        document.querySelector<HTMLButtonElement>('[data-action-id="delete"]')!.click();
        await vi.waitFor(() => expect(mediaActions.deleteMediaWithConfirmation).toHaveBeenCalled());
        expect(onActionCommitted).toHaveBeenCalledOnce();
    });

    it('fetches the media logs for the milestone action', async () => {
        openMenu();

        document.querySelector<HTMLButtonElement>('[data-action-id="addMilestone"]')!.click();

        await vi.waitFor(() => expect(mediaActions.addMilestoneForMedia).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1 }),
            [],
        ));
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    addLogForMedia,
    addMilestoneForMedia,
    canAddMilestone,
    canMarkComplete,
    deleteMediaWithConfirmation,
    markMediaComplete,
    toggleMediaArchived,
} from '../../../src/media/media_actions';
import type { ActivitySummary, Media } from '../../../src/api';
import * as api from '../../../src/api';
import { showLogActivityModal } from '../../../src/activity_modal';
import { showAddMilestoneModal } from '../../../src/milestone_modal';
import { customAlert, customConfirm } from '../../../src/modal_base';
import { EVENTS } from '../../../src/constants';

vi.mock('../../../src/api', () => ({
    addMilestone: vi.fn(),
    deleteMedia: vi.fn(),
    updateMedia: vi.fn(),
}));

vi.mock('../../../src/activity_modal', () => ({
    showLogActivityModal: vi.fn(),
}));

vi.mock('../../../src/milestone_modal', () => ({
    showAddMilestoneModal: vi.fn(),
}));

vi.mock('../../../src/modal_base', () => ({
    customAlert: vi.fn(),
    customConfirm: vi.fn(),
}));

function makeMedia(overrides: Partial<Media> = {}): Media {
    return {
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
}

function makeLog(durationMinutes: number, characters: number): ActivitySummary {
    return {
        id: 1,
        media_id: 1,
        title: 'x',
        activity_type: 'Reading',
        duration_minutes: durationMinutes,
        characters,
        date: '2026-01-01',
        language: 'Japanese',
        notes: '',
    };
}

describe('media actions', () => {
    let dataChangedListener: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        dataChangedListener = vi.fn();
        globalThis.addEventListener(EVENTS.LOCAL_DATA_CHANGED, dataChangedListener);
    });

    afterEach(() => {
        globalThis.removeEventListener(EVENTS.LOCAL_DATA_CHANGED, dataChangedListener);
    });

    describe('canAddMilestone', () => {
        it('requires a non-blank uid', () => {
            expect(canAddMilestone(makeMedia({ uid: 'uid-1' }))).toBe(true);
            expect(canAddMilestone(makeMedia({ uid: '   ' }))).toBe(false);
            expect(canAddMilestone(makeMedia({ uid: undefined }))).toBe(false);
        });
    });

    describe('canMarkComplete', () => {
        it('is false only for an already Complete media', () => {
            expect(canMarkComplete(makeMedia({ tracking_status: 'Ongoing' }))).toBe(true);
            expect(canMarkComplete(makeMedia({ tracking_status: 'Complete' }))).toBe(false);
        });
    });

    describe('addLogForMedia', () => {
        it('commits and announces the change when the modal is submitted', async () => {
            vi.mocked(showLogActivityModal).mockResolvedValue(true);

            const outcome = await addLogForMedia(makeMedia());

            expect(outcome.committed).toBe(true);
            expect(dataChangedListener).toHaveBeenCalledOnce();
        });

        it('does not commit when the modal is cancelled', async () => {
            vi.mocked(showLogActivityModal).mockResolvedValue(false);

            const outcome = await addLogForMedia(makeMedia());

            expect(outcome.committed).toBe(false);
            expect(dataChangedListener).not.toHaveBeenCalled();
        });
    });

    describe('addMilestoneForMedia', () => {
        it('prefills the modal from the summed logs and commits on submission', async () => {
            vi.mocked(showAddMilestoneModal).mockResolvedValue({
                media_uid: 'uid-1',
                media_title: 'Some Media',
                name: 'Chapter 1',
                duration: 30,
                characters: 300,
            });

            const outcome = await addMilestoneForMedia(makeMedia(), [makeLog(10, 100), makeLog(20, 200)]);

            expect(showAddMilestoneModal).toHaveBeenCalledWith('Some Media', 'uid-1', { duration: 30, characters: 300 });
            expect(api.addMilestone).toHaveBeenCalledOnce();
            expect(outcome.committed).toBe(true);
            expect(dataChangedListener).toHaveBeenCalledOnce();
        });

        it('does not commit for a media without a uid', async () => {
            const outcome = await addMilestoneForMedia(makeMedia({ uid: undefined }), []);

            expect(outcome.committed).toBe(false);
            expect(showAddMilestoneModal).not.toHaveBeenCalled();
        });

        it('reports a failed write to the user without committing', async () => {
            vi.mocked(showAddMilestoneModal).mockResolvedValue({
                media_uid: 'uid-1',
                media_title: 'Some Media',
                name: 'Chapter 1',
                duration: 0,
                characters: 0,
            });
            vi.mocked(api.addMilestone).mockRejectedValueOnce(new Error('disk full'));

            const outcome = await addMilestoneForMedia(makeMedia(), []);

            expect(outcome.committed).toBe(false);
            expect(customAlert).toHaveBeenCalledOnce();
            expect(dataChangedListener).not.toHaveBeenCalled();
        });
    });

    describe('markMediaComplete', () => {
        it('writes the Complete status and returns the updated media', async () => {
            const media = makeMedia({ tracking_status: 'Ongoing' });

            const outcome = await markMediaComplete(media);

            expect(api.updateMedia).toHaveBeenCalledWith({ ...media, tracking_status: 'Complete' });
            expect(outcome.updatedMedia).toEqual({ ...media, tracking_status: 'Complete' });
            expect(outcome.committed).toBe(true);
            expect(dataChangedListener).toHaveBeenCalledOnce();
        });

        it('does not write for an already Complete media', async () => {
            const outcome = await markMediaComplete(makeMedia({ tracking_status: 'Complete' }));

            expect(outcome.committed).toBe(false);
            expect(api.updateMedia).not.toHaveBeenCalled();
        });

        it('reports a failed write to the user without committing', async () => {
            vi.mocked(api.updateMedia).mockRejectedValueOnce(new Error('offline'));

            const outcome = await markMediaComplete(makeMedia({ tracking_status: 'Ongoing' }));

            expect(outcome.committed).toBe(false);
            expect(outcome.updatedMedia).toBeUndefined();
            expect(customAlert).toHaveBeenCalledOnce();
            expect(dataChangedListener).not.toHaveBeenCalled();
        });
    });

    describe('toggleMediaArchived', () => {
        it('archives an active media and unarchives an archived one', async () => {
            const active = makeMedia({ status: 'Active' });
            await toggleMediaArchived(active);
            expect(api.updateMedia).toHaveBeenCalledWith({ ...active, status: 'Archived' });

            const archived = makeMedia({ status: 'Archived' });
            await toggleMediaArchived(archived);
            expect(api.updateMedia).toHaveBeenCalledWith({ ...archived, status: 'Active' });
        });

        it('reports a failed write to the user without committing', async () => {
            vi.mocked(api.updateMedia).mockRejectedValueOnce(new Error('offline'));

            const outcome = await toggleMediaArchived(makeMedia({ status: 'Active' }));

            expect(outcome.committed).toBe(false);
            expect(customAlert).toHaveBeenCalledOnce();
        });
    });

    describe('deleteMediaWithConfirmation', () => {
        it('deletes only after confirmation, announcing that covers changed', async () => {
            vi.mocked(customConfirm).mockResolvedValueOnce(true);

            const outcome = await deleteMediaWithConfirmation(makeMedia());

            expect(api.deleteMedia).toHaveBeenCalledWith(1);
            expect(outcome.committed).toBe(true);
            expect(dataChangedListener.mock.calls[0][0].detail).toEqual({ coversChanged: true });
        });

        it('does nothing when the confirmation is cancelled', async () => {
            vi.mocked(customConfirm).mockResolvedValueOnce(false);

            const outcome = await deleteMediaWithConfirmation(makeMedia());

            expect(api.deleteMedia).not.toHaveBeenCalled();
            expect(outcome.committed).toBe(false);
        });

        it('reports a failed delete to the user without committing', async () => {
            vi.mocked(customConfirm).mockResolvedValueOnce(true);
            vi.mocked(api.deleteMedia).mockRejectedValueOnce(new Error('locked'));

            const outcome = await deleteMediaWithConfirmation(makeMedia());

            expect(outcome.committed).toBe(false);
            expect(customAlert).toHaveBeenCalledOnce();
            expect(dataChangedListener).not.toHaveBeenCalled();
        });
    });
});

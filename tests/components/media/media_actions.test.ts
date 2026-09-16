import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    addLogForMedia,
    addMilestoneForMedia,
    canAddMilestone,
    canMarkComplete,
    canSetReadingSpeedOverride,
    createMediaVariant,
    deleteMediaWithConfirmation,
    markMediaComplete,
    setReadingSpeedOverride,
    toggleMediaArchived,
} from '../../../src/media/media_actions';
import type { ActivitySummary, Media } from '../../../src/api';
import * as api from '../../../src/api';
import { showLogActivityModal } from '../../../src/activity_modal';
import { showAddMilestoneModal } from '../../../src/milestone_modal';
import { customAlert, customConfirm, customPrompt } from '../../../src/modal_base';
import { showReadingSpeedOverrideModal } from '../../../src/media/reading_speed_modal';
import { EVENTS } from '../../../src/constants';

vi.mock('../../../src/api', () => ({
    addMedia: vi.fn(),
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

vi.mock('../../../src/media/reading_speed_modal', () => ({
    showReadingSpeedOverrideModal: vi.fn(),
}));

vi.mock('../../../src/modal_base', () => ({
    customAlert: vi.fn(),
    customConfirm: vi.fn(),
    customPrompt: vi.fn(),
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
        date_precision: 'day',
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

    describe('canSetReadingSpeedOverride', () => {
        it('is true only for content types the reading speed estimator covers', () => {
            expect(canSetReadingSpeedOverride(makeMedia({ content_type: 'Visual Novel' }))).toBe(true);
            expect(canSetReadingSpeedOverride(makeMedia({ content_type: 'Anime' }))).toBe(false);
        });
    });

    describe('setReadingSpeedOverride', () => {
        it('writes the entered speed into the Reading speed field, keeping other fields', async () => {
            vi.mocked(showReadingSpeedOverrideModal).mockResolvedValue({ charactersPerHour: 7000 });

            const outcome = await setReadingSpeedOverride(makeMedia({ extra_data: '{"Character count":"10000"}' }));

            expect(outcome.committed).toBe(true);
            expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({
                extra_data: '{"Character count":"10000","Reading speed":"7000"}',
            }));
        });

        it('removes the field when the modal returns an empty speed', async () => {
            vi.mocked(showReadingSpeedOverrideModal).mockResolvedValue({ charactersPerHour: null });

            await setReadingSpeedOverride(makeMedia({ extra_data: '{"Reading speed":"7000"}' }));

            expect(api.updateMedia).toHaveBeenCalledWith(expect.objectContaining({ extra_data: '{}' }));
        });

        it('does not write when the modal is dismissed', async () => {
            vi.mocked(showReadingSpeedOverrideModal).mockResolvedValue(null);

            const outcome = await setReadingSpeedOverride(makeMedia());

            expect(outcome.committed).toBe(false);
            expect(api.updateMedia).not.toHaveBeenCalled();
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

    describe('createMediaVariant', () => {
        it('copies media-level data into a new identity and announces the change', async () => {
            vi.mocked(customPrompt).mockResolvedValueOnce('  Print Edition  ');
            vi.mocked(api.addMedia).mockResolvedValueOnce(42);
            const source = makeMedia({
                id: 7,
                uid: 'source-uid',
                variant: 'Digital',
                status: 'Archived',
                language: 'English',
                description: 'Copied description',
                cover_image: '/covers/source.png',
                extra_data: '{"Favorite":"","Author":"Writer"}',
                tracking_status: 'Complete',
            });

            const outcome = await createMediaVariant(source, [source]);

            expect(api.addMedia).toHaveBeenCalledWith({
                title: 'Some Media',
                variant: 'Print Edition',
                default_activity_type: 'Reading',
                status: 'Archived',
                language: 'English',
                description: 'Copied description',
                cover_image: '/covers/source.png',
                extra_data: '{"Favorite":"","Author":"Writer"}',
                content_type: 'Manga',
                tracking_status: 'Complete',
            });
            expect(outcome).toEqual({ committed: true, createdMediaId: 42 });
            expect(dataChangedListener).toHaveBeenCalledOnce();
        });

        it('rejects an existing title and variant before writing', async () => {
            vi.mocked(customPrompt).mockResolvedValueOnce('Manga');
            const source = makeMedia({ variant: 'Anime' });

            const outcome = await createMediaVariant(source, [source, makeMedia({ id: 2, variant: 'Manga' })]);

            expect(outcome.committed).toBe(false);
            expect(api.addMedia).not.toHaveBeenCalled();
            expect(customAlert).toHaveBeenCalledWith('Variant Already Exists', expect.stringContaining('Manga'));
            expect(dataChangedListener).not.toHaveBeenCalled();
        });

        it('reports a failed create without announcing a data change', async () => {
            vi.mocked(customPrompt).mockResolvedValueOnce('Manga');
            vi.mocked(api.addMedia).mockRejectedValueOnce(new Error('database locked'));

            const outcome = await createMediaVariant(makeMedia(), []);

            expect(outcome.committed).toBe(false);
            expect(customAlert).toHaveBeenCalledWith('Unable to Create Variant', expect.stringContaining('database locked'));
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

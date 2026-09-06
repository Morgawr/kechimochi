import { ActivitySummary, Media, addMilestone, deleteMedia, updateMedia } from '../api';
import { showLogActivityModal } from '../activity_modal';
import { showAddMilestoneModal } from '../milestone_modal';
import { customAlert, customConfirm } from '../modal_base';
import { EVENTS, MEDIA_STATUS } from '../constants';
import { Logger } from '../logger';

const COMPLETE_TRACKING_STATUS = 'Complete';

export interface MediaActionOutcome {
    committed: boolean;
    updatedMedia?: Media;
}

export function notifyLocalDataChanged(coversChanged = false): void {
    globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED, { detail: { coversChanged } }));
}

export function canAddMilestone(media: Media): boolean {
    return Boolean(media.uid?.trim());
}

export function canMarkComplete(media: Media): boolean {
    return media.tracking_status !== COMPLETE_TRACKING_STATUS;
}

async function persistMediaUpdate(updatedMedia: Media): Promise<MediaActionOutcome> {
    try {
        await updateMedia(updatedMedia);
    } catch (error) {
        Logger.error('Failed to update media', error);
        await customAlert('Unable to Save Media', `The media entry was not changed: ${error}`);
        return { committed: false };
    }

    notifyLocalDataChanged();
    return { committed: true, updatedMedia };
}

export async function addLogForMedia(media: Media): Promise<MediaActionOutcome> {
    if (media.id == null) return { committed: false };

    const committed = await showLogActivityModal(media.id);
    if (!committed) return { committed: false };

    notifyLocalDataChanged();
    return { committed: true };
}

export async function addMilestoneForMedia(media: Media, logs: ActivitySummary[]): Promise<MediaActionOutcome> {
    const mediaUid = media.uid?.trim();
    if (!mediaUid) return { committed: false };

    const milestone = await showAddMilestoneModal(media.title, mediaUid, {
        duration: logs.reduce((total, log) => total + log.duration_minutes, 0),
        characters: logs.reduce((total, log) => total + log.characters, 0),
    });
    if (!milestone) return { committed: false };

    try {
        await addMilestone(milestone);
    } catch (error) {
        Logger.error('Failed to add milestone', error);
        await customAlert('Error', `Failed to add milestone: ${error}`);
        return { committed: false };
    }

    notifyLocalDataChanged();
    return { committed: true };
}

export async function markMediaComplete(media: Media): Promise<MediaActionOutcome> {
    if (!canMarkComplete(media)) return { committed: false };
    return persistMediaUpdate({ ...media, tracking_status: COMPLETE_TRACKING_STATUS });
}

export async function toggleMediaArchived(media: Media): Promise<MediaActionOutcome> {
    const nextStatus = media.status === MEDIA_STATUS.ARCHIVED ? MEDIA_STATUS.ACTIVE : MEDIA_STATUS.ARCHIVED;
    return persistMediaUpdate({ ...media, status: nextStatus });
}

export async function deleteMediaWithConfirmation(media: Media): Promise<MediaActionOutcome> {
    if (media.id == null) return { committed: false };

    const confirmed = await customConfirm(
        'Delete Media',
        `Are you sure you want to permanently delete "${media.title}" and all its logs?`,
        'btn-danger',
        'Delete',
    );
    if (!confirmed) return { committed: false };

    try {
        await deleteMedia(media.id);
    } catch (error) {
        Logger.error('Failed to delete media', error);
        await customAlert('Unable to Delete Media', `The media entry was not deleted: ${error}`);
        return { committed: false };
    }

    notifyLocalDataChanged(true);
    return { committed: true };
}

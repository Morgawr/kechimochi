import { ActivitySummary, Media, addMedia, addMilestone, deleteMedia, updateMedia } from '../api';
import { showLogActivityModal } from '../activity_modal';
import { showAddMilestoneModal } from '../milestone_modal';
import { customAlert, customConfirm, customPrompt } from '../modal_base';
import { EVENTS, MEDIA_STATUS } from '../constants';
import { Logger } from '../logger';

const COMPLETE_TRACKING_STATUS = 'Complete';

export interface MediaActionOutcome {
    committed: boolean;
    updatedMedia?: Media;
    createdMediaId?: number;
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

function buildMediaVariant(source: Media, variant: string): Media {
    return {
        title: source.title,
        variant,
        default_activity_type: source.default_activity_type,
        status: source.status,
        language: source.language,
        description: source.description,
        cover_image: source.cover_image,
        extra_data: source.extra_data,
        content_type: source.content_type,
        tracking_status: source.tracking_status,
    };
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

export async function createMediaVariant(media: Media, mediaList: Media[]): Promise<MediaActionOutcome> {
    const requestedVariant = await customPrompt(
        'Create Variant',
        '',
        `Create a new entry for "${media.title}". Its media details will be copied, while activity and milestones will start empty.`,
    );
    if (requestedVariant === null) return { committed: false };

    const variant = requestedVariant.trim();
    if (!variant) {
        await customAlert('Variant Name Required', 'Enter a name for the new variant.');
        return { committed: false };
    }

    const existing = mediaList.some(candidate => (
        candidate.title === media.title && (candidate.variant || '') === variant
    ));
    if (existing) {
        await customAlert(
            'Variant Already Exists',
            `A media entry for "${media.title}" with variant "${variant}" already exists.`,
        );
        return { committed: false };
    }

    let createdMediaId: number;
    try {
        createdMediaId = await addMedia(buildMediaVariant(media, variant));
    } catch (error) {
        Logger.error('Failed to create media variant', error);
        await customAlert('Unable to Create Variant', `The media variant was not created: ${error}`);
        return { committed: false };
    }

    notifyLocalDataChanged();
    return { committed: true, createdMediaId };
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

import { setupCopyButton } from './clipboard';
import { open, save } from './dialogs';
import {
    findExtraDataKey,
    getCharacterCountFromExtraData,
    getExtraDataValue,
    mergeExtraData,
    normalizeExtraData,
    removeExtraDataKey,
    renameExtraDataKey,
    upsertExtraDataValue,
} from './extra_data';
import { getProfileInitials, profilePictureToDataUrl } from './profile_picture';
import { formatHhMm, formatLoggedDuration, formatStatsDuration, toTimeParts } from './time';
import type { TimeParts } from './time';

export {
    findExtraDataKey,
    formatHhMm,
    formatLoggedDuration,
    formatStatsDuration,
    getCharacterCountFromExtraData,
    getExtraDataValue,
    getProfileInitials,
    mergeExtraData,
    normalizeExtraData,
    open,
    profilePictureToDataUrl,
    removeExtraDataKey,
    renameExtraDataKey,
    save,
    setupCopyButton,
    toTimeParts,
    upsertExtraDataValue,
};

export type { TimeParts };

import { SETTING_KEYS, CONTENT_TYPES, TRACKING_STATUSES } from '../constants';
import type { LibrarySettings } from '../types';
import {
    parseLibrarySortStages,
    serializeLibrarySortStages,
    reconcileEnumOrder,
    type LibrarySortStage,
} from './sorting';

export type BooleanLibraryFilterField =
    | 'hideArchived'
    | 'groupByType'
    | 'keepOngoingFirst'
    | 'keepArchivedLast';

type BooleanLibrarySettingsField = {
    [Key in keyof LibrarySettings]: LibrarySettings[Key] extends boolean ? Key : never;
}[keyof LibrarySettings];

export interface LibraryPreferences {
    hideArchived: boolean;
    groupByType: boolean;
    keepOngoingFirst: boolean;
    keepArchivedLast: boolean;
    sortStages: LibrarySortStage[];
}

export interface LibraryPreferenceWrite {
    key: string;
    value: string;
    errorLabel: string;
}

interface BooleanLibraryFilterSettingDescriptor {
    key: string;
    field: BooleanLibraryFilterField;
    settingsField: BooleanLibrarySettingsField;
    errorLabel: string;
}

const BOOLEAN_LIBRARY_FILTER_SETTINGS: readonly BooleanLibraryFilterSettingDescriptor[] = [
    {
        key: SETTING_KEYS.GRID_HIDE_ARCHIVED,
        field: 'hideArchived',
        settingsField: 'hide_archived',
        errorLabel: 'hide archived',
    },
    {
        key: SETTING_KEYS.LIBRARY_GROUP_BY_TYPE,
        field: 'groupByType',
        settingsField: 'group_by_type',
        errorLabel: 'group by type',
    },
    {
        key: SETTING_KEYS.LIBRARY_KEEP_ONGOING_FIRST,
        field: 'keepOngoingFirst',
        settingsField: 'keep_ongoing_first',
        errorLabel: 'keep ongoing first',
    },
    {
        key: SETTING_KEYS.LIBRARY_KEEP_ARCHIVED_LAST,
        field: 'keepArchivedLast',
        settingsField: 'keep_archived_last',
        errorLabel: 'keep archived last',
    },
];

export function parseLibraryPreferences(
    settings: LibrarySettings,
    extraFieldNames: string[],
): LibraryPreferences {
    const booleans = {} as Record<BooleanLibraryFilterField, boolean>;
    for (const descriptor of BOOLEAN_LIBRARY_FILTER_SETTINGS) {
        booleans[descriptor.field] = settings[descriptor.settingsField];
    }

    return {
        ...booleans,
        sortStages: parseLibrarySortStages(settings.sort_stages, extraFieldNames),
    };
}

export function revalidateSortStages(
    stages: LibrarySortStage[],
    extraFieldNames: string[],
): LibrarySortStage[] {
    return parseLibrarySortStages(serializeLibrarySortStages(stages), extraFieldNames);
}

export function reconcileLibraryEnumOrders(
    contentTypeOrderStr: string | null,
    trackingStatusOrderStr: string | null,
) {
    return {
        contentTypeOrder: reconcileEnumOrder(contentTypeOrderStr, CONTENT_TYPES),
        trackingStatusOrder: reconcileEnumOrder(trackingStatusOrderStr, TRACKING_STATUSES),
    };
}

export function libraryPreferenceWrites(
    previous: LibraryPreferences,
    next: Partial<LibraryPreferences>,
): LibraryPreferenceWrite[] {
    const writes: LibraryPreferenceWrite[] = [];

    for (const descriptor of BOOLEAN_LIBRARY_FILTER_SETTINGS) {
        const value = next[descriptor.field];
        if (value !== undefined && previous[descriptor.field] !== value) {
            writes.push({
                key: descriptor.key,
                value: value.toString(),
                errorLabel: descriptor.errorLabel,
            });
        }
    }

    if (next.sortStages !== undefined) {
        const serialized = serializeLibrarySortStages(next.sortStages);
        if (serialized !== serializeLibrarySortStages(previous.sortStages)) {
            writes.push({
                key: SETTING_KEYS.LIBRARY_SORT_STAGES,
                value: serialized,
                errorLabel: 'library sort stages',
            });
        }
    }

    return writes;
}
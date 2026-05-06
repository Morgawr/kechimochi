import { EXTRA_FIELD_LABELS } from './constants';

export function findExtraDataKey(extraData: Record<string, string>, key: string): string | undefined {
    const normalizedKey = key.toLowerCase();

    for (const entryKey of Object.keys(extraData)) {
        if (entryKey.toLowerCase() === normalizedKey) {
            return entryKey;
        }
    }

    return undefined;
}

export function getExtraDataValue(extraData: Record<string, string>, key: string): string | undefined {
    const normalizedExtraData = normalizeExtraData(extraData);
    const existingKey = findExtraDataKey(normalizedExtraData, key);
    return existingKey ? normalizedExtraData[existingKey] : undefined;
}

export function normalizeExtraData(extraData: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [entryKey, entryValue] of Object.entries(extraData)) {
        const existingKey = findExtraDataKey(normalized, entryKey);
        if (existingKey) {
            normalized[existingKey] = entryValue;
            continue;
        }

        normalized[entryKey] = entryValue;
    }

    return normalized;
}

export function upsertExtraDataValue(extraData: Record<string, string>, key: string, value: string): Record<string, string> {
    const nextExtraData = normalizeExtraData(extraData);
    const existingKey = findExtraDataKey(nextExtraData, key);

    if (existingKey) {
        nextExtraData[existingKey] = value;
        return nextExtraData;
    }

    nextExtraData[key] = value;
    return nextExtraData;
}

export function renameExtraDataKey(extraData: Record<string, string>, oldKey: string, newKey: string): Record<string, string> {
    const nextExtraData = normalizeExtraData(extraData);
    const existingOldKey = findExtraDataKey(nextExtraData, oldKey);
    if (!existingOldKey) return nextExtraData;

    const value = nextExtraData[existingOldKey];
    delete nextExtraData[existingOldKey];

    const existingTargetKey = findExtraDataKey(nextExtraData, newKey);
    if (existingTargetKey) {
        nextExtraData[existingTargetKey] = value;
    } else {
        nextExtraData[newKey] = value;
    }

    return nextExtraData;
}

export function removeExtraDataKey(extraData: Record<string, string>, key: string): Record<string, string> {
    const nextExtraData = normalizeExtraData(extraData);
    const existingKey = findExtraDataKey(nextExtraData, key);
    if (existingKey) {
        delete nextExtraData[existingKey];
    }

    return nextExtraData;
}

export function mergeExtraData(baseExtraData: Record<string, string>, updates: Record<string, string>): Record<string, string> {
    let nextExtraData = normalizeExtraData(baseExtraData);

    for (const [entryKey, entryValue] of Object.entries(updates)) {
        nextExtraData = upsertExtraDataValue(nextExtraData, entryKey, entryValue);
    }

    return nextExtraData;
}

export function getCharacterCountFromExtraData(extraData: Record<string, string>): number | null {
    const rawValue = getExtraDataValue(extraData, EXTRA_FIELD_LABELS.CHARACTER_COUNT);
    if (!rawValue) return null;

    const parsedValue = Number.parseInt(rawValue.replaceAll(/[^\d-]/g, ''), 10);
    return Number.isNaN(parsedValue) ? null : parsedValue;
}

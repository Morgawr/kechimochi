import {
    findCanonicalName,
    LIBRARY_BUILTIN_SORT_KEYS,
    type LibrarySortField,
    type LibrarySortStage,
} from './library_sort';

const SORT_FIELD_OPTION_VALUE_SEPARATOR = ':';

export function toSortFieldOptionValue(field: LibrarySortField): string {
    return field.kind === 'builtin'
        ? `builtin${SORT_FIELD_OPTION_VALUE_SEPARATOR}${field.key}`
        : `extra${SORT_FIELD_OPTION_VALUE_SEPARATOR}${field.fieldName}`;
}

export function fromSortFieldOptionValue(value: string, availableExtraFieldNames: string[]): LibrarySortField | null {
    const separatorIndex = value.indexOf(SORT_FIELD_OPTION_VALUE_SEPARATOR);
    if (separatorIndex === -1) return null;

    const kind = value.slice(0, separatorIndex);
    const rest = value.slice(separatorIndex + 1);

    if (kind === 'builtin') {
        const matchedKey = LIBRARY_BUILTIN_SORT_KEYS.find(key => key === rest);
        return matchedKey ? { kind: 'builtin', key: matchedKey } : null;
    }

    if (kind === 'extra') {
        const canonicalFieldName = findCanonicalName(availableExtraFieldNames, rest);
        return canonicalFieldName !== undefined ? { kind: 'extra', fieldName: canonicalFieldName } : null;
    }

    return null;
}

function parseStoredLibrarySortField(rawField: unknown, availableExtraFieldNames: string[]): LibrarySortField | null {
    if (!rawField || typeof rawField !== 'object') return null;

    const { kind, key, fieldName } = rawField as { kind?: unknown; key?: unknown; fieldName?: unknown };

    if (kind === 'builtin') {
        if (typeof key !== 'string') return null;
        const matchedKey = LIBRARY_BUILTIN_SORT_KEYS.find(candidateKey => candidateKey === key);
        return matchedKey ? { kind: 'builtin', key: matchedKey } : null;
    }

    if (kind === 'extra') {
        if (typeof fieldName !== 'string') return null;
        const canonicalFieldName = findCanonicalName(availableExtraFieldNames, fieldName);
        return canonicalFieldName !== undefined ? { kind: 'extra', fieldName: canonicalFieldName } : null;
    }

    return null;
}

export function serializeLibrarySortStages(stages: LibrarySortStage[]): string {
    return JSON.stringify(stages.map(stage => ({
        field: stage.field,
        direction: stage.direction,
    })));
}

export function parseLibrarySortStages(value: string, availableExtraFieldNames: string[]): LibrarySortStage[] {
    let rawStages: unknown;
    try {
        rawStages = JSON.parse(value);
    } catch {
        return [];
    }

    if (!Array.isArray(rawStages)) return [];

    const stages: LibrarySortStage[] = [];
    for (const rawStage of rawStages) {
        const stage = parseSingleLibrarySortStage(rawStage, availableExtraFieldNames);
        if (stage) stages.push(stage);
    }

    return stages;
}

function parseSingleLibrarySortStage(rawStage: unknown, availableExtraFieldNames: string[]): LibrarySortStage | null {
    if (!rawStage || typeof rawStage !== 'object') return null;

    const { field, direction } = rawStage as { field?: unknown; direction?: unknown };
    if (direction !== 'ascending' && direction !== 'descending') return null;

    const parsedField = parseStoredLibrarySortField(field, availableExtraFieldNames);
    return parsedField ? { field: parsedField, direction } : null;
}

function parseSavedEnumOrder<TValue extends string>(rawValue: string | null | undefined, declarationOrder: readonly TValue[]): TValue[] {
    if (!rawValue) return [];

    let parsedValue: unknown;
    try {
        parsedValue = JSON.parse(rawValue);
    } catch {
        return [];
    }

    if (!Array.isArray(parsedValue)) return [];

    const seenValues = new Set<TValue>();
    const savedOrder: TValue[] = [];
    for (const entry of parsedValue) {
        if (typeof entry !== 'string') continue;
        if (!declarationOrder.includes(entry as TValue)) continue;
        if (seenValues.has(entry as TValue)) continue;

        seenValues.add(entry as TValue);
        savedOrder.push(entry as TValue);
    }

    return savedOrder;
}

/**
 * Reconciles a saved enum order setting against its declaration order: known values keep the
 * saved relative order, any value missing from the save (new, or the save itself unset/invalid)
 * is appended in declaration order.
 */
export function reconcileEnumOrder<TValue extends string>(rawSavedValue: string | null | undefined, declarationOrder: readonly TValue[]): TValue[] {
    const savedOrder = parseSavedEnumOrder(rawSavedValue, declarationOrder);
    const missingValues = declarationOrder.filter(value => !savedOrder.includes(value));
    return [...savedOrder, ...missingValues];
}
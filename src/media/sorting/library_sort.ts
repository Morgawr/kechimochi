import { MEDIA_STATUS } from '../../constants';
import { findExtraDataKey, normalizeExtraData } from '../../extra_data';
import type { Media } from '../../types';
import type { LibraryActivityMetrics } from '../library_types';
import { resolveDisplayContentType } from '../content_type';

const ONGOING_TRACKING_STATUS = 'Ongoing';

export type LibrarySortDirection = 'ascending' | 'descending';

export const LIBRARY_BUILTIN_SORT_KEYS = [
    'default', 'title', 'contentType', 'trackingStatus', 'dateAdded',
    'lastActivity', 'firstActivity', 'timeLogged', 'totalCharacters',
] as const;

export type LibraryBuiltinSortKey = typeof LIBRARY_BUILTIN_SORT_KEYS[number];

export type LibrarySortField =
    | { kind: 'builtin'; key: LibraryBuiltinSortKey }
    | { kind: 'extra'; fieldName: string };

export interface LibrarySortStage {
    field: LibrarySortField;
    direction: LibrarySortDirection;
}

export interface LibrarySortOptions {
    stages: LibrarySortStage[];
    keepOngoingFirst: boolean;
    keepArchivedLast: boolean;
    metricsByMediaId: Record<number, LibraryActivityMetrics>;
    extraDataIndex: Map<number, Record<string, string>>;
    contentTypeOrder: string[];
    trackingStatusOrder: string[];
}

type ResolvedSortValue = string | number | null;
export type SortValueKind = 'numeric' | 'text';

interface BuiltinSortDefinition {
    valueKind: SortValueKind;
    resolve: (media: Media, options: LibrarySortOptions) => ResolvedSortValue;
    resolveTiebreak?: (media: Media) => string;
}

const BUILTIN_SORT_DEFINITIONS: Record<LibraryBuiltinSortKey, BuiltinSortDefinition> = {
    default: {
        valueKind: 'text',
        resolve: () => null,
    },
    title: {
        valueKind: 'text',
        resolve: media => media.title,
        resolveTiebreak: media => media.variant ?? '',
    },
    contentType: {
        valueKind: 'numeric',
        // Must use the same normalization as section grouping (resolveDisplayContentType), or
        // sorting by content type disagrees with what the section headers group media under.
        resolve: (media, options) => resolveEnumRank(resolveDisplayContentType(media), options.contentTypeOrder),
    },
    trackingStatus: {
        valueKind: 'numeric',
        resolve: (media, options) => resolveEnumRank(media.tracking_status, options.trackingStatusOrder),
    },
    dateAdded: {
        valueKind: 'numeric',
        // Media carries no creation timestamp; this leans on rowids being monotonic in
        // insertion order. Anything that reuses or backfills ids breaks this ordering.
        resolve: media => media.id ?? null,
    },
    lastActivity: {
        valueKind: 'text',
        resolve: (media, options) => resolveMetric(media, options.metricsByMediaId, metrics => metrics.lastActivityDate),
    },
    firstActivity: {
        valueKind: 'text',
        resolve: (media, options) => resolveMetric(media, options.metricsByMediaId, metrics => metrics.firstActivityDate),
    },
    timeLogged: {
        valueKind: 'numeric',
        resolve: (media, options) => resolveMetric(media, options.metricsByMediaId, metrics => metrics.totalMinutes),
    },
    totalCharacters: {
        valueKind: 'numeric',
        resolve: (media, options) => resolveMetric(media, options.metricsByMediaId, metrics => metrics.totalCharacters),
    },
};

export function findCanonicalName(names: string[], target: string): string | undefined {
    const normalizedTarget = target.toLowerCase();
    return names.find(name => name.toLowerCase() === normalizedTarget);
}

export function buildExtraDataIndex(mediaList: Media[]): Map<number, Record<string, string>> {
    const index = new Map<number, Record<string, string>>();

    for (const media of mediaList) {
        if (media.id === undefined) continue;

        let parsedExtraData: unknown;
        try {
            parsedExtraData = JSON.parse(media.extra_data || '{}');
        } catch {
            continue;
        }

        if (typeof parsedExtraData !== 'object' || parsedExtraData === null || Array.isArray(parsedExtraData)) continue;

        index.set(media.id, normalizeExtraData(parsedExtraData as Record<string, string>));
    }

    return index;
}

export function getUniqueExtraFieldNames(index: Map<number, Record<string, string>>): string[] {
    const canonicalNames: string[] = [];

    for (const extraData of index.values()) {
        for (const key of Object.keys(extraData)) {
            if (findCanonicalName(canonicalNames, key) === undefined) {
                canonicalNames.push(key);
            }
        }
    }

    return canonicalNames.sort((a, b) => a.localeCompare(b));
}

const LEADING_NUMBER_PATTERN = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;

export function parseLeadingNumber(raw: string): number | null {
    const match = LEADING_NUMBER_PATTERN.exec(raw.trim());
    if (!match) return null;

    const numericText = match[0].replaceAll(',', '');
    const parsedValue = Number.parseFloat(numericText);
    return Number.isNaN(parsedValue) ? null : parsedValue;
}

export function inferExtraFieldValueType(values: string[]): SortValueKind {
    const nonEmptyValues = values.filter(value => value.trim() !== '');
    if (nonEmptyValues.length === 0) return 'text';

    const allNumeric = nonEmptyValues.every(value => parseLeadingNumber(value) !== null);
    return allNumeric ? 'numeric' : 'text';
}

function resolveExtraValue(fieldName: string, media: Media, extraDataIndex: Map<number, Record<string, string>>): string | null {
    if (media.id === undefined) return null;

    const extraData = extraDataIndex.get(media.id);
    if (!extraData) return null;

    const matchedKey = findExtraDataKey(extraData, fieldName);
    if (matchedKey === undefined) return null;

    const rawValue = extraData[matchedKey];
    return rawValue.trim() === '' ? null : rawValue;
}

function resolveEnumRank(value: string, order: string[]): number {
    const index = order.indexOf(value);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function resolveMetric<TValue extends string | number>(
    media: Media,
    metricsByMediaId: Record<number, LibraryActivityMetrics>,
    pick: (metrics: LibraryActivityMetrics) => TValue | null,
): TValue | null {
    if (media.id === undefined) return null;

    const metrics = metricsByMediaId[media.id];
    return metrics ? pick(metrics) : null;
}

function resolveBuiltinValue(key: LibraryBuiltinSortKey, media: Media, options: LibrarySortOptions): ResolvedSortValue {
    return BUILTIN_SORT_DEFINITIONS[key].resolve(media, options);
}

interface ResolvedStage {
    direction: LibrarySortDirection;
    valueKind: SortValueKind;
    resolveValue: (media: Media) => ResolvedSortValue;
    resolveTiebreakValue?: (media: Media) => string;
}

function resolveExtraStage(
    fieldName: string,
    mediaList: Media[],
    options: LibrarySortOptions,
): { valueKind: SortValueKind; resolveValue: (media: Media) => ResolvedSortValue } {
    const rawValueByMedia = new Map<Media, string | null>();
    for (const media of mediaList) {
        rawValueByMedia.set(media, resolveExtraValue(fieldName, media, options.extraDataIndex));
    }

    const nonNullRawValues = Array.from(rawValueByMedia.values()).filter((value): value is string => value !== null);
    const valueKind = inferExtraFieldValueType(nonNullRawValues);

    return {
        valueKind,
        resolveValue: media => {
            const rawValue = rawValueByMedia.get(media) ?? null;
            if (rawValue === null) return null;
            return valueKind === 'numeric' ? parseLeadingNumber(rawValue) : rawValue;
        },
    };
}

function resolveStage(stage: LibrarySortStage, mediaList: Media[], options: LibrarySortOptions): ResolvedStage {
    const field = stage.field;

    if (field.kind === 'builtin') {
        const definition = BUILTIN_SORT_DEFINITIONS[field.key];
        return {
            direction: stage.direction,
            valueKind: definition.valueKind,
            resolveValue: media => resolveBuiltinValue(field.key, media, options),
            resolveTiebreakValue: definition.resolveTiebreak,
        };
    }

    const { valueKind, resolveValue } = resolveExtraStage(field.fieldName, mediaList, options);
    return { direction: stage.direction, valueKind, resolveValue };
}

function compareResolvedValues(a: ResolvedSortValue, b: ResolvedSortValue, valueKind: SortValueKind, direction: LibrarySortDirection): number {
    const aMissing = a === null || a === '';
    const bMissing = b === null || b === '';

    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    const rawComparison = valueKind === 'numeric'
        ? (a as number) - (b as number)
        : (a as string).localeCompare(b as string, undefined, { numeric: true });

    return direction === 'ascending' ? rawComparison : -rawComparison;
}

function compareTiebreakValues(a: string, b: string, direction: LibrarySortDirection): number {
    const rawComparison = a.localeCompare(b, undefined, { numeric: true });
    return direction === 'ascending' ? rawComparison : -rawComparison;
}

function computeArchivedRank(media: Media): number {
    return media.status === MEDIA_STATUS.ARCHIVED ? 1 : 0;
}

function computeOngoingRank(media: Media): number {
    return media.status !== MEDIA_STATUS.ARCHIVED && media.tracking_status === ONGOING_TRACKING_STATUS ? 0 : 1;
}

interface DecoratedRow {
    media: Media;
    archivedRank: number;
    ongoingRank: number;
    stageValues: ResolvedSortValue[];
    stageTiebreakValues: (string | null)[];
}

export function applyLibrarySort(mediaList: Media[], options: LibrarySortOptions): Media[] {
    const resolvedStages = options.stages.map(stage => resolveStage(stage, mediaList, options));

    const decoratedRows: DecoratedRow[] = mediaList.map(media => ({
        media,
        archivedRank: computeArchivedRank(media),
        ongoingRank: computeOngoingRank(media),
        stageValues: resolvedStages.map(resolvedStage => resolvedStage.resolveValue(media)),
        stageTiebreakValues: resolvedStages.map(resolvedStage => resolvedStage.resolveTiebreakValue?.(media) ?? null),
    }));

    decoratedRows.sort((a, b) => {
        if (options.keepArchivedLast) {
            const archivedComparison = a.archivedRank - b.archivedRank;
            if (archivedComparison !== 0) return archivedComparison;
        }

        if (options.keepOngoingFirst) {
            const ongoingComparison = a.ongoingRank - b.ongoingRank;
            if (ongoingComparison !== 0) return ongoingComparison;
        }

        for (let stageIndex = 0; stageIndex < resolvedStages.length; stageIndex += 1) {
            const resolvedStage = resolvedStages[stageIndex];
            const stageComparison = compareResolvedValues(
                a.stageValues[stageIndex],
                b.stageValues[stageIndex],
                resolvedStage.valueKind,
                resolvedStage.direction,
            );
            if (stageComparison !== 0) return stageComparison;
        }

        for (let stageIndex = 0; stageIndex < resolvedStages.length; stageIndex += 1) {
            const resolvedStage = resolvedStages[stageIndex];
            const aTiebreak = a.stageTiebreakValues[stageIndex];
            const bTiebreak = b.stageTiebreakValues[stageIndex];
            if (aTiebreak === null || bTiebreak === null) continue;

            const tiebreakComparison = compareTiebreakValues(aTiebreak, bTiebreak, resolvedStage.direction);
            if (tiebreakComparison !== 0) return tiebreakComparison;
        }

        return 0;
    });

    return decoratedRows.map(row => row.media);
}
import type { LibraryRow } from './sorting';

export type LibraryPlacementBeforeRow =
    | { kind: 'item'; mediaId: number }
    | { kind: 'header'; contentType: string }
    | null;

type LibraryPlacementDecision =
    | { kind: 'move'; before: LibraryPlacementBeforeRow }
    | { kind: 'remove' }
    | { kind: 'fullRender' };

interface LibraryPlacementResult {
    decision: LibraryPlacementDecision;
    removedContentTypes: string[];
}

function headerContentTypes(rows: LibraryRow[]): Set<string> {
    return new Set(rows.flatMap(row => (row.kind === 'header' ? [row.contentType] : [])));
}

function orderedOtherItemIds(rows: LibraryRow[], mutatedMediaId: number): number[] | null {
    const ids: number[] = [];
    for (const row of rows) {
        if (row.kind === 'header') continue;
        if (row.media.id === mutatedMediaId) continue;
        if (typeof row.media.id !== 'number') return null;
        ids.push(row.media.id);
    }
    return ids;
}

function isSameOrder(previous: number[], next: number[]): boolean {
    return previous.length === next.length && previous.every((id, index) => id === next[index]);
}

export function resolveLibraryItemPlacement(
    previousRows: LibraryRow[],
    nextRows: LibraryRow[],
    mutatedMediaId: number,
): LibraryPlacementResult {
    const previousOtherIds = orderedOtherItemIds(previousRows, mutatedMediaId);
    const nextOtherIds = orderedOtherItemIds(nextRows, mutatedMediaId);

    if (previousOtherIds === null || nextOtherIds === null || !isSameOrder(previousOtherIds, nextOtherIds)) {
        return { decision: { kind: 'fullRender' }, removedContentTypes: [] };
    }

    const previousContentTypes = headerContentTypes(previousRows);
    const nextContentTypes = headerContentTypes(nextRows);
    const removedContentTypes = [...previousContentTypes].filter(contentType => !nextContentTypes.has(contentType));

    const mutatedIndex = nextRows.findIndex(row => row.kind === 'item' && row.media.id === mutatedMediaId);
    if (mutatedIndex === -1) {
        return { decision: { kind: 'remove' }, removedContentTypes };
    }

    const followingRow = nextRows[mutatedIndex + 1];
    if (!followingRow) {
        return { decision: { kind: 'move', before: null }, removedContentTypes };
    }

    if (followingRow.kind === 'header') {
        return {
            decision: { kind: 'move', before: { kind: 'header', contentType: followingRow.contentType } },
            removedContentTypes,
        };
    }

    if (typeof followingRow.media.id !== 'number') {
        return { decision: { kind: 'fullRender' }, removedContentTypes: [] };
    }

    return {
        decision: { kind: 'move', before: { kind: 'item', mediaId: followingRow.media.id } },
        removedContentTypes,
    };
}

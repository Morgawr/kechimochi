import type { Media } from '../../types';
import { resolveDisplayContentType } from '../content_type';

export type LibraryRow =
    | { kind: 'header'; contentType: string }
    | { kind: 'item'; media: Media };

export interface LibraryTypeGroup {
    contentType: string;
    items: Media[];
}

export function groupMediaByType(sortedList: Media[], contentTypeOrder: string[]): LibraryTypeGroup[] {
    const itemsByContentType = new Map<string, Media[]>();

    for (const media of sortedList) {
        const displayContentType = resolveDisplayContentType(media);
        const existingItems = itemsByContentType.get(displayContentType);
        if (existingItems) {
            existingItems.push(media);
        } else {
            itemsByContentType.set(displayContentType, [media]);
        }
    }

    const orderedGroups: LibraryTypeGroup[] = [];
    for (const contentType of contentTypeOrder) {
        const items = itemsByContentType.get(contentType);
        if (items) orderedGroups.push({ contentType, items });
    }

    const trailingGroups: LibraryTypeGroup[] = Array.from(itemsByContentType.entries())
        .filter(([contentType]) => !contentTypeOrder.includes(contentType))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([contentType, items]) => ({ contentType, items }));

    return [...orderedGroups, ...trailingGroups];
}

export function flattenLibraryRows(groups: LibraryTypeGroup[]): LibraryRow[] {
    const rows: LibraryRow[] = [];

    for (const group of groups) {
        rows.push({ kind: 'header', contentType: group.contentType });
        for (const media of group.items) {
            rows.push({ kind: 'item', media });
        }
    }

    return rows;
}

export function toLibraryItemRows(mediaList: Media[]): LibraryRow[] {
    return mediaList.map(media => ({ kind: 'item', media }));
}

// A null contentTypeOrder means "do not group": the library renders one flat run of item rows.
export function buildLibraryRows(sortedList: Media[], contentTypeOrder: string[] | null): LibraryRow[] {
    return contentTypeOrder
        ? flattenLibraryRows(groupMediaByType(sortedList, contentTypeOrder))
        : toLibraryItemRows(sortedList);
}
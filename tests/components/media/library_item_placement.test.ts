import { describe, it, expect } from 'vitest';
import { resolveLibraryItemPlacement } from '../../../src/media/library_item_placement';
import type { LibraryRow } from '../../../src/media/sorting';
import type { Media } from '../../../src/api';

function item(id: number, title = `Item ${id}`): LibraryRow {
    return { kind: 'item', media: { id, title } as Media };
}

function header(contentType: string): LibraryRow {
    return { kind: 'header', contentType };
}

describe('resolveLibraryItemPlacement', () => {
    it('moves an item forward past its former neighbours', () => {
        const previousRows = [item(1), item(2), item(3), item(4)];
        const nextRows = [item(2), item(3), item(1), item(4)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'move', before: { kind: 'item', mediaId: 4 } });
        expect(result.removedContentTypes).toEqual([]);
    });

    it('moves an item backward past its former neighbours', () => {
        const previousRows = [item(1), item(2), item(3), item(4)];
        const nextRows = [item(4), item(1), item(2), item(3)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 4);

        expect(result.decision).toEqual({ kind: 'move', before: { kind: 'item', mediaId: 1 } });
    });

    it('moves an item to the first position', () => {
        const previousRows = [item(1), item(2), item(3)];
        const nextRows = [item(3), item(1), item(2)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 3);

        expect(result.decision).toEqual({ kind: 'move', before: { kind: 'item', mediaId: 1 } });
    });

    it('moves an item to the last position, appending with no following row', () => {
        const previousRows = [item(1), item(2), item(3)];
        const nextRows = [item(2), item(3), item(1)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'move', before: null });
    });

    it('leaves the position unchanged as a no-op move addressing the same neighbour', () => {
        const previousRows = [item(1), item(2), item(3)];
        const nextRows = [item(1), item(2), item(3)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'move', before: { kind: 'item', mediaId: 2 } });
    });

    it('removes an item that leaves the active filter', () => {
        const previousRows = [item(1), item(2), item(3)];
        const nextRows = [item(1), item(3)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 2);

        expect(result.decision).toEqual({ kind: 'remove' });
    });

    it('reports a group header that no longer appears once its only item is deleted', () => {
        const previousRows = [header('Anime'), item(1), header('Manga'), item(2)];
        const nextRows = [header('Manga'), item(2)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'remove' });
        expect(result.removedContentTypes).toEqual(['Anime']);
    });

    it('addresses the next group header when the item becomes last in its own group', () => {
        const previousRows = [header('Anime'), item(1), item(2), header('Manga'), item(3)];
        const nextRows = [header('Anime'), item(2), item(1), header('Manga'), item(3)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'move', before: { kind: 'header', contentType: 'Manga' } });
    });

    it('falls back to a full render when an extra-field sort flip reorders the other rows', () => {
        const previousRows = [item(1, 'abc'), item(2, '10'), item(3, '2')];
        const nextRows = [item(3, '2'), item(2, '10')];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'fullRender' });
    });

    it('falls back to a full render when a row cannot be keyed by id', () => {
        const idLessRow: LibraryRow = { kind: 'item', media: { title: 'No id' } as Media };
        const previousRows = [item(1), idLessRow];
        const nextRows = [idLessRow, item(1)];

        const result = resolveLibraryItemPlacement(previousRows, nextRows, 1);

        expect(result.decision).toEqual({ kind: 'fullRender' });
    });
});

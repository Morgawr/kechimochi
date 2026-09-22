import { describe, expect, it } from 'vitest';
import { DASHBOARD_GRID_COLUMNS, packCards } from '../../../src/dashboard/dashboard_layout';
import { DASHBOARD_CARD_ORDER } from '../../../src/dashboard/dashboard_cards';

function replayGridPlacement(idsInDomOrder: readonly string[], spanById: ReadonlyMap<string, number>, columns: number): number[] {
    const rowSums: number[] = [];
    let currentRowUsed = 0;

    for (const id of idsInDomOrder) {
        const span = spanById.get(id)!;
        if (currentRowUsed > 0 && currentRowUsed + span > columns) {
            rowSums.push(currentRowUsed);
            currentRowUsed = 0;
        }
        currentRowUsed += span;
    }
    if (currentRowUsed > 0) rowSums.push(currentRowUsed);

    return rowSums;
}

function subsets<T>(items: readonly T[]): T[][] {
    const result: T[][] = [[]];
    for (const item of items) {
        for (const existing of [...result]) {
            result.push([...existing, item]);
        }
    }
    return result;
}

describe('packCards — replaying CSS grid placement', () => {
    for (const tier of ['wide', 'medium'] as const) {
        it(`places every subset of the real dashboard cards into full rows at the ${tier} tier`, () => {
            for (const visibleCards of subsets(DASHBOARD_CARD_ORDER)) {
                const cardsInput = visibleCards.map(card => ({ id: card.id, span: card.spans[tier] }));
                const spans = packCards(cardsInput, DASHBOARD_GRID_COLUMNS);

                const rows = replayGridPlacement(visibleCards.map(card => card.id), spans, DASHBOARD_GRID_COLUMNS);

                if (visibleCards.length === 0) {
                    expect(rows).toEqual([]);
                    continue;
                }
                for (const rowSum of rows) {
                    expect(rowSum).toBe(DASHBOARD_GRID_COLUMNS);
                }
            }
        });
    }
});

describe('packCards', () => {
    it('builds rows only from consecutive cards, never pulling a later card forward', () => {
        const cards = [
            { id: 'a', span: 8 },
            { id: 'b', span: 4 },
            { id: 'c', span: 4 },
            { id: 'd', span: 8 },
        ];
        const spans = packCards(cards, 12);

        expect(spans.get('a')! + spans.get('b')!).toBe(12);
        expect(spans.get('c')! + spans.get('d')!).toBe(12);
    });

    it('is deterministic for the same input', () => {
        const cards = [
            { id: 'a', span: 5 },
            { id: 'b', span: 5 },
            { id: 'c', span: 5 },
        ];
        expect(packCards(cards, 12)).toEqual(packCards(cards, 12));
    });

    it('breaks widening ties toward the earlier card', () => {
        const cards = [
            { id: 'first', span: 1 },
            { id: 'second', span: 1 },
        ];
        const spans = packCards(cards, 7);

        expect(spans.get('first')).toBe(4);
        expect(spans.get('second')).toBe(3);
    });

    it('never emits a zero, negative or non-integer span', () => {
        const cards = [
            { id: 'zero', span: 0 },
            { id: 'negative', span: -3 },
            { id: 'fractional', span: 2.5 },
        ];
        const spans = packCards(cards, 12);

        for (const span of spans.values()) {
            expect(span).toBeGreaterThan(0);
            expect(Number.isInteger(span)).toBe(true);
        }
    });

    it('falls back a NaN span to the full column count', () => {
        const cards = [{ id: 'broken', span: NaN }];
        const spans = packCards(cards, 12);

        expect(spans.get('broken')).toBe(12);
    });

    it('returns an empty map for no cards', () => {
        expect(packCards([], 12)).toEqual(new Map());
    });
});

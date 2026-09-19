import { describe, expect, it } from 'vitest';
import {
    DASHBOARD_CARD_ORDER,
    parseHiddenDashboardCards,
    serializeHiddenDashboardCards,
    type DashboardCardId,
} from '../../../src/dashboard/dashboard_cards';

describe('parseHiddenDashboardCards', () => {
    it('returns an empty set for null', () => {
        expect(parseHiddenDashboardCards(null)).toEqual(new Set());
    });

    it('returns an empty set for malformed JSON', () => {
        expect(parseHiddenDashboardCards('{not json')).toEqual(new Set());
    });

    it('returns an empty set when the JSON is not an array', () => {
        expect(parseHiddenDashboardCards('{"heatmap": true}')).toEqual(new Set());
        expect(parseHiddenDashboardCards('"heatmap"')).toEqual(new Set());
        expect(parseHiddenDashboardCards('42')).toEqual(new Set());
    });

    it('drops unknown card ids', () => {
        expect(parseHiddenDashboardCards(JSON.stringify(['heatmap', 'not_a_real_card'])))
            .toEqual(new Set(['heatmap']));
    });

    it('drops non-string entries', () => {
        expect(parseHiddenDashboardCards(JSON.stringify(['heatmap', 42, null, {}, ['categories']])))
            .toEqual(new Set(['heatmap']));
    });

    it('collapses duplicate ids', () => {
        expect(parseHiddenDashboardCards(JSON.stringify(['heatmap', 'heatmap', 'categories', 'heatmap'])))
            .toEqual(new Set(['heatmap', 'categories']));
    });

    it('round-trips through serializeHiddenDashboardCards', () => {
        const original = new Set<DashboardCardId>(['highlights', 'heatmap', 'categories']);
        const roundTripped = parseHiddenDashboardCards(serializeHiddenDashboardCards(original));

        expect(roundTripped).toEqual(original);
    });
});

describe('serializeHiddenDashboardCards', () => {
    it('orders ids by DASHBOARD_CARD_ORDER rather than insertion order', () => {
        const hiddenCards = new Set<DashboardCardId>(['recent_activity', 'heatmap']);

        expect(JSON.parse(serializeHiddenDashboardCards(hiddenCards))).toEqual(['heatmap', 'recent_activity']);
    });

    it('serializes an empty set as an empty array', () => {
        expect(serializeHiddenDashboardCards(new Set())).toBe('[]');
    });

    it('never includes an id outside DASHBOARD_CARD_ORDER', () => {
        const declaredIds = new Set(DASHBOARD_CARD_ORDER.map(card => card.id));
        const serialized = JSON.parse(serializeHiddenDashboardCards(new Set(declaredIds))) as string[];

        expect(serialized.every(id => declaredIds.has(id as DashboardCardId))).toBe(true);
    });
});

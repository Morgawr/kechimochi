import { findExtraDataKey } from '../../extra_data';
import type { Media } from '../../types';
import {
    findCanonicalName,
    getUniqueExtraFieldNames,
    inferExtraFieldValueType,
    parseLeadingNumber,
    type SortValueKind,
} from '../sorting/library_sort';

export const LIBRARY_TEXT_FILTER_OPERATORS = [
    'contains',
    'notContains',
    'equals',
    'notEquals',
    'startsWith',
    'endsWith',
] as const;

export const LIBRARY_NUMERIC_FILTER_OPERATORS = [
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual',
    'equals',
    'notEquals',
] as const;

export type LibraryTextFilterOperator = typeof LIBRARY_TEXT_FILTER_OPERATORS[number];
export type LibraryNumericFilterOperator = typeof LIBRARY_NUMERIC_FILTER_OPERATORS[number];
export type LibraryExtraFilterOperator = LibraryTextFilterOperator | LibraryNumericFilterOperator;
export type LibraryFilterJoin = 'and' | 'or';

interface LibraryFilterRuleBase {
    join: LibraryFilterJoin;
    negated: boolean;
}

export interface LibraryExtraFilterRule extends LibraryFilterRuleBase {
    kind: 'extra';
    fieldName: string;
    operator: LibraryExtraFilterOperator;
    value: string;
}

export interface LibraryBooleanTagFilterRule extends LibraryFilterRuleBase {
    kind: 'booleanTag';
    tagName: string;
}

export type LibraryFilterRule = LibraryExtraFilterRule | LibraryBooleanTagFilterRule;

export interface LibraryExtraDataFacets {
    valuedFieldNames: string[];
    booleanTagNames: string[];
}

function getExtraFieldValues(
    extraDataIndex: Map<number, Record<string, string>>,
    fieldName: string,
): string[] {
    const values: string[] = [];
    for (const extraData of extraDataIndex.values()) {
        const key = findExtraDataKey(extraData, fieldName);
        if (key !== undefined) values.push(extraData[key]);
    }
    return values;
}

export function getLibraryExtraDataFacets(
    extraDataIndex: Map<number, Record<string, string>>,
): LibraryExtraDataFacets {
    const allFieldNames = getUniqueExtraFieldNames(extraDataIndex);
    const valuedFieldNames: string[] = [];
    const booleanTagNames: string[] = [];

    for (const fieldName of allFieldNames) {
        const values = getExtraFieldValues(extraDataIndex, fieldName);
        if (values.some(value => value.trim() !== '')) valuedFieldNames.push(fieldName);
        if (values.some(value => value.trim() === '')) booleanTagNames.push(fieldName);
    }

    return { valuedFieldNames, booleanTagNames };
}

export function getLibraryExtraFieldValueKind(
    extraDataIndex: Map<number, Record<string, string>>,
    fieldName: string,
): SortValueKind {
    return inferExtraFieldValueType(getExtraFieldValues(extraDataIndex, fieldName));
}

export function getDefaultLibraryExtraFilterOperator(valueKind: SortValueKind): LibraryExtraFilterOperator {
    return valueKind === 'numeric' ? 'greaterThan' : 'contains';
}

export function isLibraryExtraFilterOperatorValid(
    operator: LibraryExtraFilterOperator,
    valueKind: SortValueKind,
): boolean {
    return valueKind === 'numeric'
        ? LIBRARY_NUMERIC_FILTER_OPERATORS.includes(operator as LibraryNumericFilterOperator)
        : LIBRARY_TEXT_FILTER_OPERATORS.includes(operator as LibraryTextFilterOperator);
}

export function isLibraryFilterRuleReady(
    rule: LibraryFilterRule,
    extraDataIndex: Map<number, Record<string, string>>,
    facets = getLibraryExtraDataFacets(extraDataIndex),
): boolean {
    if (rule.kind === 'booleanTag') {
        return findCanonicalName(facets.booleanTagNames, rule.tagName) !== undefined;
    }

    const canonicalFieldName = findCanonicalName(facets.valuedFieldNames, rule.fieldName);
    if (canonicalFieldName === undefined || rule.value.trim() === '') return false;

    const valueKind = getLibraryExtraFieldValueKind(extraDataIndex, canonicalFieldName);
    if (!isLibraryExtraFilterOperatorValid(rule.operator, valueKind)) return false;

    return valueKind !== 'numeric' || parseLeadingNumber(rule.value) !== null;
}

export function revalidateLibraryFilterRules(
    rules: LibraryFilterRule[],
    extraDataIndex: Map<number, Record<string, string>>,
): LibraryFilterRule[] {
    const facets = getLibraryExtraDataFacets(extraDataIndex);

    return rules.flatMap((rule): LibraryFilterRule[] => {
        const join: LibraryFilterJoin = rule.join === 'or' ? 'or' : 'and';
        const negated = rule.negated === true;

        if (rule.kind === 'booleanTag') {
            const tagName = findCanonicalName(facets.booleanTagNames, rule.tagName);
            return tagName === undefined
                ? []
                : [{ kind: 'booleanTag', tagName, join, negated }];
        }

        const fieldName = findCanonicalName(facets.valuedFieldNames, rule.fieldName);
        if (fieldName === undefined) return [];

        const valueKind = getLibraryExtraFieldValueKind(extraDataIndex, fieldName);
        const operator = isLibraryExtraFilterOperatorValid(rule.operator, valueKind)
            ? rule.operator
            : getDefaultLibraryExtraFilterOperator(valueKind);
        return [{
            kind: 'extra',
            fieldName,
            operator,
            value: rule.value,
            join,
            negated,
        }];
    });
}

function resolveExtraFieldValue(
    media: Media,
    fieldName: string,
    extraDataIndex: Map<number, Record<string, string>>,
): string | null {
    if (media.id === undefined) return null;

    const extraData = extraDataIndex.get(media.id);
    if (!extraData) return null;

    const key = findExtraDataKey(extraData, fieldName);
    if (key === undefined) return null;

    const value = extraData[key];
    return value.trim() === '' ? null : value;
}

function matchesTextRule(rawValue: string, rule: LibraryExtraFilterRule): boolean {
    const value = rawValue.toLocaleLowerCase();
    const target = rule.value.trim().toLocaleLowerCase();

    switch (rule.operator) {
        case 'contains': return value.includes(target);
        case 'notContains': return !value.includes(target);
        case 'equals': return value === target;
        case 'notEquals': return value !== target;
        case 'startsWith': return value.startsWith(target);
        case 'endsWith': return value.endsWith(target);
        default: return false;
    }
}

function matchesNumericRule(rawValue: string, rule: LibraryExtraFilterRule): boolean {
    const value = parseLeadingNumber(rawValue);
    const target = parseLeadingNumber(rule.value);
    if (value === null || target === null) return false;

    switch (rule.operator) {
        case 'greaterThan': return value > target;
        case 'greaterThanOrEqual': return value >= target;
        case 'lessThan': return value < target;
        case 'lessThanOrEqual': return value <= target;
        case 'equals': return value === target;
        case 'notEquals': return value !== target;
        default: return false;
    }
}

function mediaHasBooleanTag(
    media: Media,
    tagName: string,
    extraDataIndex: Map<number, Record<string, string>>,
): boolean {
    if (media.id === undefined) return false;

    const extraData = extraDataIndex.get(media.id);
    if (!extraData) return false;

    const key = findExtraDataKey(extraData, tagName);
    return key !== undefined && extraData[key].trim() === '';
}

function matchesRule(
    media: Media,
    rule: LibraryFilterRule,
    extraDataIndex: Map<number, Record<string, string>>,
    fieldValueKinds: Map<string, SortValueKind>,
): boolean {
    let matches: boolean;
    if (rule.kind === 'booleanTag') {
        matches = mediaHasBooleanTag(media, rule.tagName, extraDataIndex);
    } else {
        const rawValue = resolveExtraFieldValue(media, rule.fieldName, extraDataIndex);
        if (rawValue === null) {
            matches = false;
        } else {
            const valueKind = fieldValueKinds.get(rule.fieldName);
            matches = valueKind === 'numeric'
                ? matchesNumericRule(rawValue, rule)
                : matchesTextRule(rawValue, rule);
        }
    }

    return rule.negated ? !matches : matches;
}

function matchesRuleExpression(
    media: Media,
    rules: LibraryFilterRule[],
    extraDataIndex: Map<number, Record<string, string>>,
    fieldValueKinds: Map<string, SortValueKind>,
): boolean {
    if (rules.length === 0) return true;

    let completedOrGroupsMatch = false;
    let currentAndGroupMatches = matchesRule(media, rules[0], extraDataIndex, fieldValueKinds);

    for (const rule of rules.slice(1)) {
        const ruleMatches = matchesRule(media, rule, extraDataIndex, fieldValueKinds);
        if (rule.join === 'or') {
            completedOrGroupsMatch = completedOrGroupsMatch || currentAndGroupMatches;
            currentAndGroupMatches = ruleMatches;
        } else {
            currentAndGroupMatches = currentAndGroupMatches && ruleMatches;
        }
    }

    return completedOrGroupsMatch || currentAndGroupMatches;
}

export function filterMediaByExtraData(
    mediaList: Media[],
    rules: LibraryFilterRule[],
    extraDataIndex: Map<number, Record<string, string>>,
): Media[] {
    const facets = getLibraryExtraDataFacets(extraDataIndex);
    const readyRules = rules.filter(rule => isLibraryFilterRuleReady(rule, extraDataIndex, facets));
    const fieldValueKinds = new Map<string, SortValueKind>();
    for (const rule of readyRules) {
        if (rule.kind === 'extra' && !fieldValueKinds.has(rule.fieldName)) {
            fieldValueKinds.set(
                rule.fieldName,
                getLibraryExtraFieldValueKind(extraDataIndex, rule.fieldName),
            );
        }
    }

    return mediaList.filter(media => (
        matchesRuleExpression(media, readyRules, extraDataIndex, fieldValueKinds)
    ));
}

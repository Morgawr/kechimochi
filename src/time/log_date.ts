export type DateScope = 'day' | 'month' | 'year';

// A DateAnchor is always a full YYYY-MM-DD; a DateKey is a prefix of one.
export type DateAnchor = string & { readonly __dateAnchor: unique symbol };
export type DateKey = string & { readonly __dateKey: unique symbol };

interface ScopedLogDate {
    date: string;
    date_precision: DateScope;
}

const DATE_SCOPES: ReadonlySet<DateScope> = new Set(['day', 'month', 'year']);

export function isDateScope(value: string | undefined): value is DateScope {
    return typeof value === 'string' && DATE_SCOPES.has(value as DateScope);
}

const PRECISION_KEY_LENGTHS: Record<DateScope, number> = { day: 10, month: 7, year: 4 };

export function precisionKeyLength(scope: DateScope): number {
    return PRECISION_KEY_LENGTHS[scope];
}

/**
 * Re-anchors any key or anchor to a full YYYY-MM-DD at `scope`.
 *
 * Widening the scope keeps the prefix the target scope cares about and resets the rest to the start of
 * the period. For example, a `day` anchor widened to `month` keeps its year and month and moves to the 1st.
 *
 * Narrowing has nothing to restore the dropped components from, so it fills them the same
 * way. For example,`2019` at `day` scope is 2019-01-01, the first day of the period.
 */
export function canonicalAnchor(date: string, scope: DateScope): DateAnchor {
    const year = date.slice(0, 4);
    const month = date.length >= 7 ? date.slice(5, 7) : '01';
    const day = date.length >= 10 ? date.slice(8, 10) : '01';
    switch (scope) {
        case 'day':
            return `${year}-${month}-${day}` as DateAnchor;
        case 'month':
            return `${year}-${month}-01` as DateAnchor;
        case 'year':
            return `${year}-01-01` as DateAnchor;
    }
}

export function logDateKey(log: ScopedLogDate): DateKey {
    return log.date.slice(0, precisionKeyLength(log.date_precision)) as DateKey;
}

export function formatUtcIsoDate(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const GREGORIAN_CYCLE_YEARS = 400;

export function utcDateFromParts(year: number, month0Indexed: number, day: number): Date {
    const shifted = new Date(Date.UTC(year + GREGORIAN_CYCLE_YEARS, month0Indexed, day));
    shifted.setUTCFullYear(shifted.getUTCFullYear() - GREGORIAN_CYCLE_YEARS);
    return shifted;
}

export function localTodayAnchor(): DateAnchor {
    const now = new Date();
    return formatUtcIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate()) as DateAnchor;
}

function lastDayBeforeUtc(year: number, month0Indexed: number): string {
    const periodStart = utcDateFromParts(year, month0Indexed, 1);
    const lastDay = new Date(periodStart);
    lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    return formatUtcIsoDate(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1, lastDay.getUTCDate());
}

export function effectiveEnd(log: ScopedLogDate): string {
    if (log.date_precision === 'day') return log.date;

    const anchorYear = Number(log.date.slice(0, 4));

    if (log.date_precision === 'month') {
        const anchorMonth = Number(log.date.slice(5, 7));
        if (anchorYear === 9999 && anchorMonth === 12) return '9999-12-31';
        return lastDayBeforeUtc(anchorYear, anchorMonth);
    }

    if (anchorYear === 9999) return '9999-12-31';
    return lastDayBeforeUtc(anchorYear + 1, 0);
}

export function compareLogRecency(left: ScopedLogDate & { id?: number }, right: ScopedLogDate & { id?: number }): number {
    const endComparison = effectiveEnd(left).localeCompare(effectiveEnd(right));
    if (endComparison !== 0) return endComparison;
    const precisionComparison =
        precisionKeyLength(right.date_precision) - precisionKeyLength(left.date_precision);
    if (precisionComparison !== 0) return precisionComparison;
    return (left.id ?? 0) - (right.id ?? 0);
}

export function compareLogAnchorOrder(left: ScopedLogDate & { id?: number }, right: ScopedLogDate & { id?: number }): number {
    const anchorComparison = left.date.localeCompare(right.date);
    if (anchorComparison !== 0) return anchorComparison;
    const precisionComparison =
        precisionKeyLength(right.date_precision) - precisionKeyLength(left.date_precision);
    if (precisionComparison !== 0) return precisionComparison;
    return (left.id ?? 0) - (right.id ?? 0);
}

export function isContainedInBucket(log: ScopedLogDate, bucketKey: string): boolean {
    const key = logDateKey(log);
    return key.length >= bucketKey.length && key.startsWith(bucketKey);
}

const DAY_LOG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

const MONTH_LOG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});

// Reduced strings are UTC-agnostic date keys ('2026-08-03' / '2026-08' / '2026'); parsing and
// formatting must both pin to UTC, or a local-zone formatter renders '2026-08-03' as August 2
// west of UTC.
export function formatReducedDate(reduced: string): string {
    switch (reduced.length) {
        case 10:
            return DAY_LOG_DATE_FORMATTER.format(new Date(`${reduced}T00:00:00Z`));
        case 7:
            return MONTH_LOG_DATE_FORMATTER.format(new Date(`${reduced}-01T00:00:00Z`));
        case 4:
            return reduced;
        default:
            throw new Error(`Unrecognized reduced date "${reduced}"`);
    }
}

export function formatLogDate(log: ScopedLogDate): string {
    return formatReducedDate(logDateKey(log));
}

import { ActivitySummary, DashboardRangeResponse } from '../api';
import type { DashboardBucket } from '../types';

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ACTIVITY_TIME_RANGES = {
    ALL_TIME: 0,
    WEEKLY: 7,
    MONTHLY: 30,
    YEARLY: 365,
} as const;

export type ActivityTimeRangeDays = typeof ACTIVITY_TIME_RANGES[keyof typeof ACTIVITY_TIME_RANGES];
export type ActivityPeriod = 'week' | 'month' | 'year' | 'all-time';

export interface DatedActivityTotals {
    date: string;
    duration_minutes: number;
    characters: number;
}

export interface ActivityRange {
    labels: string[];
    getBucketIndex: (dateStr: string) => number;
    validStart: string;
    validEnd: string;
    unit: 'day' | 'week' | 'month' | 'year';
    period: ActivityPeriod;
}

export function resolveRangeLogs(
    logs: ActivitySummary[] | undefined,
    rangeData: DashboardRangeResponse | undefined,
): DatedActivityTotals[] {
    return logs ?? rangeData?.bucket_totals.flatMap(bucket => (
        bucket.bucket === null ? [] : [{
            date: bucket.bucket,
            duration_minutes: bucket.total_minutes,
            characters: bucket.total_characters,
        }]
    )) ?? [];
}

export function getActivityRange(timeRangeDays: number, timeRangeOffset: number, logs: DatedActivityTotals[] = [], weekStartDay = 1): ActivityRange {
    switch (timeRangeDays) {
        case ACTIVITY_TIME_RANGES.ALL_TIME: return getAllTimeRange(logs);
        case ACTIVITY_TIME_RANGES.WEEKLY: return getWeeklyRange(timeRangeOffset, weekStartDay);
        case ACTIVITY_TIME_RANGES.MONTHLY: return getMonthlyRange(timeRangeOffset);
        case ACTIVITY_TIME_RANGES.YEARLY: return getYearlyRange(timeRangeOffset);
        default: return getWeeklyRange(timeRangeOffset, weekStartDay);
    }
}

export function getLocalISODate(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getWeeklyRange(timeRangeOffset: number, weekStartDay: number): ActivityRange {
    const labels: string[] = [];
    const targetDay = new Date();
    targetDay.setDate(targetDay.getDate() - (7 * timeRangeOffset));
    const dayOfWeek = targetDay.getDay();
    const normalizedWeekStart = normalizeWeekStartDay(weekStartDay);
    const diffToWeekStart = (dayOfWeek - normalizedWeekStart + 7) % 7;

    const startDay = new Date(targetDay);
    startDay.setDate(targetDay.getDate() - diffToWeekStart);
    const endDay = new Date(startDay);
    endDay.setDate(startDay.getDate() + 6);

    const validStart = getLocalISODate(startDay);
    const validEnd = getLocalISODate(endDay);

    for (let i = 0; i < 7; i++) {
        const d = new Date(startDay);
        d.setDate(startDay.getDate() + i);
        labels.push(getLocalISODate(d));
    }

    return { labels, getBucketIndex: (dateStr: string) => labels.indexOf(dateStr), validStart, validEnd, unit: 'day', period: 'week' };
}

export function normalizeWeekStartDay(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 6) return 1;
    return value;
}

function getMonthlyRange(timeRangeOffset: number): ActivityRange {
    const labels: string[] = [];
    const today = new Date();
    const targetMonth = new Date(today.getFullYear(), today.getMonth() - timeRangeOffset, 1);
    const y = targetMonth.getFullYear();
    const m = targetMonth.getMonth();

    const startDay = new Date(y, m, 1);
    const endDay = new Date(y, m + 1, 0);
    const validStart = getLocalISODate(startDay);
    const validEnd = getLocalISODate(endDay);

    for (let day = 1; day <= endDay.getDate(); day++) {
        labels.push(getLocalISODate(new Date(y, m, day)));
    }

    const getBucketIndex = (dateStr: string) => labels.indexOf(dateStr);

    return { labels, getBucketIndex, validStart, validEnd, unit: 'day', period: 'month' };
}

function getYearlyRange(timeRangeOffset: number): ActivityRange {
    const targetYear = new Date().getFullYear() - timeRangeOffset;
    const validStart = `${targetYear}-01-01`;
    const validEnd = `${targetYear}-12-31`;
    const labels = MONTH_ABBREVIATIONS.slice();

    const getBucketIndex = (dateStr: string) => {
        if (dateStr >= validStart && dateStr <= validEnd) {
            return Number.parseInt(dateStr.split('-')[1], 10) - 1;
        }
        return -1;
    };

    return { labels, getBucketIndex, validStart, validEnd, unit: 'month', period: 'year' };
}

export function getPreviousBucketKey(range: ActivityRange): string | null {
    if (range.unit === 'week') return null;

    // A bare YYYY-MM-DD is parsed as UTC midnight, which reads back as the previous
    // calendar day west of UTC; parsing as local midnight avoids that.
    const start = new Date(range.validStart + 'T00:00:00');
    const pad = (n: number) => n.toString().padStart(2, '0');

    switch (range.unit) {
        case 'day': {
            const previousDay = new Date(start);
            previousDay.setDate(start.getDate() - 1);
            return getLocalISODate(previousDay);
        }
        case 'month': {
            const previousMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1);
            return `${previousMonth.getFullYear()}-${pad(previousMonth.getMonth() + 1)}-01`;
        }
        case 'year': {
            return `${start.getFullYear() - 1}-01-01`;
        }
    }
}

function getAllTimeRange(logs: DatedActivityTotals[]): ActivityRange {
    const years = Array.from(new Set(logs.map(log => log.date.slice(0, 4))))
        .sort((left, right) => left.localeCompare(right));
    const labels = years.length > 0 ? years : [String(new Date().getFullYear())];
    const validStart = `${labels[0]}-01-01`;
    const validEnd = `${labels[labels.length - 1]}-12-31`;

    return {
        labels,
        getBucketIndex: (dateStr: string) => labels.indexOf(dateStr.slice(0, 4)),
        validStart,
        validEnd,
        unit: 'year',
        period: 'all-time',
    };
}

export function getUtcWeekStart(dateString: string, weekStartDay: number): number {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const diff = (date.getUTCDay() - normalizeWeekStartDay(weekStartDay) + 7) % 7;
    date.setUTCDate(date.getUTCDate() - diff);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getMonthlyOffsetForDate(date: string): number {
    const [year, month] = date.split('-').map(Number);
    const today = new Date();
    return Math.max(0, (today.getFullYear() * 12 + today.getMonth()) - (year * 12 + (month - 1)));
}

function getYearlyOffsetForDate(date: string): number {
    return Math.max(0, new Date().getFullYear() - Number.parseInt(date.slice(0, 4), 10));
}

function getWeeklyOffsetForDate(date: string, weekStartDay: number): number {
    const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
    const currentWeekStart = getUtcWeekStart(getLocalISODate(new Date()), weekStartDay);
    const selectedWeekStart = getUtcWeekStart(date, weekStartDay);
    return Math.max(0, Math.round((currentWeekStart - selectedWeekStart) / MILLISECONDS_PER_WEEK));
}

/** How many periods back from today the given date sits, for the active time range. */
export function getOffsetForDate(date: string, timeRangeDays: number, weekStartDay: number): number {
    switch (timeRangeDays) {
        case ACTIVITY_TIME_RANGES.MONTHLY: return getMonthlyOffsetForDate(date);
        case ACTIVITY_TIME_RANGES.YEARLY: return getYearlyOffsetForDate(date);
        default: return getWeeklyOffsetForDate(date, weekStartDay);
    }
}

/**
 * All Time has no backend series to derive its year labels from, so it is seeded with
 * one dated entry per year the profile covers.
 */
export function buildAllTimeRangeSeeds(
    firstActivityDate: string | null,
    lastActivityDate: string | null,
): DatedActivityTotals[] {
    if (!firstActivityDate || !lastActivityDate) return [];
    const firstYear = Number.parseInt(firstActivityDate.slice(0, 4), 10);
    const lastYear = Number.parseInt(lastActivityDate.slice(0, 4), 10);
    const seeds: DatedActivityTotals[] = [];
    for (let year = firstYear; year <= lastYear; year++) {
        seeds.push({
            date: `${year.toString().padStart(4, '0')}-01-01`,
            duration_minutes: 0,
            characters: 0,
        });
    }
    return seeds;
}

export function getDashboardBucket(unit: ActivityRange['unit']): DashboardBucket {
    if (unit === 'day') return 'day';
    if (unit === 'month') return 'month';
    return 'year';
}

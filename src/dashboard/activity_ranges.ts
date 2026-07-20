import { ActivitySummary } from '../api';

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ACTIVITY_TIME_RANGES = {
    ALL_TIME: 0,
    WEEKLY: 7,
    MONTHLY: 30,
    YEARLY: 365,
} as const;

export type ActivityTimeRangeDays = typeof ACTIVITY_TIME_RANGES[keyof typeof ACTIVITY_TIME_RANGES];
export type ActivityPeriod = 'week' | 'month' | 'year' | 'all-time';

export interface ActivityRange {
    labels: string[];
    getBucketIndex: (dateStr: string) => number;
    validStart: string;
    validEnd: string;
    unit: 'day' | 'week' | 'month' | 'year';
    period: ActivityPeriod;
}

export function getActivityRange(timeRangeDays: number, timeRangeOffset: number, logs: ActivitySummary[] = [], weekStartDay = 1): ActivityRange {
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

function normalizeWeekStartDay(value: number): number {
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

function getAllTimeRange(logs: ActivitySummary[]): ActivityRange {
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

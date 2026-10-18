import type { DailyHeatmap } from '../../../api';
import {
    ACTIVITY_TIME_RANGES,
    getActivityRange,
    getLocalISODate,
    getOffsetForDate,
    normalizeWeekStartDay,
    type ActivityPeriod,
    type ActivityTimeRangeDays,
} from '../../activity_ranges';

// A day reaches full heatmap intensity at 6 hours of time, or 60,000 characters.
// This assumes an average-ish learner reading at ~10,000 characters/hour.
const HEATMAP_FULL_INTENSITY_MINUTES = 360;
const HEATMAP_FULL_INTENSITY_CHARACTERS = 60000;

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const DAYS_FROM_WEEK_START_TO_MIDDLE = 3;
const WEEKDAY_LABELS_FROM_SUNDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LIGHT_BACKGROUND_THRESHOLD_LIGHTNESS = 60;
const MONTH_NAME_REFERENCE_YEAR = 2000;

const PERIOD_TIME_RANGE_DAYS: Record<ActivityPeriod, ActivityTimeRangeDays> = {
    week: ACTIVITY_TIME_RANGES.WEEKLY,
    month: ACTIVITY_TIME_RANGES.MONTHLY,
    year: ACTIVITY_TIME_RANGES.YEARLY,
    'all-time': ACTIVITY_TIME_RANGES.ALL_TIME,
};

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const SHORT_MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
const MONTH_INITIAL_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'narrow' });
const MONTH_SHORT_NAME_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short' });

export type HeatmapGridOrientation = 'columns' | 'rows';
export type HeatmapTextTone = 'light' | 'dark';
export type OutlineEdge = 'top' | 'right' | 'bottom' | 'left';

export interface HeatmapSelection {
    period: ActivityPeriod;
    start: string;
    end: string;
    weekStartDay: number;
}

export interface DisplayedMonth {
    year: number;
    monthIndex: number;
}

export interface DateRange {
    start: string;
    end: string;
}

export interface HeatmapTheme {
    hue: string;
    saturationBase: number;
    saturationRange: number;
    lightnessBase: number;
    lightnessRange: number;
}

export interface HeatmapColor {
    backgroundColor: string;
    textTone: HeatmapTextTone;
}

export type HeatmapSlot = string | null;

export interface MonthLabelSpan {
    monthIndex: number;
    label: string;
    startColumn: number;
    columnCount: number;
    isSelected: boolean;
}

function getIntensityRatio(value: number, fullIntensityValue: number): number {
    if (value <= 0) return 0;
    return Math.min(1, (value - 1) / (fullIntensityValue - 1));
}

export function getDayIntensity(minutes: number, characters: number): number | null {
    if (minutes <= 0 && characters <= 0) return null;
    return Math.max(
        getIntensityRatio(minutes, HEATMAP_FULL_INTENSITY_MINUTES),
        getIntensityRatio(characters, HEATMAP_FULL_INTENSITY_CHARACTERS),
    );
}

export function getMonthIntensity(days: readonly DailyHeatmap[], month: DisplayedMonth, todayIso: string): number | null {
    const monthStart = toIsoDate(month.year, month.monthIndex, 1);
    const monthEnd = toIsoDate(month.year, month.monthIndex + 1, 0);
    const lastCountedDay = monthEnd < todayIso ? monthEnd : todayIso;
    if (lastCountedDay < monthStart) return null;

    let totalMinutes = 0;
    let totalCharacters = 0;
    for (const day of days) {
        if (day.date < monthStart || day.date > lastCountedDay) continue;
        totalMinutes += day.total_minutes;
        totalCharacters += day.total_characters;
    }
    if (totalMinutes <= 0 && totalCharacters <= 0) return null;

    const elapsedDays = Number.parseInt(lastCountedDay.slice(8, 10), 10);
    return getDayIntensity(totalMinutes / elapsedDays, totalCharacters / elapsedDays);
}

export function getHeatmapColor(intensity: number, theme: HeatmapTheme): HeatmapColor {
    const saturation = theme.saturationBase + (intensity * theme.saturationRange);
    const lightness = theme.lightnessBase + (intensity * theme.lightnessRange);
    return {
        backgroundColor: `hsl(${theme.hue}, ${saturation}%, ${lightness}%)`,
        textTone: lightness >= LIGHT_BACKGROUND_THRESHOLD_LIGHTNESS ? 'dark' : 'light',
    };
}

export function buildYearColumns(year: number, weekStartDay: number): HeatmapSlot[][] {
    const slots: HeatmapSlot[] = new Array<HeatmapSlot>(getLeadingPadding(new Date(year, 0, 1), weekStartDay)).fill(null);
    for (const day = new Date(year, 0, 1); day.getFullYear() === year; day.setDate(day.getDate() + 1)) {
        slots.push(getLocalISODate(day));
    }
    return chunkIntoWeeks(slots);
}

export function buildMonthWeeks(month: DisplayedMonth, weekStartDay: number): string[][] {
    const firstDay = new Date(month.year, month.monthIndex, 1);
    const day = new Date(month.year, month.monthIndex, 1 - getLeadingPadding(firstDay, weekStartDay));
    const dates: string[] = [];
    while (day <= new Date(month.year, month.monthIndex + 1, 0) || dates.length % DAYS_PER_WEEK !== 0) {
        dates.push(getLocalISODate(day));
        day.setDate(day.getDate() + 1);
    }
    return chunkIntoWeeks(dates);
}

export function isDateInMonth(date: string, month: DisplayedMonth): boolean {
    return date.slice(0, 7) === formatMonthKey(month);
}

export function getWeekdayLabels(weekStartDay: number): string[] {
    const start = normalizeWeekStartDay(weekStartDay);
    return Array.from({ length: DAYS_PER_WEEK }, (_, index) => WEEKDAY_LABELS_FROM_SUNDAY[(start + index) % DAYS_PER_WEEK]);
}

export function getPeriodForDate(date: string, period: ActivityPeriod, weekStartDay: number): DateRange | null {
    if (period === 'all-time') return null;
    const timeRangeDays = PERIOD_TIME_RANGE_DAYS[period];
    const range = getActivityRange(timeRangeDays, getOffsetForDate(date, timeRangeDays, weekStartDay), [], weekStartDay);
    return { start: range.validStart, end: range.validEnd };
}

export function shouldOutlinePeriod(period: ActivityPeriod): boolean {
    return period === 'week' || period === 'month';
}

export function isDateInRange(date: string, range: DateRange): boolean {
    return date >= range.start && date <= range.end;
}

export function resolveDisplayedMonth(displayed: DisplayedMonth, selection: HeatmapSelection | null): DisplayedMonth {
    if (!selection || selection.period === 'all-time') return displayed;
    const displayedRange = {
        start: toIsoDate(displayed.year, displayed.monthIndex, 1),
        end: toIsoDate(displayed.year, displayed.monthIndex + 1, 0),
    };
    if (rangesOverlap(selection, displayedRange)) return displayed;

    switch (selection.period) {
        case 'year':
            return { year: parseIsoYear(selection.start), monthIndex: displayed.monthIndex };
        case 'month':
            return toDisplayedMonth(selection.start);
        case 'week': {
            const [year, month, day] = selection.start.split('-').map(Number);
            let anchor = getLocalISODate(new Date(year, month - 1, day + DAYS_FROM_WEEK_START_TO_MIDDLE));
            const displayedYear = { start: toIsoDate(displayed.year, 0, 1), end: toIsoDate(displayed.year, 11, 31) };
            if (rangesOverlap(selection, displayedYear)) {
                anchor = clampDate(anchor, displayedYear);
            }
            return toDisplayedMonth(anchor);
        }
    }
}

export function isSameSelection(previous: HeatmapSelection | null, next: HeatmapSelection | null): boolean {
    return previous?.period === next?.period
        && previous?.start === next?.start
        && previous?.end === next?.end
        && previous?.weekStartDay === next?.weekStartDay;
}

export function stepMonth(month: DisplayedMonth, direction: number): DisplayedMonth {
    const absoluteMonth = (month.year * MONTHS_PER_YEAR) + month.monthIndex + direction;
    return {
        year: Math.floor(absoluteMonth / MONTHS_PER_YEAR),
        monthIndex: ((absoluteMonth % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR,
    };
}

export function getDaySelectionLabel(date: string, period: ActivityPeriod | null): string {
    const day = parseIsoDate(date);
    switch (period) {
        case 'week': return `Show week of ${DAY_LABEL_FORMATTER.format(day)}`;
        case 'month': return `Show ${MONTH_LABEL_FORMATTER.format(day)}`;
        case 'year': return `Show ${day.getFullYear()}`;
        default: return `Show activity for ${DAY_LABEL_FORMATTER.format(day)}`;
    }
}

export function getRegionOutlineEdges(
    grid: HeatmapSlot[][],
    isInside: (date: string) => boolean,
    orientation: HeatmapGridOrientation,
): Map<string, OutlineEdge[]> {
    const slotAt = (x: number, y: number): HeatmapSlot => (
        orientation === 'columns' ? grid[x]?.[y] : grid[y]?.[x]
    ) ?? null;
    const isInsideAt = (x: number, y: number): boolean => {
        const slot = slotAt(x, y);
        return slot !== null && isInside(slot);
    };

    const edgesByDate = new Map<string, OutlineEdge[]>();
    grid.forEach((line, outerIndex) => line.forEach((slot, innerIndex) => {
        if (slot === null || !isInside(slot)) return;
        const [x, y] = orientation === 'columns' ? [outerIndex, innerIndex] : [innerIndex, outerIndex];
        const edges: OutlineEdge[] = [];
        if (!isInsideAt(x, y - 1)) edges.push('top');
        if (!isInsideAt(x + 1, y)) edges.push('right');
        if (!isInsideAt(x, y + 1)) edges.push('bottom');
        if (!isInsideAt(x - 1, y)) edges.push('left');
        if (edges.length > 0) edgesByDate.set(slot, edges);
    }));
    return edgesByDate;
}

export function getMonthLabelSpans(columns: HeatmapSlot[][], selection: HeatmapSelection | null): MonthLabelSpan[] {
    const selectedMonthIndex = getSelectedMonthIndex(columns, selection);
    const spans: MonthLabelSpan[] = [];
    columns.forEach((column, columnIndex) => {
        const monthIndex = getColumnMonthIndex(column);
        const currentSpan = spans.at(-1);
        if (currentSpan?.monthIndex === monthIndex) {
            currentSpan.columnCount += 1;
            return;
        }
        spans.push({
            monthIndex,
            label: MONTH_SHORT_NAME_FORMATTER.format(new Date(MONTH_NAME_REFERENCE_YEAR, monthIndex, 1)),
            startColumn: columnIndex,
            columnCount: 1,
            isSelected: monthIndex === selectedMonthIndex,
        });
    });
    return spans;
}

function getSelectedMonthIndex(columns: HeatmapSlot[][], selection: HeatmapSelection | null): number | null {
    if (selection === null || !shouldOutlinePeriod(selection.period)) return null;
    const selectedColumn = columns.find(column => column.some(slot => slot !== null && isDateInRange(slot, selection)));
    if (!selectedColumn) return null;
    return selection.period === 'month' ? parseIsoDate(selection.start).getMonth() : getColumnMonthIndex(selectedColumn);
}

export function formatMonthLabel(month: DisplayedMonth): string {
    return MONTH_LABEL_FORMATTER.format(new Date(month.year, month.monthIndex, 1));
}

export function formatShortMonthLabel(month: DisplayedMonth): string {
    return SHORT_MONTH_LABEL_FORMATTER.format(new Date(month.year, month.monthIndex, 1));
}

export function formatMonthInitial(monthIndex: number): string {
    return MONTH_INITIAL_FORMATTER.format(new Date(MONTH_NAME_REFERENCE_YEAR, monthIndex, 1));
}

export function formatMonthKey(month: DisplayedMonth): string {
    return toIsoDate(month.year, month.monthIndex, 1).slice(0, 7);
}

export const MONTH_INDICES: readonly number[] = Array.from({ length: MONTHS_PER_YEAR }, (_, index) => index);

export function parseMonthKey(monthKey: string): DisplayedMonth {
    const [year, month] = monthKey.split('-').map(Number);
    return { year, monthIndex: month - 1 };
}

function getLeadingPadding(firstDay: Date, weekStartDay: number): number {
    return (firstDay.getDay() - normalizeWeekStartDay(weekStartDay) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

function getColumnMonthIndex(column: HeatmapSlot[]): number {
    const firstDateIndex = column.findIndex(slot => slot !== null);
    const firstDate = parseIsoDate(column[firstDateIndex]!);
    const middleDay = new Date(
        firstDate.getFullYear(),
        firstDate.getMonth(),
        firstDate.getDate() - firstDateIndex + DAYS_FROM_WEEK_START_TO_MIDDLE,
    );
    if (middleDay.getFullYear() < firstDate.getFullYear()) return 0;
    if (middleDay.getFullYear() > firstDate.getFullYear()) return MONTHS_PER_YEAR - 1;
    return middleDay.getMonth();
}

function chunkIntoWeeks<T>(slots: T[]): T[][] {
    const weeks: T[][] = [];
    for (let index = 0; index < slots.length; index += DAYS_PER_WEEK) {
        weeks.push(slots.slice(index, index + DAYS_PER_WEEK));
    }
    return weeks;
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
    return getLocalISODate(new Date(year, monthIndex, day));
}

function parseIsoDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function parseIsoYear(date: string): number {
    return Number.parseInt(date.slice(0, 4), 10);
}

function toDisplayedMonth(date: string): DisplayedMonth {
    const parsed = parseIsoDate(date);
    return { year: parsed.getFullYear(), monthIndex: parsed.getMonth() };
}

function rangesOverlap(first: DateRange, second: DateRange): boolean {
    return first.start <= second.end && first.end >= second.start;
}

function clampDate(date: string, range: DateRange): string {
    if (date < range.start) return range.start;
    if (date > range.end) return range.end;
    return date;
}

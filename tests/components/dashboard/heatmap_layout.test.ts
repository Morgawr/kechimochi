import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MONTH_INDICES,
    buildMonthWeeks,
    buildYearColumns,
    formatMonthInitial,
    formatMonthKey,
    formatShortMonthLabel,
    getDayIntensity,
    getDaySelectionLabel,
    getHeatmapColor,
    getMonthIntensity,
    getMonthLabelSpans,
    getPeriodForDate,
    getRegionOutlineEdges,
    getWeekdayLabels,
    isDateInMonth,
    isSameSelection,
    resolveDisplayedMonth,
    shouldOutlinePeriod,
    stepMonth,
    type HeatmapSelection,
    type MonthLabelSpan,
} from '../../../src/dashboard/cards/heatmap/heatmap_layout';

const MONDAY = 1;
const SUNDAY = 0;
const SATURDAY = 6;

function weekSelection(start: string, end: string, weekStartDay = MONDAY): HeatmapSelection {
    return { period: 'week', start, end, weekStartDay };
}

describe('getDayIntensity', () => {
    it('should return null for a day with nothing tracked', () => {
        expect(getDayIntensity(0, 0)).toBeNull();
    });

    it('should reach full intensity at six hours or 60,000 characters', () => {
        expect(getDayIntensity(360, 0)).toBe(1);
        expect(getDayIntensity(0, 60000)).toBe(1);
    });

    it('should use the hotter of the time and character ratios', () => {
        expect(getDayIntensity(10, 30000)).toBe(getDayIntensity(0, 30000));
        expect(getDayIntensity(10, 30000)!).toBeGreaterThan(getDayIntensity(10, 0)!);
    });

    it('should keep a barely tracked day distinct from an untracked one', () => {
        expect(getDayIntensity(1, 0)).toBe(0);
    });
});

describe('getMonthIntensity', () => {
    const march2024 = { year: 2024, monthIndex: 2 };

    it('should average over the elapsed days of the month only', () => {
        const days = [
            { date: '2024-03-05', total_minutes: 360, total_characters: 0 },
            { date: '2024-02-28', total_minutes: 360, total_characters: 0 },
        ];

        expect(getMonthIntensity(days, march2024, '2024-03-10')).toBe(getDayIntensity(36, 0));
    });

    it('should return null for a month without activity', () => {
        expect(getMonthIntensity([], march2024, '2024-03-31')).toBeNull();
    });

    it('should return null for a month that has not started', () => {
        const days = [{ date: '2024-03-05', total_minutes: 60, total_characters: 0 }];

        expect(getMonthIntensity(days, march2024, '2024-02-20')).toBeNull();
    });
});

describe('getHeatmapColor', () => {
    const theme = { hue: '210', saturationBase: 40, saturationRange: 60, lightnessBase: 45, lightnessRange: 41 };

    it('should interpolate saturation and lightness by intensity', () => {
        expect(getHeatmapColor(0, theme).backgroundColor).toBe('hsl(210, 40%, 45%)');
        expect(getHeatmapColor(1, theme).backgroundColor).toBe('hsl(210, 100%, 86%)');
    });

    it('should pick a text tone readable on the background', () => {
        expect(getHeatmapColor(0, theme).textTone).toBe('light');
        expect(getHeatmapColor(1, theme).textTone).toBe('dark');
    });
});

describe('buildYearColumns', () => {
    it.each([
        [MONDAY, 3],
        [SUNDAY, 4],
        [SATURDAY, 5],
    ])('should pad the first column so rows follow week start day %i', (weekStartDay, expectedPadding) => {
        const columns = buildYearColumns(2026, weekStartDay);

        expect(columns[0].slice(0, expectedPadding).every(slot => slot === null)).toBe(true);
        expect(columns[0][expectedPadding]).toBe('2026-01-01');
    });

    it('should list every day of the year once in week columns', () => {
        const columns = buildYearColumns(2024, MONDAY);
        const dates = columns.flat().filter(slot => slot !== null);

        expect(dates).toHaveLength(366);
        expect(dates.at(-1)).toBe('2024-12-31');
        expect(columns.slice(0, -1).every(column => column.length === 7)).toBe(true);
    });
});

describe('buildMonthWeeks', () => {
    it('should fill whole weeks with days of the neighbouring months', () => {
        const weeks = buildMonthWeeks({ year: 2026, monthIndex: 1 }, MONDAY);

        expect(weeks).toHaveLength(5);
        expect(weeks[0]).toEqual(['2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01']);
        expect(weeks.at(-1)).toEqual(['2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01']);
    });

    it('should not add neighbouring days when the month already fills whole weeks', () => {
        const weeks = buildMonthWeeks({ year: 2026, monthIndex: 1 }, SUNDAY);

        expect(weeks).toHaveLength(4);
        expect(weeks[0][0]).toBe('2026-02-01');
        expect(weeks.at(-1)!.at(-1)).toBe('2026-02-28');
    });
});

describe('getWeekdayLabels', () => {
    it('should rotate the labels to the week start day', () => {
        expect(getWeekdayLabels(MONDAY)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
        expect(getWeekdayLabels(SUNDAY)[0]).toBe('Su');
        expect(getWeekdayLabels(SATURDAY)[0]).toBe('Sa');
    });
});

describe('getPeriodForDate', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return the period of the active scope that contains the date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-03-31T12:00:00'));

        expect(getPeriodForDate('2024-03-07', 'week', MONDAY)).toEqual({ start: '2024-03-04', end: '2024-03-10' });
        expect(getPeriodForDate('2024-03-07', 'week', SUNDAY)).toEqual({ start: '2024-03-03', end: '2024-03-09' });
        expect(getPeriodForDate('2024-03-07', 'month', MONDAY)).toEqual({ start: '2024-03-01', end: '2024-03-31' });
        expect(getPeriodForDate('2023-03-07', 'year', MONDAY)).toEqual({ start: '2023-01-01', end: '2023-12-31' });
    });

    it('should return null in All Time, where a click selects nothing', () => {
        expect(getPeriodForDate('2024-03-07', 'all-time', MONDAY)).toBeNull();
    });
});

describe('shouldOutlinePeriod', () => {
    it.each([
        ['week', true],
        ['month', true],
        ['year', false],
        ['all-time', false],
    ] as const)('should outline %s: %s', (period, expected) => {
        expect(shouldOutlinePeriod(period)).toBe(expected);
    });
});

describe('resolveDisplayedMonth', () => {
    const march2026 = { year: 2026, monthIndex: 2 };

    it('should keep the displayed month when the selection overlaps it', () => {
        expect(resolveDisplayedMonth(march2026, weekSelection('2026-02-23', '2026-03-01'))).toEqual(march2026);
    });

    it('should keep the displayed month without a selection or in All Time', () => {
        expect(resolveDisplayedMonth(march2026, null)).toEqual(march2026);
        expect(resolveDisplayedMonth(march2026, { period: 'all-time', start: '2020-01-01', end: '2026-12-31', weekStartDay: MONDAY }))
            .toEqual(march2026);
    });

    it('should move to a selected month', () => {
        expect(resolveDisplayedMonth(march2026, { period: 'month', start: '2025-04-01', end: '2025-04-30', weekStartDay: MONDAY }))
            .toEqual({ year: 2025, monthIndex: 3 });
    });

    it('should keep the month of year when a different year is selected', () => {
        expect(resolveDisplayedMonth(march2026, { period: 'year', start: '2024-01-01', end: '2024-12-31', weekStartDay: MONDAY }))
            .toEqual({ year: 2024, monthIndex: 2 });
    });

    it('should move to the month holding most of a selected week', () => {
        expect(resolveDisplayedMonth(march2026, weekSelection('2024-03-04', '2024-03-10'))).toEqual({ year: 2024, monthIndex: 2 });
        expect(resolveDisplayedMonth(march2026, weekSelection('2026-04-27', '2026-05-03'))).toEqual({ year: 2026, monthIndex: 3 });
    });

    it('should stay in the displayed year when a selected week straddles New Year', () => {
        const june2027 = { year: 2027, monthIndex: 5 };

        expect(resolveDisplayedMonth(june2027, weekSelection('2026-12-27', '2027-01-02', SUNDAY))).toEqual({ year: 2027, monthIndex: 0 });
    });
});

describe('isSameSelection', () => {
    it('should compare every field of the selection', () => {
        const week = weekSelection('2024-03-04', '2024-03-10');

        expect(isSameSelection(week, { ...week })).toBe(true);
        expect(isSameSelection(null, null)).toBe(true);
        expect(isSameSelection(week, null)).toBe(false);
        expect(isSameSelection(week, { ...week, weekStartDay: SUNDAY })).toBe(false);
        expect(isSameSelection(week, { ...week, start: '2024-03-11', end: '2024-03-17' })).toBe(false);
    });
});

describe('stepMonth', () => {
    it('should cross year boundaries in both directions', () => {
        expect(stepMonth({ year: 2026, monthIndex: 11 }, 1)).toEqual({ year: 2027, monthIndex: 0 });
        expect(stepMonth({ year: 2026, monthIndex: 0 }, -1)).toEqual({ year: 2025, monthIndex: 11 });
        expect(stepMonth({ year: 2026, monthIndex: 5 }, 1)).toEqual({ year: 2026, monthIndex: 6 });
    });
});

describe('getRegionOutlineEdges', () => {
    const isInside = (slot: string) => slot.startsWith('in');

    it('should give a single column its outer walls only', () => {
        const edges = getRegionOutlineEdges([['in1', 'in2', 'in3'], ['out1', 'out2', 'out3']], isInside, 'columns');

        expect(edges.get('in1')).toEqual(['top', 'right', 'left']);
        expect(edges.get('in2')).toEqual(['right', 'left']);
        expect(edges.get('in3')).toEqual(['right', 'bottom', 'left']);
        expect(edges.has('out1')).toBe(false);
    });

    it('should step around a region that starts mid-column', () => {
        const columns = [
            ['out1', 'out2', 'inA'],
            ['inB', 'inC', 'inD'],
        ];
        const edges = getRegionOutlineEdges(columns, isInside, 'columns');

        expect(edges.get('inA')).toEqual(['top', 'bottom', 'left']);
        expect(edges.get('inB')).toEqual(['top', 'right', 'left']);
        expect(edges.get('inC')).toEqual(['right', 'left']);
        expect(edges.get('inD')).toEqual(['right', 'bottom']);
    });

    it('should treat padding slots as outside the region', () => {
        const edges = getRegionOutlineEdges([[null, 'in1'], ['in2', 'in3']], isInside, 'columns');

        expect(edges.get('in1')).toEqual(['top', 'bottom', 'left']);
        expect(edges.get('in2')).toEqual(['top', 'right', 'left']);
    });

    it('should read rows when the grid lists calendar weeks', () => {
        const edges = getRegionOutlineEdges([['in1', 'in2'], ['out1', 'out2']], isInside, 'rows');

        expect(edges.get('in1')).toEqual(['top', 'bottom', 'left']);
        expect(edges.get('in2')).toEqual(['top', 'right', 'bottom']);
    });

    it('should leave interior cells out of the result', () => {
        const grid = [['in1', 'in2', 'in3'], ['in4', 'in5', 'in6'], ['in7', 'in8', 'in9']];

        expect(getRegionOutlineEdges(grid, isInside, 'rows').has('in5')).toBe(false);
    });
});

describe('getMonthLabelSpans', () => {
    const selectedLabels = (spans: MonthLabelSpan[]) => spans.filter(span => span.isSelected).map(span => span.label);
    const monthSelection = (start: string, end: string): HeatmapSelection => ({ period: 'month', start, end, weekStartDay: MONDAY });

    it('should give each month the columns whose middle day falls in it', () => {
        const spans = getMonthLabelSpans(buildYearColumns(2026, MONDAY), null);

        expect(spans.map(span => span.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
        expect(spans.map(span => span.columnCount)).toEqual([5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 5]);
        expect(spans.map(span => span.startColumn)).toEqual([0, 5, 9, 13, 18, 22, 26, 31, 35, 39, 44, 48]);
    });

    it('should cover every column with twelve months of four or five columns for any first weekday', () => {
        for (let year = 2020; year <= 2030; year++) {
            for (const weekStartDay of [MONDAY, SUNDAY, SATURDAY]) {
                const columns = buildYearColumns(year, weekStartDay);
                const spans = getMonthLabelSpans(columns, null);

                expect(spans.map(span => span.monthIndex)).toEqual(MONTH_INDICES);
                expect(spans.every(span => span.columnCount === 4 || span.columnCount === 5)).toBe(true);
                expect(spans.every((span, index) => index === 0 || span.startColumn === spans[index - 1].startColumn + spans[index - 1].columnCount)).toBe(true);
                expect(spans.at(-1)!.startColumn + spans.at(-1)!.columnCount).toBe(columns.length);
            }
        }
    });

    it('should fold a first column that is mostly last year into January', () => {
        const spans = getMonthLabelSpans(buildYearColumns(2027, MONDAY), null);

        expect(spans[0]).toMatchObject({ monthIndex: 0, startColumn: 0, columnCount: 5 });
    });

    it('should fold a last column that is mostly next year into December', () => {
        const columns = buildYearColumns(2024, MONDAY);
        const spans = getMonthLabelSpans(columns, null);

        expect(columns.at(-1)).toEqual(['2024-12-30', '2024-12-31']);
        expect(spans.at(-1)).toMatchObject({ monthIndex: 11, columnCount: 5 });
    });

    it('should span a 54-column year', () => {
        const columns = buildYearColumns(2028, SUNDAY);
        const spans = getMonthLabelSpans(columns, null);

        expect(columns).toHaveLength(54);
        expect(spans[0]).toMatchObject({ monthIndex: 0, startColumn: 0 });
        expect(spans.at(-1)!.startColumn + spans.at(-1)!.columnCount).toBe(54);
    });

    it('should highlight only the selected month, not the neighbours sharing its edge weeks', () => {
        const spans = getMonthLabelSpans(buildYearColumns(2026, MONDAY), monthSelection('2026-09-01', '2026-09-30'));

        expect(selectedLabels(spans)).toEqual(['Sep']);
    });

    it('should highlight the month that owns the column of a week straddling two months', () => {
        const columns = buildYearColumns(2026, MONDAY);

        expect(selectedLabels(getMonthLabelSpans(columns, weekSelection('2026-09-28', '2026-10-04')))).toEqual(['Oct']);
        expect(selectedLabels(getMonthLabelSpans(columns, weekSelection('2026-08-31', '2026-09-06')))).toEqual(['Sep']);
    });

    it('should highlight the month above a week straddling New Year in either year', () => {
        const newYearWeek = weekSelection('2026-12-28', '2027-01-03');

        expect(selectedLabels(getMonthLabelSpans(buildYearColumns(2026, MONDAY), newYearWeek))).toEqual(['Dec']);
        expect(selectedLabels(getMonthLabelSpans(buildYearColumns(2027, MONDAY), newYearWeek))).toEqual(['Jan']);
    });

    it('should highlight nothing for a year, All Time, or a period in another year', () => {
        const columns = buildYearColumns(2026, MONDAY);

        expect(selectedLabels(getMonthLabelSpans(columns, { period: 'year', start: '2026-01-01', end: '2026-12-31', weekStartDay: MONDAY }))).toEqual([]);
        expect(selectedLabels(getMonthLabelSpans(columns, { period: 'all-time', start: '2020-01-01', end: '2026-12-31', weekStartDay: MONDAY }))).toEqual([]);
        expect(selectedLabels(getMonthLabelSpans(columns, monthSelection('2025-09-01', '2025-09-30')))).toEqual([]);
    });
});

describe('labels', () => {
    it('should describe the period a click on the day selects', () => {
        expect(getDaySelectionLabel('2024-03-07', 'week')).toBe('Show week of Mar 7, 2024');
        expect(getDaySelectionLabel('2024-03-07', 'month')).toBe('Show March 2024');
        expect(getDaySelectionLabel('2024-03-07', 'year')).toBe('Show 2024');
        expect(getDaySelectionLabel('2024-03-07', null)).toBe('Show activity for Mar 7, 2024');
    });

    it('should format month keys and labels', () => {
        const march2024 = { year: 2024, monthIndex: 2 };

        expect(formatMonthKey(march2024)).toBe('2024-03');
        expect(formatShortMonthLabel(march2024)).toBe('Mar 2024');
        expect(formatMonthInitial(0)).toBe('J');
        expect(isDateInMonth('2024-03-31', march2024)).toBe(true);
        expect(isDateInMonth('2024-04-01', march2024)).toBe(false);
    });
});

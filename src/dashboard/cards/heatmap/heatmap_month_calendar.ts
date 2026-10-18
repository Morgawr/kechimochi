import { renderNavigationChevron } from '../../../icons';
import {
    MONTH_INDICES,
    buildMonthWeeks,
    formatMonthInitial,
    formatMonthKey,
    formatMonthLabel,
    formatShortMonthLabel,
    getHeatmapColor,
    getMonthIntensity,
    getWeekdayLabels,
    isDateInMonth,
    type DisplayedMonth,
} from './heatmap_layout';
import {
    MOAT_MARKUP,
    buildActivityMarkup,
    buildSelectionMarkup,
    getSelectionOutline,
    type HeatmapRenderContext,
    type SelectionOutline,
} from './heatmap_day_cell';

export function renderMonthCalendar(month: DisplayedMonth, context: HeatmapRenderContext): string {
    const weekdays = getWeekdayLabels(context.weekStartDay)
        .map(label => `<span class="heatmap-calendar-weekday">${label}</span>`)
        .join('');
    const weeks = buildMonthWeeks(month, context.weekStartDay);
    const outline = getSelectionOutline(weeks, context, 'rows');
    const days = weeks.flat().map(date => renderCalendarDay(date, month, context, outline)).join('');

    return `
        <div class="heatmap-mobile">
            <div class="heatmap-header">
                <div class="heatmap-title-controls">
                    <button type="button" class="btn btn-ghost chart-nav-button" data-heatmap-month-step="-1" aria-label="Previous month">
                        ${renderNavigationChevron('previous')}
                    </button>
                    <h3 class="heatmap-title dashboard-module-title">Heatmap (${formatShortMonthLabel(month)})</h3>
                    <button type="button" class="btn btn-ghost chart-nav-button" data-heatmap-month-step="1" aria-label="Next month">
                        ${renderNavigationChevron('next')}
                    </button>
                </div>
            </div>
            <div class="heatmap-month-strip" role="group" aria-label="Months of ${month.year}">
                ${renderMonthStrip(month, context)}
            </div>
            <div class="heatmap-calendar">
                <div class="heatmap-calendar-weekdays" aria-hidden="true">${weekdays}</div>
                <div class="heatmap-calendar-days">${days}</div>
            </div>
        </div>
    `;
}

function renderMonthStrip(displayedMonth: DisplayedMonth, context: HeatmapRenderContext): string {
    return MONTH_INDICES.map(monthIndex => {
        const month = { year: displayedMonth.year, monthIndex };
        const intensity = getMonthIntensity(context.days, month, context.todayIso);
        const color = intensity === null ? null : getHeatmapColor(intensity, context.theme);
        const classes = ['heatmap-month-strip-button'];
        if (color) classes.push(`heatmap-text-${color.textTone}`);
        const style = color ? ` style="background-color: ${color.backgroundColor};"` : '';
        return `<button type="button" class="${classes.join(' ')}" data-heatmap-month="${formatMonthKey(month)}"`
            + ` aria-label="Show ${formatMonthLabel(month)}" aria-pressed="${monthIndex === displayedMonth.monthIndex}"${style}>`
            + `${formatMonthInitial(monthIndex)}</button>`;
    }).join('');
}

function renderCalendarDay(date: string, month: DisplayedMonth, context: HeatmapRenderContext, outline: SelectionOutline): string {
    const selection = buildSelectionMarkup(date, context, outline);
    const activity = isDateInMonth(date, month)
        ? buildActivityMarkup(date, context)
        : { classes: ['heatmap-calendar-day-outside'], attributes: [] };
    const classes = ['heatmap-calendar-day', ...selection.classes, ...activity.classes];
    const attributes = [...selection.attributes, ...activity.attributes];
    const dayNumber = Number.parseInt(date.slice(8, 10), 10);

    if (!selection.isSelectable) {
        return `<span class="${classes.join(' ')}" ${attributes.join(' ')}>${dayNumber}${MOAT_MARKUP}</span>`;
    }
    classes.push('heatmap-calendar-day-interactive');
    return `<button type="button" class="${classes.join(' ')}" ${attributes.join(' ')}>${dayNumber}${MOAT_MARKUP}</button>`;
}

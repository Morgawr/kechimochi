import { getMonthLabelSpans, type HeatmapSlot } from './heatmap_layout';
import {
    MOAT_MARKUP,
    buildActivityMarkup,
    buildSelectionMarkup,
    getSelectionOutline,
    type HeatmapRenderContext,
    type SelectionOutline,
} from './heatmap_day_cell';

export function renderYearGrid(columns: HeatmapSlot[][], context: HeatmapRenderContext): string {
    const outline = getSelectionOutline(columns, context, 'columns');
    const renderedColumns = columns
        .map(column => `<div class="heatmap-col">${column.map(slot => renderYearCell(slot, context, outline)).join('')}</div>`)
        .join('');
    return `${renderMonthLabels(columns, context)}<div class="heatmap">${renderedColumns}</div>`;
}

function renderMonthLabels(columns: HeatmapSlot[][], context: HeatmapRenderContext): string {
    const labels = getMonthLabelSpans(columns, context.selection)
        .map(span => {
            const attributes = [`data-month-index="${span.monthIndex}"`, `data-column-count="${span.columnCount}"`];
            if (span.isSelected) attributes.push('data-selected');
            return `<span class="heatmap-month-label" ${attributes.join(' ')}>${span.label}</span>`;
        })
        .join('');
    return `<div class="heatmap-month-labels" aria-hidden="true">${labels}</div>`;
}

function renderYearCell(slot: HeatmapSlot, context: HeatmapRenderContext, outline: SelectionOutline): string {
    if (slot === null) {
        return '<div class="heatmap-cell heatmap-cell-padding"></div>';
    }

    const selection = buildSelectionMarkup(slot, context, outline);
    const activity = buildActivityMarkup(slot, context);
    const classes = ['heatmap-cell', ...selection.classes, ...activity.classes];
    const attributes = [...selection.attributes, ...activity.attributes];
    if (selection.isSelectable) {
        classes.push('heatmap-cell-interactive');
        attributes.push('role="button"', 'tabindex="0"');
    }
    return `<div class="${classes.join(' ')}" ${attributes.join(' ')}>${MOAT_MARKUP}</div>`;
}

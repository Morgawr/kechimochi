import type { DailyHeatmap } from '../../../api';
import {
    getDayIntensity,
    getDaySelectionLabel,
    getHeatmapColor,
    getRegionOutlineEdges,
    isDateInRange,
    shouldOutlinePeriod,
    type HeatmapGridOrientation,
    type HeatmapSelection,
    type HeatmapSlot,
    type HeatmapTheme,
    type OutlineEdge,
} from './heatmap_layout';

export const IN_SELECTED_PERIOD_CLASS = 'is-in-selected-period';
export const MOAT_MARKUP = '<span class="heatmap-cell-moat" aria-hidden="true"></span>';

export interface HeatmapRenderContext {
    days: readonly DailyHeatmap[];
    activityByDate: Map<string, DailyHeatmap>;
    theme: HeatmapTheme;
    todayIso: string;
    selection: HeatmapSelection | null;
    weekStartDay: number;
}

export type SelectionOutline = Map<string, OutlineEdge[]>;

export interface CellMarkup {
    classes: string[];
    attributes: string[];
}

export interface SelectionCellMarkup extends CellMarkup {
    isSelectable: boolean;
}

export function getSelectionOutline(
    grid: HeatmapSlot[][],
    context: HeatmapRenderContext,
    orientation: HeatmapGridOrientation,
): SelectionOutline {
    const selection = context.selection;
    if (!selection || !shouldOutlinePeriod(selection.period)) return new Map();
    return getRegionOutlineEdges(grid, date => isDateInRange(date, selection), orientation);
}

export function buildSelectionMarkup(date: string, context: HeatmapRenderContext, outline: SelectionOutline): SelectionCellMarkup {
    const { selection } = context;
    const period = selection?.period ?? null;
    const classes: string[] = [];
    const attributes = [`data-date="${date}"`];

    if (selection && period !== 'all-time' && isDateInRange(date, selection)) classes.push(IN_SELECTED_PERIOD_CLASS);
    const edges = outline.get(date);
    if (edges) attributes.push(`data-selection-edges="${edges.join(' ')}"`);

    const isSelectable = period !== 'all-time' && date <= context.todayIso;
    if (isSelectable) attributes.push(`aria-label="${getDaySelectionLabel(date, period)}"`);
    return { classes, attributes, isSelectable };
}

export function buildActivityMarkup(date: string, context: HeatmapRenderContext): CellMarkup {
    const day = context.activityByDate.get(date);
    const minutes = day?.total_minutes ?? 0;
    const characters = day?.total_characters ?? 0;
    const characterText = characters > 0 ? `, ${characters.toLocaleString()} chars` : '';
    const markup: CellMarkup = { classes: [], attributes: [`title="${date}: ${minutes} mins${characterText}"`] };

    const intensity = getDayIntensity(minutes, characters);
    if (intensity !== null) {
        const color = getHeatmapColor(intensity, context.theme);
        markup.classes.push(`heatmap-text-${color.textTone}`);
        markup.attributes.push(`style="background-color: ${color.backgroundColor};"`);
    }
    return markup;
}

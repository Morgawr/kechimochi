import { ActivitySummary, Media } from '../api';

const DISPLAY_FRAME_MS = 1000 / 60;
const FRAMES_PER_CHART_RESIZE = 2;
export const CHART_RESIZE_DEBOUNCE_MS = Math.round(DISPLAY_FRAME_MS * FRAMES_PER_CHART_RESIZE);

export function getChartColors(): string[] {
    const style = getComputedStyle(document.body);
    return [
        style.getPropertyValue('--chart-1').trim(),
        style.getPropertyValue('--chart-2').trim(),
        style.getPropertyValue('--chart-3').trim(),
        style.getPropertyValue('--chart-4').trim(),
        style.getPropertyValue('--chart-5').trim()
    ];
}

export interface BarChartDataset {
    label: string;
    data: number[];
    backgroundColor: string;
    borderColor: string;
    fill: boolean | undefined;
    tension: number;
}

export interface ChartGroup {
    key: string;
    label: string;
}

export function getGroupForLog(
    log: ActivitySummary,
    mode: 'activity_type' | 'log_name',
    nameGroups?: Map<number, ChartGroup>,
): ChartGroup {
    if (mode === 'activity_type') {
        return { key: `activity:${log.activity_type}`, label: log.activity_type };
    }
    return nameGroups?.get(log.media_id) ?? {
        key: `media:${log.media_id}`,
        label: log.title,
    };
}

function buildLogNameGroups(
    logs: ActivitySummary[],
    isActive: (log: ActivitySummary) => boolean,
    mediaList: Media[] | undefined,
): Map<number, ChartGroup> {
    const mediaById = new Map(
        (mediaList ?? [])
            .filter((media): media is Media & { id: number } => media.id !== undefined)
            .map(media => [media.id, media]),
    );
    const activeMedia = new Map<number, { title: string; variant: string }>();

    for (const log of logs) {
        if (!isActive(log) || activeMedia.has(log.media_id)) continue;
        const media = mediaById.get(log.media_id);
        activeMedia.set(log.media_id, {
            title: media?.title ?? log.title,
            variant: media?.variant?.trim() ?? '',
        });
    }

    const titleCounts = new Map<string, number>();
    for (const { title } of activeMedia.values()) {
        titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }

    const groups = new Map<number, ChartGroup>();
    for (const [mediaId, media] of activeMedia) {
        const needsVariant = (titleCounts.get(media.title) ?? 0) > 1;
        groups.set(mediaId, {
            key: `media:${mediaId}`,
            label: needsVariant
                ? `${media.title} — ${media.variant || '(no variant)'}`
                : media.title,
        });
    }
    return groups;
}

export function getActiveGroups(
    logs: ActivitySummary[],
    isActive: (log: ActivitySummary) => boolean,
    mode: 'activity_type' | 'log_name',
    mediaList: Media[] | undefined,
): Map<string, string> {
    const groups = new Map<string, string>();
    const nameGroups = mode === 'log_name' ? buildLogNameGroups(logs, isActive, mediaList) : undefined;
    for (const log of logs) {
        if (isActive(log)) {
            const group = getGroupForLog(log, mode, nameGroups);
            groups.set(group.key, group.label);
        }
    }
    return groups;
}

export function toDatasets(
    datasetsMap: Map<string, number[]>,
    activeGroups: Map<string, string>,
    colors: string[],
    chartType: 'bar' | 'line',
    borderColor: string,
) {
    return Array.from(datasetsMap.entries())
        .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
        .map(([key, data], i) => ({
            label: activeGroups.get(key) ?? key,
            data: data,
            backgroundColor: colors[i % colors.length],
            borderColor: chartType === 'bar' ? borderColor : colors[i % colors.length],
            borderWidth: chartType === 'bar'
                ? { top: 0, right: 0, bottom: i === 0 ? 0 : 2, left: 0 }
                : undefined,
            borderSkipped: chartType === 'bar' ? false : undefined,
            fill: chartType === 'line' ? false : undefined,
            tension: 0.3
        }));
}

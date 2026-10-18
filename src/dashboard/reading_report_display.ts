import { READING_CONTENT_TYPES, type ReadingContentType } from '../stats/reading_speed';
import { toTimeParts } from '../time';

export const READING_REPORT_ANIMATION_MS = 300;

export function formatReadingReportDuration(totalMinutes: number): string {
    const { hours, minutes } = toTimeParts(totalMinutes);
    return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

export function rankReadingContentTypes(
    valueOf: (contentType: ReadingContentType) => number,
    speedOf: (contentType: ReadingContentType) => number,
): ReadingContentType[] {
    return READING_CONTENT_TYPES
        .filter(contentType => speedOf(contentType) > 0)
        .map((contentType, declarationIndex) => ({ contentType, declarationIndex, value: valueOf(contentType) }))
        .sort((left, right) => right.value - left.value || left.declarationIndex - right.declarationIndex)
        .map(entry => entry.contentType);
}

function easeOutCubic(progress: number): number {
    return 1 - (1 - progress) ** 3;
}

export function interpolateReadingReportValue(
    start: number,
    target: number,
    elapsedMs: number,
    durationMs: number = READING_REPORT_ANIMATION_MS,
): number {
    if (elapsedMs >= durationMs) return target;
    const progress = easeOutCubic(Math.max(0, elapsedMs) / durationMs);
    return start + (target - start) * progress;
}

export function isReadingReportMotionOff(): boolean {
    if (document.body.dataset.theme === 'eink') return true;
    if (typeof globalThis.matchMedia !== 'function') return false;
    return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

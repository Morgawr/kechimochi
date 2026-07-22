export type LibraryLayoutMode = 'grid' | 'list';

export const LIBRARY_GRID_ZOOM = {
    MIN: 70,
    MAX: 130,
    STEP: 10,
    DEFAULT: 100,
} as const;

export function normalizeLibraryGridZoom(value: unknown): number {
    if (value === null || value === undefined || value === '') {
        return LIBRARY_GRID_ZOOM.DEFAULT;
    }

    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return LIBRARY_GRID_ZOOM.DEFAULT;
    }

    const steppedValue = Math.round(numericValue / LIBRARY_GRID_ZOOM.STEP) * LIBRARY_GRID_ZOOM.STEP;
    return Math.min(LIBRARY_GRID_ZOOM.MAX, Math.max(LIBRARY_GRID_ZOOM.MIN, steppedValue));
}

export interface LibraryActivityMetrics {
    firstActivityDate: string | null;
    lastActivityDate: string | null;
    totalMinutes: number | null;
    totalCharacters: number | null;
}

export const GRID_LAYOUT_MEDIA_QUERY = '(min-width: 769px)';

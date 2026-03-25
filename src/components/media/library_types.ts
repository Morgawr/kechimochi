export type LibraryLayoutMode = 'grid' | 'list';

export interface LibraryActivityMetrics {
    firstActivityDate: string | null;
    lastActivityDate: string | null;
    totalMinutes: number;
}

export const GRID_LAYOUT_MEDIA_QUERY = '(min-width: 769px)';

import { DEFAULTS } from '../constants';

export const LIBRARY_STATUS_BORDER_MODES = ['hover', 'always'] as const;

export type LibraryStatusBorderMode = typeof LIBRARY_STATUS_BORDER_MODES[number];

export const LIBRARY_STATUS_DOT_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'contrast', label: 'Contrast' },
    { value: 'none', label: 'None' },
] as const;

export type LibraryStatusDotStyle = typeof LIBRARY_STATUS_DOT_OPTIONS[number]['value'];

export const LIBRARY_CONTENT_TYPE_TAG_OPTIONS = [
    { value: 'always', label: 'Always' },
    { value: 'hide-when-grouped', label: 'Hide when grouped by type' },
    { value: 'never', label: 'Never' },
] as const;

export type LibraryContentTypeTagMode = typeof LIBRARY_CONTENT_TYPE_TAG_OPTIONS[number]['value'];

export interface LibraryCardDisplaySettings {
    statusBorder: LibraryStatusBorderMode;
    statusDot: LibraryStatusDotStyle;
    contentTypeTag: LibraryContentTypeTagMode;
}

const DEFAULT_LIBRARY_STATUS_BORDER = DEFAULTS.LIBRARY_STATUS_BORDER satisfies LibraryStatusBorderMode;
const DEFAULT_LIBRARY_STATUS_DOT = DEFAULTS.LIBRARY_STATUS_DOT satisfies LibraryStatusDotStyle;
const DEFAULT_LIBRARY_CONTENT_TYPE_TAG = DEFAULTS.LIBRARY_CONTENT_TYPE_TAG satisfies LibraryContentTypeTagMode;

export function normalizeLibraryStatusBorderMode(value: string | null): LibraryStatusBorderMode {
    return LIBRARY_STATUS_BORDER_MODES.includes(value as LibraryStatusBorderMode)
        ? (value as LibraryStatusBorderMode)
        : DEFAULT_LIBRARY_STATUS_BORDER;
}

export function normalizeLibraryStatusDotStyle(value: string | null): LibraryStatusDotStyle {
    return LIBRARY_STATUS_DOT_OPTIONS.some(option => option.value === value)
        ? (value as LibraryStatusDotStyle)
        : DEFAULT_LIBRARY_STATUS_DOT;
}

export function normalizeLibraryContentTypeTagMode(value: string | null): LibraryContentTypeTagMode {
    return LIBRARY_CONTENT_TYPE_TAG_OPTIONS.some(option => option.value === value)
        ? (value as LibraryContentTypeTagMode)
        : DEFAULT_LIBRARY_CONTENT_TYPE_TAG;
}

export function applyLibraryCardDisplay({ statusBorder, statusDot, contentTypeTag }: LibraryCardDisplaySettings): void {
    document.body.dataset.libraryStatusBorder = statusBorder;
    document.body.dataset.libraryStatusDot = statusDot;
    document.body.dataset.libraryContentTypeTag = contentTypeTag;
}

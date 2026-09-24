/**
 * Formats a quantity alongside a pluralized unit noun: "1 char", "12,000 chars", "3 sessions".
 */
export function formatCount(value: number, singular: string): string {
    const label = value === 1 ? singular : `${singular}s`;
    return `${value.toLocaleString()} ${label}`;
}

/**
 * Same as {@link formatCount}, but renders nothing at zero so callers can drop the label entirely.
 */
export function formatOptionalCount(value: number, singular: string): string {
    return value > 0 ? formatCount(value, singular) : '';
}

/**
 * Groups a quantity without a unit noun, for callers whose surrounding copy already names it.
 * Renders nothing at zero.
 */
export function formatOptionalNumber(value: number): string {
    return value > 0 ? value.toLocaleString() : '';
}
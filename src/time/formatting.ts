const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/**
 * Represents time split into hours and minutes.
 */
export interface TimeParts {
    hours: number;
    minutes: number;
}

/**
 * Converts total minutes into hours and minutes.
 * @param totalMinutes The total number of minutes.
 * @returns An object containing hours and minutes.
 */
export function toTimeParts(totalMinutes: number): TimeParts {
    const roundedMinutes = Math.max(0, Math.round(totalMinutes));
    return {
        hours: Math.floor(roundedMinutes / MINUTES_PER_HOUR),
        minutes: roundedMinutes % MINUTES_PER_HOUR
    };
}

/**
 * Formats duration as compactly as possible, largest unit first and zero units omitted:
 * "1d 2h 30m", "2h", "45m". Zero renders as "0m".
 */
export function formatCompactDuration(totalMinutes: number): string {
    const roundedMinutes = Math.max(0, Math.round(totalMinutes));
    const days = Math.floor(roundedMinutes / MINUTES_PER_DAY);
    const hours = Math.floor((roundedMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
    const minutes = roundedMinutes % MINUTES_PER_HOUR;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
}

/**
 * Formats duration as "HhMmin" or "Mmin".
 * Used in Media Detail and Media Log.
 */
export function formatHhMm(totalMinutes: number): string {
    const { hours, minutes } = toTimeParts(totalMinutes);
    if (hours > 0) {
        return `${hours}h${minutes}min`;
    }
    return `${minutes}min`;
}

/**
 * Formats duration as "Hh Mm" or "Mm".
 * Used in Stats Card.
 */
export function formatStatsDuration(totalMinutes: number, skipZeroMinutes: boolean = false): string {
    const { hours, minutes } = toTimeParts(totalMinutes);
    if (hours > 0) {
        if (skipZeroMinutes && minutes === 0) return `${hours}h`;
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

/**
 * Formats duration for activity logs: "X minutes (HhMmin)" if >= 60, otherwise "X minutes".
 */
export function formatLoggedDuration(totalMinutes: number, capitalizeMinutes: boolean = false): string {
    const minLabel = capitalizeMinutes ? 'Minutes' : 'minutes';
    const minStr = `${totalMinutes} ${minLabel}`;
    if (totalMinutes >= MINUTES_PER_HOUR) {
        return `${minStr} (${formatHhMm(totalMinutes)})`;
    }
    return minStr;
}

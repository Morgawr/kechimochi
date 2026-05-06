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
    return {
        hours: Math.floor(totalMinutes / 60),
        minutes: Math.round(totalMinutes % 60)
    };
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
    if (totalMinutes >= 60) {
        return `${minStr} (${formatHhMm(totalMinutes)})`;
    }
    return minStr;
}

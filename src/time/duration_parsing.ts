type DurationUnit = 'd' | 'h' | 'm' | 's';

const SECONDS_PER_UNIT: Record<DurationUnit, number> = {
    d: 86400,
    h: 3600,
    m: 60,
    s: 1,
};

const BARE_MINUTES_PATTERN = /^\d+$/;
const UNIT_GROUP_PATTERN = /(\d{1,15})([dhms])/gi;
const WHITESPACE_PATTERN = /\s+/;

export const DURATION_INPUT_PLACEHOLDER = 'e.g. 90 or 1h30m';

export const DURATION_INPUT_TOOLTIP =
    'Plain numbers are parsed as minutes ("35" means 35 minutes).\n' +
    'Alternatively, combine with time units (e.g. "1d 2h 4m 55s").\n' +
    'A trailing number without a unit is minutes ("1h30" means 1 hour 30 minutes).\n' +
    'Seconds are rounded to the nearest minute.';

/**
 * The outcome of parsing a duration string. `tooLarge` is kept distinct from
 * `unrecognized` so the two can be reported to the user differently — a big number is not
 * a notation mistake.
 */
export type DurationParseResult =
    | { status: 'parsed'; minutes: number }
    | { status: 'unrecognized' }
    | { status: 'tooLarge' };

/**
 * Parses a free-form duration string into total minutes.
 * A bare number is minutes; otherwise the input is a run of `<digits><unit>` groups with a
 * `d`/`h`/`m`/`s` unit (case-insensitive, `min` is not accepted), optionally ending in a
 * bare number that is read as minutes — so "1h30" and "1h 30" both mean 90.
 */
export function parseDuration(rawInput: string): DurationParseResult {
    const trimmedInput = rawInput.trim();
    if (trimmedInput.length === 0) return { status: 'parsed', minutes: 0 };

    if (BARE_MINUTES_PATTERN.test(trimmedInput)) {
        const minutes = Number(trimmedInput);
        return Number.isSafeInteger(minutes) ? { status: 'parsed', minutes } : { status: 'tooLarge' };
    }

    const totalSeconds = sumChunkSeconds(trimmedInput.split(WHITESPACE_PATTERN));
    if (totalSeconds === null) return { status: 'unrecognized' };

    const totalMinutes = Math.round(totalSeconds / SECONDS_PER_UNIT.m);
    return Number.isSafeInteger(totalMinutes) ? { status: 'parsed', minutes: totalMinutes } : { status: 'tooLarge' };
}

interface DurationGroup {
    unit: DurationUnit;
    amount: number;
}

interface ChunkParse {
    groups: DurationGroup[];
    trailingMinutes: number | null;
}

/**
 * Totals every chunk's seconds, or returns `null` if the sequence is not a valid duration.
 * A unit may appear only once, and a bare number ends the input — nothing may follow it,
 * which is what keeps "1 2m" from silently reading as 12 minutes.
 */
function sumChunkSeconds(chunks: string[]): number | null {
    const seenUnits = new Set<DurationUnit>();
    let totalSeconds = 0;
    let isClosedByBareNumber = false;

    for (const chunk of chunks) {
        if (isClosedByBareNumber) return null;

        const parsedChunk = parseChunk(chunk);
        if (parsedChunk === null) return null;

        for (const { unit, amount } of parsedChunk.groups) {
            if (seenUnits.has(unit)) return null;
            seenUnits.add(unit);
            totalSeconds += amount * SECONDS_PER_UNIT[unit];
        }

        if (parsedChunk.trailingMinutes !== null) {
            if (seenUnits.has('m')) return null;
            seenUnits.add('m');
            totalSeconds += parsedChunk.trailingMinutes * SECONDS_PER_UNIT.m;
            isClosedByBareNumber = true;
        }
    }

    return totalSeconds;
}

/**
 * Splits a whitespace-free chunk into its `<digits><unit>` groups plus an optional trailing
 * unitless number, or returns `null` if anything else is left over. Contiguity is checked
 * explicitly so the pattern itself stays free of the nested quantifiers that invite runaway
 * backtracking.
 */
function parseChunk(chunk: string): ChunkParse | null {
    const groups: DurationGroup[] = [];
    let consumedLength = 0;

    for (const match of chunk.matchAll(UNIT_GROUP_PATTERN)) {
        if (match.index !== consumedLength) return null;
        consumedLength += match[0].length;
        groups.push({
            unit: match[2].toLowerCase() as DurationUnit,
            amount: Number(match[1])
        });
    }

    if (consumedLength === chunk.length) return { groups, trailingMinutes: null };

    const remainder = chunk.slice(consumedLength);
    if (!BARE_MINUTES_PATTERN.test(remainder)) return null;

    return { groups, trailingMinutes: Number(remainder) };
}

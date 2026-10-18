type DurationUnit = 'd' | 'h' | 'm' | 's';
type DurationToken = DurationUnit | typeof EPISODE_UNIT;

const SECONDS_PER_UNIT: Record<DurationUnit, number> = {
    d: 86400,
    h: 3600,
    m: 60,
    s: 1,
};

const EPISODE_UNIT = 'ep';
const BARE_MINUTES_PATTERN = /^\d+$/;
const UNIT_GROUP_PATTERN = /(\d{1,15})(ep|[dhms])/gi;
const WHITESPACE_PATTERN = /\s+/;

export const DURATION_INPUT_PLACEHOLDER = 'e.g. 1h30m';
export const EPISODE_DURATION_INPUT_PLACEHOLDER = 'e.g. 2ep 1h';

export const DURATION_INPUT_TOOLTIP =
    'Plain numbers are parsed as minutes ("35" means 35 minutes).\n' +
    'Alternatively, combine with time units (e.g. "1d 2h 4m 55s").\n' +
    'A trailing number without a unit is minutes ("1h30" means 1 hour 30 minutes).\n' +
    'Seconds are rounded to the nearest minute.';

export const EPISODE_DURATION_INPUT_TOOLTIP =
    `${DURATION_INPUT_TOOLTIP}\n` +
    'For anime, "ep" counts episodes ("3ep", or "2ep 6m" for a longer episode).';

/**
 * The outcome of parsing a duration string. `tooLarge` is kept distinct from
 * `unrecognized` so the two can be reported to the user differently — a big number is not
 * a notation mistake.
 */
export type DurationParseResult =
    | { status: 'parsed'; minutes: number; episodeCount: number }
    | { status: 'unrecognized' }
    | { status: 'tooLarge' }
    | { status: 'episodeDurationUnknown' };

/**
 * Parses a free-form duration string into total minutes.
 * A bare number is minutes; otherwise the input is a run of `<digits><unit>` groups with a
 * `d`/`h`/`m`/`s` unit (case-insensitive, `min` is not accepted), optionally ending in a
 * bare number that is read as minutes — so "1h30" and "1h 30" both mean 90.
 */
export function parseDuration(rawInput: string, episodeDurationMinutes: number | null = null): DurationParseResult {
    const trimmedInput = rawInput.trim();
    if (trimmedInput.length === 0) return { status: 'parsed', minutes: 0, episodeCount: 0 };

    if (BARE_MINUTES_PATTERN.test(trimmedInput)) {
        const minutes = Number(trimmedInput);
        return Number.isSafeInteger(minutes) ? { status: 'parsed', minutes, episodeCount: 0 } : { status: 'tooLarge' };
    }

    const chunkTotals = sumChunks(trimmedInput.split(WHITESPACE_PATTERN));
    if (chunkTotals === null) return { status: 'unrecognized' };

    const { totalSeconds, episodeCount } = chunkTotals;
    if (episodeCount !== null && episodeDurationMinutes === null) return { status: 'episodeDurationUnknown' };

    const episodeMinutes = episodeCount === null || episodeDurationMinutes === null ? 0 : episodeCount * episodeDurationMinutes;
    const totalMinutes = episodeMinutes + Math.round(totalSeconds / SECONDS_PER_UNIT.m);
    return Number.isSafeInteger(totalMinutes)
        ? { status: 'parsed', minutes: totalMinutes, episodeCount: episodeCount ?? 0 }
        : { status: 'tooLarge' };
}

export function withEpisodeCount(rawInput: string, episodeCount: number): string {
    const remainingChunks = rawInput.trim().split(WHITESPACE_PATTERN)
        .map(removeEpisodeGroup)
        .filter(chunk => chunk.length > 0);

    const episodeChunks = episodeCount > 0 ? [`${episodeCount}${EPISODE_UNIT}`] : [];
    return [...episodeChunks, ...remainingChunks].join(' ');
}

function removeEpisodeGroup(chunk: string): string {
    let rewrittenChunk = '';
    let consumedLength = 0;

    for (const match of chunk.matchAll(UNIT_GROUP_PATTERN)) {
        if (match.index !== consumedLength) break;
        consumedLength += match[0].length;
        if (match[2].toLowerCase() !== EPISODE_UNIT) rewrittenChunk += match[0];
    }

    const remainder = chunk.slice(consumedLength);
    if (!BARE_MINUTES_PATTERN.test(remainder)) return `${rewrittenChunk}${remainder}`;
    return Number(remainder) === 0 ? rewrittenChunk : `${rewrittenChunk}${remainder}m`;
}

interface DurationGroup {
    unit: DurationToken;
    amount: number;
}

interface ChunkParse {
    groups: DurationGroup[];
    trailingMinutes: number | null;
}

interface ChunkTotals {
    totalSeconds: number;
    episodeCount: number | null;
}

/**
 * Totals every chunk's seconds, or returns `null` if the sequence is not a valid duration.
 * A unit may appear only once, and a bare number ends the input — nothing may follow it,
 * which is what keeps "1 2m" from silently reading as 12 minutes.
 */
function sumChunks(chunks: string[]): ChunkTotals | null {
    const seenUnits = new Set<DurationToken>();
    const totals: ChunkTotals = { totalSeconds: 0, episodeCount: null };
    let isClosedByBareNumber = false;

    for (const chunk of chunks) {
        if (isClosedByBareNumber) return null;

        const parsedChunk = parseChunk(chunk);
        if (parsedChunk === null) return null;

        const trailingGroups: DurationGroup[] = parsedChunk.trailingMinutes === null
            ? []
            : [{ unit: 'm', amount: parsedChunk.trailingMinutes }];
        for (const group of [...parsedChunk.groups, ...trailingGroups]) {
            if (!addGroupToTotals(totals, seenUnits, group)) return null;
        }

        isClosedByBareNumber = parsedChunk.trailingMinutes !== null;
    }

    return totals;
}

function addGroupToTotals(totals: ChunkTotals, seenUnits: Set<DurationToken>, { unit, amount }: DurationGroup): boolean {
    if (seenUnits.has(unit)) return false;
    seenUnits.add(unit);

    if (unit === EPISODE_UNIT) {
        totals.episodeCount = amount;
    } else {
        totals.totalSeconds += amount * SECONDS_PER_UNIT[unit];
    }
    return true;
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
            unit: match[2].toLowerCase() as DurationToken,
            amount: Number(match[1])
        });
    }

    if (consumedLength === chunk.length) return { groups, trailingMinutes: null };

    const remainder = chunk.slice(consumedLength);
    if (!BARE_MINUTES_PATTERN.test(remainder)) return null;

    return { groups, trailingMinutes: Number(remainder) };
}

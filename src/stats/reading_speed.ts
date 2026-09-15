import type { ActivitySummary, Media } from '../types';
import { getCharacterCountFromExtraData, getReadingSpeedFromExtraData } from '../extra_data';
import { SETTING_KEYS } from '../constants';

export const READING_CONTENT_TYPES = ['Novel', 'WebNovel', 'NonFiction', 'Visual Novel', 'Manga'] as const;
export type ReadingContentType = typeof READING_CONTENT_TYPES[number];

export type ReadingSpeedSettingKey =
    | typeof SETTING_KEYS.STATS_NOVEL_SPEED
    | typeof SETTING_KEYS.STATS_WEBNOVEL_SPEED
    | typeof SETTING_KEYS.STATS_NONFICTION_SPEED
    | typeof SETTING_KEYS.STATS_MANGA_SPEED
    | typeof SETTING_KEYS.STATS_VN_SPEED;

export const READING_SPEED_SETTING_KEY_BY_CONTENT_TYPE: Record<ReadingContentType, ReadingSpeedSettingKey> = {
    'Novel': SETTING_KEYS.STATS_NOVEL_SPEED,
    'WebNovel': SETTING_KEYS.STATS_WEBNOVEL_SPEED,
    'NonFiction': SETTING_KEYS.STATS_NONFICTION_SPEED,
    'Manga': SETTING_KEYS.STATS_MANGA_SPEED,
    'Visual Novel': SETTING_KEYS.STATS_VN_SPEED,
};

export type ReadingSpeedSource = 'manualOverride' | 'completedAnchor' | 'workSessions' | 'typeEstimate';
export type SessionEvidence = 'dual' | 'timeOnly' | 'charactersOnly' | 'empty';

export interface MediaReadingSpeedEstimate {
    charactersPerHour: number | null;
    source: ReadingSpeedSource | null;
    completionPercent: number | null;
    remainingMinutes: number | null;
    estimatedTotalMinutes: number | null;
    observedCharacters: number;
    immersionMinutes: number;
}

export interface TypeReadingSpeed {
    charactersPerHour: number;
    hours: number;
}

interface ClassifiedSession {
    log: ActivitySummary;
    evidence: SessionEvidence;
}

interface MediaSpeedInputs {
    sessions: ClassifiedSession[];
    observedCharacters: number;
    immersionMinutes: number;
    workSpeed: number | null;
    metadataTotal: number | null;
    anchorSpeed: number | null;
    overrideSpeed: number | null;
}

export function isReadingContentType(contentType: string): contentType is ReadingContentType {
    return (READING_CONTENT_TYPES as readonly string[]).includes(contentType);
}

export function isEstimatableImmersionSession(resolvedActivityType: string, contentType: string): boolean {
    if (resolvedActivityType === 'Reading') return true;
    return resolvedActivityType === 'Playing' && contentType === 'Visual Novel';
}

export function classifySessionEvidence(session: { duration_minutes: number; characters: number }): SessionEvidence {
    const hasDuration = session.duration_minutes > 0;
    const hasCharacters = session.characters > 0;
    if (hasDuration && hasCharacters) return 'dual';
    if (hasDuration) return 'timeOnly';
    if (hasCharacters) return 'charactersOnly';
    return 'empty';
}

function collectImmersionSessions(media: Media, logs: ActivitySummary[]): ClassifiedSession[] {
    return logs
        .filter(log => isEstimatableImmersionSession(log.activity_type || media.default_activity_type, media.content_type))
        .map(log => ({ log, evidence: classifySessionEvidence(log) }));
}

function parseExtraData(media: Media): Record<string, string> {
    try {
        return JSON.parse(media.extra_data || '{}');
    } catch {
        return {};
    }
}

function readMetadataTotal(extraData: Record<string, string>): number | null {
    const parsedTotal = getCharacterCountFromExtraData(extraData);
    return parsedTotal !== null && parsedTotal > 0 ? parsedTotal : null;
}

function computeMediaSpeedInputs(media: Media, sessions: ClassifiedSession[]): MediaSpeedInputs {
    let observedCharacters = 0;
    let immersionMinutes = 0;
    let dualCharacters = 0;
    let dualHours = 0;

    for (const { log, evidence } of sessions) {
        if (log.characters > 0) observedCharacters += log.characters;
        if (log.duration_minutes > 0) immersionMinutes += log.duration_minutes;
        if (evidence === 'dual') {
            dualCharacters += log.characters;
            dualHours += log.duration_minutes / 60;
        }
    }

    const extraData = parseExtraData(media);
    const workSpeed = dualHours > 0 ? dualCharacters / dualHours : null;
    const metadataTotal = readMetadataTotal(extraData);
    const hasUntimedReading = sessions.some(session => session.evidence === 'charactersOnly');
    const anchorSpeed = media.tracking_status === 'Complete' && metadataTotal !== null
        && immersionMinutes > 0 && !hasUntimedReading
        ? metadataTotal / (immersionMinutes / 60)
        : null;

    return {
        sessions,
        observedCharacters,
        immersionMinutes,
        workSpeed,
        metadataTotal,
        anchorSpeed,
        overrideSpeed: getReadingSpeedFromExtraData(extraData),
    };
}

function selectReadingSpeedSource(
    inputs: MediaSpeedInputs,
    cachedTypeSpeed: number | null,
): { source: ReadingSpeedSource | null; charactersPerHour: number | null } {
    const hasImmersionEvidence = inputs.sessions.some(session => session.evidence !== 'empty');
    if (!hasImmersionEvidence) return { source: null, charactersPerHour: null };
    if (inputs.overrideSpeed !== null) return { source: 'manualOverride', charactersPerHour: inputs.overrideSpeed };
    if (inputs.anchorSpeed !== null) return { source: 'completedAnchor', charactersPerHour: inputs.anchorSpeed };
    if (inputs.workSpeed !== null) return { source: 'workSessions', charactersPerHour: inputs.workSpeed };
    if (cachedTypeSpeed !== null && cachedTypeSpeed > 0) return { source: 'typeEstimate', charactersPerHour: cachedTypeSpeed };
    return { source: null, charactersPerHour: null };
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

export function estimateMediaReadingSpeed(
    media: Media,
    logs: ActivitySummary[],
    cachedTypeSpeed: number | null,
): MediaReadingSpeedEstimate {
    const sessions = collectImmersionSessions(media, logs);
    const inputs = computeMediaSpeedInputs(media, sessions);
    const { source, charactersPerHour } = selectReadingSpeedSource(inputs, cachedTypeSpeed);

    const withoutProgress = (): MediaReadingSpeedEstimate => ({
        charactersPerHour,
        source,
        completionPercent: null,
        remainingMinutes: null,
        estimatedTotalMinutes: null,
        observedCharacters: inputs.observedCharacters,
        immersionMinutes: inputs.immersionMinutes,
    });

    const hasImmersionEvidence = inputs.sessions.some(session => session.evidence !== 'empty');
    if (!hasImmersionEvidence) return withoutProgress();
    if (media.tracking_status === 'Complete') return withoutProgress();
    if (inputs.metadataTotal === null) return withoutProgress();

    const characterCompletion = clampPercent((inputs.observedCharacters / inputs.metadataTotal) * 100);
    if (charactersPerHour === null) {
        const hasTimeOnlySession = inputs.sessions.some(session => session.evidence === 'timeOnly');
        return hasTimeOnlySession
            ? withoutProgress()
            : { ...withoutProgress(), completionPercent: characterCompletion };
    }

    const timeBasedTotalMinutes = (inputs.metadataTotal / charactersPerHour) * 60;
    const timeCompletion = timeBasedTotalMinutes > 0
        ? clampPercent((inputs.immersionMinutes / timeBasedTotalMinutes) * 100)
        : 0;

    const remainingMinutes = characterCompletion >= timeCompletion
        ? Math.max(0, ((inputs.metadataTotal - inputs.observedCharacters) / charactersPerHour) * 60)
        : Math.max(0, timeBasedTotalMinutes - inputs.immersionMinutes);

    return {
        charactersPerHour,
        source,
        completionPercent: Math.max(characterCompletion, timeCompletion),
        remainingMinutes,
        estimatedTotalMinutes: inputs.immersionMinutes + remainingMinutes,
        observedCharacters: inputs.observedCharacters,
        immersionMinutes: inputs.immersionMinutes,
    };
}

function groupLogsByMediaId(logs: ActivitySummary[]): Map<number, ActivitySummary[]> {
    const logsByMediaId = new Map<number, ActivitySummary[]>();
    for (const log of logs) {
        const mediaLogs = logsByMediaId.get(log.media_id);
        if (mediaLogs) mediaLogs.push(log);
        else logsByMediaId.set(log.media_id, [log]);
    }
    return logsByMediaId;
}

function hasEvidenceSince(sessions: ClassifiedSession[], cutoffDate: string): boolean {
    return sessions.some(session => session.evidence !== 'empty' && session.log.date >= cutoffDate);
}

function overrideContribution(inputs: MediaSpeedInputs, cutoffDate: string): { characters: number; hours: number } {
    const overrideSpeed = inputs.overrideSpeed!;
    let hours = 0;
    for (const session of inputs.sessions) {
        if (session.log.date < cutoffDate) continue;
        if (session.log.duration_minutes > 0) hours += session.log.duration_minutes / 60;
        // A characters-only session has no time to weight by, so the override itself says how long it took.
        else if (session.evidence === 'charactersOnly') hours += session.log.characters / overrideSpeed;
    }
    return { characters: overrideSpeed * hours, hours };
}

function poolContribution(inputs: MediaSpeedInputs, cutoffDate: string): { characters: number; hours: number } {
    const { source } = selectReadingSpeedSource(inputs, null);

    if (source === 'manualOverride') return overrideContribution(inputs, cutoffDate);

    if (source === 'completedAnchor') {
        return hasEvidenceSince(inputs.sessions, cutoffDate)
            ? { characters: inputs.metadataTotal ?? 0, hours: inputs.immersionMinutes / 60 }
            : { characters: 0, hours: 0 };
    }

    if (source !== 'workSessions') return { characters: 0, hours: 0 };

    let characters = 0;
    let hours = 0;
    for (const session of inputs.sessions) {
        if (session.evidence !== 'dual' || session.log.date < cutoffDate) continue;
        characters += session.log.characters;
        hours += session.log.duration_minutes / 60;
    }
    return { characters, hours };
}

export function calculateTypeReadingSpeeds(
    logs: ActivitySummary[],
    mediaList: Media[],
    cutoffDate: string,
): Record<ReadingContentType, TypeReadingSpeed> {
    const totals = new Map<ReadingContentType, { characters: number; hours: number }>(
        READING_CONTENT_TYPES.map(contentType => [contentType, { characters: 0, hours: 0 }]),
    );
    const logsByMediaId = groupLogsByMediaId(logs);

    for (const media of mediaList) {
        if (media.id === undefined || !isReadingContentType(media.content_type)) continue;

        const sessions = collectImmersionSessions(media, logsByMediaId.get(media.id) ?? []);
        if (sessions.length === 0) continue;

        const contribution = poolContribution(computeMediaSpeedInputs(media, sessions), cutoffDate);
        const bucket = totals.get(media.content_type)!;
        bucket.characters += contribution.characters;
        bucket.hours += contribution.hours;
    }

    const result = {} as Record<ReadingContentType, TypeReadingSpeed>;
    for (const contentType of READING_CONTENT_TYPES) {
        const bucket = totals.get(contentType)!;
        result[contentType] = {
            charactersPerHour: bucket.hours > 0 ? bucket.characters / bucket.hours : 0,
            hours: bucket.hours,
        };
    }
    return result;
}

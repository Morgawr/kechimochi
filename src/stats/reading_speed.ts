import type { ActivitySummary, Media } from '../types';
import { getCharacterCountFromExtraData, getReadingSpeedFromExtraData } from '../extra_data';
import { SETTING_KEYS } from '../constants';
import { effectiveEnd, formatUtcIsoDate, type DateScope } from '../time';

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

export type ReadingMinutesSettingKey =
    | typeof SETTING_KEYS.STATS_NOVEL_MINUTES
    | typeof SETTING_KEYS.STATS_WEBNOVEL_MINUTES
    | typeof SETTING_KEYS.STATS_NONFICTION_MINUTES
    | typeof SETTING_KEYS.STATS_MANGA_MINUTES
    | typeof SETTING_KEYS.STATS_VN_MINUTES;

export const READING_MINUTES_SETTING_KEY_BY_CONTENT_TYPE: Record<ReadingContentType, ReadingMinutesSettingKey> = {
    'Novel': SETTING_KEYS.STATS_NOVEL_MINUTES,
    'WebNovel': SETTING_KEYS.STATS_WEBNOVEL_MINUTES,
    'NonFiction': SETTING_KEYS.STATS_NONFICTION_MINUTES,
    'Manga': SETTING_KEYS.STATS_MANGA_MINUTES,
    'Visual Novel': SETTING_KEYS.STATS_VN_MINUTES,
};

export type ReadingReportMetric = 'speed' | 'time';
export const DEFAULT_READING_REPORT_METRIC: ReadingReportMetric = 'speed';

export function parseReadingReportMetric(value: string | undefined): ReadingReportMetric {
    return value === 'time' ? 'time' : DEFAULT_READING_REPORT_METRIC;
}

export const READING_REPORT_CACHE_SETTING_KEYS: readonly string[] = [
    ...READING_CONTENT_TYPES.map(contentType => READING_SPEED_SETTING_KEY_BY_CONTENT_TYPE[contentType]),
    ...READING_CONTENT_TYPES.map(contentType => READING_MINUTES_SETTING_KEY_BY_CONTENT_TYPE[contentType]),
    SETTING_KEYS.DASHBOARD_READING_REPORT_METRIC,
];

export interface ReadingReportWindow {
    cutoff: string;
    today: string;
}

export function readingReportWindow(now: Date): ReadingReportWindow {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    return {
        cutoff: formatUtcIsoDate(cutoff.getFullYear(), cutoff.getMonth() + 1, cutoff.getDate()),
        today: formatUtcIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    };
}

export function isInReadingReportWindow(
    log: { date: string; date_precision: DateScope },
    window: ReadingReportWindow,
): boolean {
    return log.date_precision !== 'year'
        && log.date >= window.cutoff
        && effectiveEnd(log) <= window.today;
}

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

function parseExtraData(extraData: string): Record<string, string> {
    try {
        return JSON.parse(extraData || '{}');
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

    const extraData = parseExtraData(media.extra_data);
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

export interface MediaReadingAggregate {
    mediaId: number;
    contentType: string;
    trackingStatus: string;
    extraData: string;
    immersionMinutes: number;
    hasDual: boolean;
    hasCharactersOnly: boolean;
    windowDualCharacters: number;
    windowDualMinutes: number;
    windowTimedMinutes: number;
    windowCharactersOnlyCharacters: number;
}

export function summarizeMediaReading(
    media: Media,
    logs: ActivitySummary[],
    window: ReadingReportWindow,
): MediaReadingAggregate | null {
    const sessions = collectImmersionSessions(media, logs);
    const windowSessions = sessions.filter(session => isInReadingReportWindow(session.log, window));
    if (!windowSessions.some(session => session.evidence !== 'empty')) return null;

    const isTimed = (session: ClassifiedSession) => session.log.duration_minutes > 0;
    const isDual = (session: ClassifiedSession) => session.evidence === 'dual';
    const isCharactersOnly = (session: ClassifiedSession) => session.evidence === 'charactersOnly';

    return {
        mediaId: media.id!,
        contentType: media.content_type,
        trackingStatus: media.tracking_status || 'Untracked',
        extraData: media.extra_data || '{}',
        immersionMinutes: sumSessions(sessions, isTimed, log => log.duration_minutes),
        hasDual: sessions.some(isDual),
        hasCharactersOnly: sessions.some(isCharactersOnly),
        windowDualCharacters: sumSessions(windowSessions, isDual, log => log.characters),
        windowDualMinutes: sumSessions(windowSessions, isDual, log => log.duration_minutes),
        windowTimedMinutes: sumSessions(windowSessions, isTimed, log => log.duration_minutes),
        windowCharactersOnlyCharacters: sumSessions(windowSessions, isCharactersOnly, log => log.characters),
    };
}

function sumSessions(
    sessions: ClassifiedSession[],
    include: (session: ClassifiedSession) => boolean,
    valueOf: (log: ActivitySummary) => number,
): number {
    return sessions.reduce((total, session) => (include(session) ? total + valueOf(session.log) : total), 0);
}

function poolContributionFromAggregate(aggregate: MediaReadingAggregate): { characters: number; hours: number } {
    const extraData = parseExtraData(aggregate.extraData);
    const overrideSpeed = getReadingSpeedFromExtraData(extraData);
    if (overrideSpeed !== null) {
        const hours = aggregate.windowTimedMinutes / 60 + aggregate.windowCharactersOnlyCharacters / overrideSpeed;
        return { characters: overrideSpeed * hours, hours };
    }

    const metadataTotal = readMetadataTotal(extraData);
    const isCompletedAnchor = aggregate.trackingStatus === 'Complete'
        && metadataTotal !== null
        && aggregate.immersionMinutes > 0
        && !aggregate.hasCharactersOnly;
    if (isCompletedAnchor) {
        return { characters: metadataTotal, hours: aggregate.immersionMinutes / 60 };
    }

    if (aggregate.hasDual) {
        return { characters: aggregate.windowDualCharacters, hours: aggregate.windowDualMinutes / 60 };
    }

    return { characters: 0, hours: 0 };
}

export function poolTypeReadingSpeeds(
    aggregates: MediaReadingAggregate[],
): Record<ReadingContentType, TypeReadingSpeed> {
    const totals = new Map<ReadingContentType, { characters: number; hours: number }>(
        READING_CONTENT_TYPES.map(contentType => [contentType, { characters: 0, hours: 0 }]),
    );

    for (const aggregate of aggregates) {
        if (!isReadingContentType(aggregate.contentType)) continue;
        const contribution = poolContributionFromAggregate(aggregate);
        const bucket = totals.get(aggregate.contentType)!;
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

export function calculateTypeReadingSpeeds(
    logs: ActivitySummary[],
    mediaList: Media[],
    window: ReadingReportWindow,
): Record<ReadingContentType, TypeReadingSpeed> {
    const logsByMediaId = groupLogsByMediaId(logs);
    const aggregates: MediaReadingAggregate[] = [];

    for (const media of mediaList) {
        if (media.id === undefined || !isReadingContentType(media.content_type)) continue;
        const aggregate = summarizeMediaReading(media, logsByMediaId.get(media.id) ?? [], window);
        if (aggregate) aggregates.push(aggregate);
    }

    return poolTypeReadingSpeeds(aggregates);
}

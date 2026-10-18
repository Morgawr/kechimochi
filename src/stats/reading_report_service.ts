import { Logger } from '../logger';
import { EVENTS } from '../constants';
import { getReadingReportInputs, saveLocalSettingValues } from '../api';
import type { MediaReadingAggregateDto, ReadingReportInputsRequest, ReadingReportInputsResponse, SaveLocalSettingValuesRequest } from '../types';
import {
    poolTypeReadingSpeeds,
    READING_CONTENT_TYPES,
    READING_MINUTES_SETTING_KEY_BY_CONTENT_TYPE,
    READING_SPEED_SETTING_KEY_BY_CONTENT_TYPE,
    readingReportWindow,
    type MediaReadingAggregate,
    type ReadingContentType,
} from './reading_speed';

export interface ReadingReportResult {
    speeds: Record<ReadingContentType, number>;
    minutes: Record<ReadingContentType, number>;
}

export interface ReadingReportStamp {
    day: string;
    totalLogs: number;
    totalMinutes: number;
    totalCharacters: number;
    totalMedia: number;
}

function stampsEqual(left: ReadingReportStamp, right: ReadingReportStamp): boolean {
    return left.day === right.day
        && left.totalLogs === right.totalLogs
        && left.totalMinutes === right.totalMinutes
        && left.totalCharacters === right.totalCharacters
        && left.totalMedia === right.totalMedia;
}

export function needsReadingReportRecompute(
    previous: ReadingReportStamp | null,
    current: ReadingReportStamp,
    invalidated: boolean,
): boolean {
    return previous === null || !stampsEqual(previous, current) || invalidated;
}

export type ReadingReportListener = (result: ReadingReportResult) => void;

export interface ReadingReportServiceDependencies {
    fetchInputs: (request: ReadingReportInputsRequest) => Promise<ReadingReportInputsResponse>;
    saveValues: (request: SaveLocalSettingValuesRequest) => Promise<void>;
    now: () => Date;
}

function toMediaReadingAggregate(dto: MediaReadingAggregateDto): MediaReadingAggregate {
    return {
        mediaId: dto.media_id,
        contentType: dto.content_type,
        trackingStatus: dto.tracking_status,
        extraData: dto.extra_data,
        immersionMinutes: dto.immersion_minutes,
        hasDual: dto.has_dual,
        hasCharactersOnly: dto.has_characters_only,
        windowDualCharacters: dto.window_dual_characters,
        windowDualMinutes: dto.window_dual_minutes,
        windowTimedMinutes: dto.window_timed_minutes,
        windowCharactersOnlyCharacters: dto.window_characters_only_characters,
    };
}

function parseCachedInteger(value: string | undefined): number {
    const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export class ReadingReportService {
    private readonly dependencies: ReadingReportServiceDependencies;
    private readonly listeners = new Set<ReadingReportListener>();
    private lastStamp: ReadingReportStamp | null = null;
    private lastResult: ReadingReportResult | null = null;
    private invalidationRevision = 0;
    private stampedInvalidationRevision = 0;
    private inFlight: { stamp: ReadingReportStamp; invalidationRevision: number } | null = null;
    private queuedStamp: ReadingReportStamp | null = null;

    constructor(dependencies: ReadingReportServiceDependencies) {
        this.dependencies = dependencies;
    }

    subscribe(listener: ReadingReportListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getLastResult(): ReadingReportResult | null {
        return this.lastResult;
    }

    hydrateFromCache(cache: Record<string, string>): void {
        if (this.lastResult !== null) return;
        const speeds = {} as Record<ReadingContentType, number>;
        const minutes = {} as Record<ReadingContentType, number>;
        for (const contentType of READING_CONTENT_TYPES) {
            speeds[contentType] = parseCachedInteger(cache[READING_SPEED_SETTING_KEY_BY_CONTENT_TYPE[contentType]]);
            minutes[contentType] = parseCachedInteger(cache[READING_MINUTES_SETTING_KEY_BY_CONTENT_TYPE[contentType]]);
        }
        this.lastResult = { speeds, minutes };
    }

    markInvalidated(): void {
        this.invalidationRevision++;
    }

    checkAndRecompute(stamp: ReadingReportStamp): void {
        if (this.inFlight) {
            const invalidatedSinceIssue = this.invalidationRevision !== this.inFlight.invalidationRevision;
            if (invalidatedSinceIssue || !stampsEqual(this.inFlight.stamp, stamp)) this.queuedStamp = stamp;
            return;
        }
        const invalidated = this.invalidationRevision !== this.stampedInvalidationRevision;
        if (!needsReadingReportRecompute(this.lastStamp, stamp, invalidated)) return;
        this.runRecompute(stamp);
    }

    private runRecompute(stamp: ReadingReportStamp): void {
        const invalidationRevision = this.invalidationRevision;
        this.inFlight = { stamp, invalidationRevision };
        this.performRecompute(stamp, invalidationRevision)
            .finally(() => {
                this.inFlight = null;
                const next = this.queuedStamp;
                this.queuedStamp = null;
                if (next) this.checkAndRecompute(next);
            })
            .catch(error => Logger.error('[reading-report] recompute failed:', error));
    }

    private async performRecompute(stamp: ReadingReportStamp, invalidationRevision: number): Promise<void> {
        const window = readingReportWindow(this.dependencies.now());

        let response: ReadingReportInputsResponse;
        try {
            response = await this.dependencies.fetchInputs({
                cutoff: window.cutoff,
                today: window.today,
                content_types: [...READING_CONTENT_TYPES],
            });
        } catch (error) {
            Logger.error('[reading-report] failed to fetch report inputs:', error);
            return;
        }

        const pooled = poolTypeReadingSpeeds(response.aggregates.map(toMediaReadingAggregate));
        const result: ReadingReportResult = { speeds: {} as Record<ReadingContentType, number>, minutes: {} as Record<ReadingContentType, number> };
        const values: Record<string, string> = {};
        for (const contentType of READING_CONTENT_TYPES) {
            const speed = Math.round(pooled[contentType].charactersPerHour);
            const minutes = Math.round(pooled[contentType].hours * 60);
            result.speeds[contentType] = speed;
            result.minutes[contentType] = minutes;
            values[READING_SPEED_SETTING_KEY_BY_CONTENT_TYPE[contentType]] = speed.toString();
            values[READING_MINUTES_SETTING_KEY_BY_CONTENT_TYPE[contentType]] = minutes.toString();
        }

        try {
            await this.dependencies.saveValues({ values });
        } catch (error) {
            Logger.error('[reading-report] failed to save report values:', error);
            return;
        }

        this.lastResult = result;
        this.lastStamp = stamp;
        this.stampedInvalidationRevision = invalidationRevision;
        for (const listener of this.listeners) {
            try {
                listener(result);
            } catch (error) {
                Logger.error('[reading-report] listener failed:', error);
            }
        }
    }
}

let singleton: ReadingReportService | null = null;

export function getReadingReportService(): ReadingReportService {
    if (singleton) return singleton;

    singleton = new ReadingReportService({
        fetchInputs: getReadingReportInputs,
        saveValues: saveLocalSettingValues,
        now: () => new Date(),
    });

    globalThis.addEventListener(EVENTS.LOCAL_DATA_CHANGED, () => singleton?.markInvalidated());

    return singleton;
}

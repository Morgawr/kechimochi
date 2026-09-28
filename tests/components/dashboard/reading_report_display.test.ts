import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    interpolateReadingReportValue,
    isReadingReportMotionOff,
    rankReadingContentTypes,
    READING_REPORT_ANIMATION_MS,
} from '../../../src/dashboard/reading_report_display';
import { READING_CONTENT_TYPES } from '../../../src/stats/reading_speed';

describe('interpolateReadingReportValue', () => {
    it('returns the start value at elapsed 0', () => {
        expect(interpolateReadingReportValue(1000, 2000, 0)).toBe(1000);
    });

    it('returns a value strictly between start and target partway through', () => {
        const value = interpolateReadingReportValue(1000, 2000, READING_REPORT_ANIMATION_MS / 2);
        expect(value).toBeGreaterThan(1000);
        expect(value).toBeLessThan(2000);
    });

    it('returns exactly the target once elapsed reaches the duration', () => {
        expect(interpolateReadingReportValue(1000, 2000, READING_REPORT_ANIMATION_MS)).toBe(2000);
    });

    it('returns exactly the target for elapsed past the duration, never overshooting', () => {
        expect(interpolateReadingReportValue(1000, 2000, READING_REPORT_ANIMATION_MS * 10)).toBe(2000);
    });

    it('respects a custom duration', () => {
        expect(interpolateReadingReportValue(0, 100, 50, 100)).toBeGreaterThan(0);
        expect(interpolateReadingReportValue(0, 100, 100, 100)).toBe(100);
    });
});

describe('rankReadingContentTypes', () => {
    it('ranks by the active metric, highest first', () => {
        const values: Record<string, number> = { Novel: 5000, Manga: 9000, WebNovel: 1000, NonFiction: 0, 'Visual Novel': 0 };
        const order = rankReadingContentTypes(
            contentType => values[contentType],
            contentType => values[contentType],
        );
        expect(order).toEqual(['Manga', 'Novel', 'WebNovel']);
    });

    it('excludes a content type whose speed is zero or negative, even if its active-metric value is positive', () => {
        const speeds: Record<string, number> = { Novel: 0, Manga: 5000 };
        const activeValues: Record<string, number> = { Novel: 999999, Manga: 30 };
        const order = rankReadingContentTypes(
            contentType => activeValues[contentType] ?? 0,
            contentType => speeds[contentType] ?? 0,
        );
        expect(order).toEqual(['Manga']);
    });

    it('breaks a tie in the active metric using READING_CONTENT_TYPES declaration order', () => {
        const tiedValue = 4000;
        const order = rankReadingContentTypes(() => tiedValue, () => tiedValue);
        expect(order).toEqual([...READING_CONTENT_TYPES]);
    });
});

describe('isReadingReportMotionOff', () => {
    afterEach(() => {
        document.body.dataset.theme = '';
        vi.unstubAllGlobals();
    });

    it('is true for the E-Ink theme', () => {
        document.body.dataset.theme = 'eink';
        expect(isReadingReportMotionOff()).toBe(true);
    });

    it('is true when the OS requests reduced motion', () => {
        document.body.dataset.theme = 'dark';
        vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduced-motion') } as MediaQueryList)));
        expect(isReadingReportMotionOff()).toBe(true);
    });

    it('is false for a normal theme with no reduced-motion preference', () => {
        document.body.dataset.theme = 'dark';
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false } as MediaQueryList)));
        expect(isReadingReportMotionOff()).toBe(false);
    });
});

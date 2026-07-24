import { describe, it, expect } from 'vitest';
import * as time from '../../src/time';

describe('time.ts', () => {
    describe('toTimeParts', () => {
        it('should convert minutes to hours and minutes correctly', () => {
            expect(time.toTimeParts(0)).toEqual({ hours: 0, minutes: 0 });
            expect(time.toTimeParts(45)).toEqual({ hours: 0, minutes: 45 });
            expect(time.toTimeParts(60)).toEqual({ hours: 1, minutes: 0 });
            expect(time.toTimeParts(125)).toEqual({ hours: 2, minutes: 5 });
        });

        it('should never carry a rounded minute total into 60 minutes', () => {
            expect(time.toTimeParts(119.7)).toEqual({ hours: 2, minutes: 0 });
            expect(time.toTimeParts(59.6)).toEqual({ hours: 1, minutes: 0 });
        });

        it('should clamp negative input to zero', () => {
            expect(time.toTimeParts(-5)).toEqual({ hours: 0, minutes: 0 });
        });

        it('should handle large values', () => {
            expect(time.toTimeParts(1500)).toEqual({ hours: 25, minutes: 0 });
        });
    });

    describe('formatHhMm', () => {
        it('should format duration correctly', () => {
            expect(time.formatHhMm(45)).toBe('45min');
            expect(time.formatHhMm(60)).toBe('1h0min');
            expect(time.formatHhMm(125)).toBe('2h5min');
        });
    });

    describe('formatStatsDuration', () => {
        it('should format stats duration correctly', () => {
            expect(time.formatStatsDuration(45)).toBe('45m');
            expect(time.formatStatsDuration(60)).toBe('1h 0m');
            expect(time.formatStatsDuration(120, true)).toBe('2h');
            expect(time.formatStatsDuration(125)).toBe('2h 5m');
        });
    });

    describe('formatCompactDuration', () => {
        it('should use the largest units available and omit empty ones', () => {
            expect(time.formatCompactDuration(0)).toBe('0m');
            expect(time.formatCompactDuration(45)).toBe('45m');
            expect(time.formatCompactDuration(60)).toBe('1h');
            expect(time.formatCompactDuration(90)).toBe('1h 30m');
            expect(time.formatCompactDuration(1440)).toBe('1d');
            expect(time.formatCompactDuration(1590)).toBe('1d 2h 30m');
            expect(time.formatCompactDuration(1500)).toBe('1d 1h');
        });

        it('should clamp negatives and round fractional minutes', () => {
            expect(time.formatCompactDuration(-30)).toBe('0m');
            expect(time.formatCompactDuration(119.7)).toBe('2h');
        });
    });

    describe('formatLoggedDuration', () => {
        it('should format logged duration correctly', () => {
            expect(time.formatLoggedDuration(45)).toBe('45 minutes');
            expect(time.formatLoggedDuration(45, true)).toBe('45 Minutes');
            expect(time.formatLoggedDuration(60)).toBe('60 minutes (1h0min)');
            expect(time.formatLoggedDuration(120, true)).toBe('120 Minutes (2h0min)');
        });
    });
});

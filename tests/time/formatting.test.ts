import { describe, it, expect } from 'vitest';
import * as formatting from '../../src/time/formatting';

describe('formatting.ts', () => {
    describe('toTimeParts', () => {
        it('should convert minutes to hours and minutes correctly', () => {
            expect(formatting.toTimeParts(0)).toEqual({ hours: 0, minutes: 0 });
            expect(formatting.toTimeParts(45)).toEqual({ hours: 0, minutes: 45 });
            expect(formatting.toTimeParts(60)).toEqual({ hours: 1, minutes: 0 });
            expect(formatting.toTimeParts(125)).toEqual({ hours: 2, minutes: 5 });
        });

        it('should never carry a rounded minute total into 60 minutes', () => {
            expect(formatting.toTimeParts(119.7)).toEqual({ hours: 2, minutes: 0 });
            expect(formatting.toTimeParts(59.6)).toEqual({ hours: 1, minutes: 0 });
        });

        it('should clamp negative input to zero', () => {
            expect(formatting.toTimeParts(-5)).toEqual({ hours: 0, minutes: 0 });
        });

        it('should handle large values', () => {
            expect(formatting.toTimeParts(1500)).toEqual({ hours: 25, minutes: 0 });
        });
    });

    describe('formatHhMm', () => {
        it('should format duration correctly', () => {
            expect(formatting.formatHhMm(45)).toBe('45min');
            expect(formatting.formatHhMm(60)).toBe('1h0min');
            expect(formatting.formatHhMm(125)).toBe('2h5min');
        });
    });

    describe('formatStatsDuration', () => {
        it('should format stats duration correctly', () => {
            expect(formatting.formatStatsDuration(45)).toBe('45m');
            expect(formatting.formatStatsDuration(60)).toBe('1h 0m');
            expect(formatting.formatStatsDuration(120, true)).toBe('2h');
            expect(formatting.formatStatsDuration(125)).toBe('2h 5m');
        });
    });

    describe('formatCompactDuration', () => {
        it('should use the largest units available and omit empty ones', () => {
            expect(formatting.formatCompactDuration(0)).toBe('0m');
            expect(formatting.formatCompactDuration(45)).toBe('45m');
            expect(formatting.formatCompactDuration(60)).toBe('1h');
            expect(formatting.formatCompactDuration(90)).toBe('1h 30m');
            expect(formatting.formatCompactDuration(1440)).toBe('1d');
            expect(formatting.formatCompactDuration(1590)).toBe('1d 2h 30m');
            expect(formatting.formatCompactDuration(1500)).toBe('1d 1h');
        });

        it('should clamp negatives and round fractional minutes', () => {
            expect(formatting.formatCompactDuration(-30)).toBe('0m');
            expect(formatting.formatCompactDuration(119.7)).toBe('2h');
        });
    });

    describe('formatLoggedDuration', () => {
        it('should format logged duration correctly', () => {
            expect(formatting.formatLoggedDuration(45)).toBe('45 minutes');
            expect(formatting.formatLoggedDuration(45, true)).toBe('45 Minutes');
            expect(formatting.formatLoggedDuration(60)).toBe('60 minutes (1h0min)');
            expect(formatting.formatLoggedDuration(120, true)).toBe('120 Minutes (2h0min)');
        });
    });
});

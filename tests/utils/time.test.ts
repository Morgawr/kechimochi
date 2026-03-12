import { describe, it, expect } from 'vitest';
import * as time from '../../src/utils/time';

describe('time.ts', () => {
    describe('toTimeParts', () => {
        it('should convert minutes to hours and minutes correctly', () => {
            expect(time.toTimeParts(0)).toEqual({ hours: 0, minutes: 0 });
            expect(time.toTimeParts(45)).toEqual({ hours: 0, minutes: 45 });
            expect(time.toTimeParts(60)).toEqual({ hours: 1, minutes: 0 });
            expect(time.toTimeParts(125)).toEqual({ hours: 2, minutes: 5 });
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

    describe('formatLoggedDuration', () => {
        it('should format logged duration correctly', () => {
            expect(time.formatLoggedDuration(45)).toBe('45 minutes');
            expect(time.formatLoggedDuration(45, true)).toBe('45 Minutes');
            expect(time.formatLoggedDuration(60)).toBe('60 minutes (1h0min)');
            expect(time.formatLoggedDuration(120, true)).toBe('120 Minutes (2h0min)');
        });
    });
});

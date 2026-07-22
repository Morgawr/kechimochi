import { afterEach, describe, expect, it, vi } from 'vitest';
import { logPerformance } from '../src/performance';

describe('performance instrumentation', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('records one bounded performance entry without writing to the console', () => {
        const measure = vi.fn();
        const clearMeasures = vi.fn();
        vi.stubGlobal('performance', {
            now: vi.fn(() => 100),
            measure,
            clearMeasures,
        });
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        logPerformance('render', 'dashboard_range_response', 12, { outcome: 'success' });

        expect(clearMeasures).toHaveBeenCalledWith('kechimochi:render:dashboard_range_response');
        expect(measure).toHaveBeenCalledWith('kechimochi:render:dashboard_range_response', {
            start: 88,
            end: 100,
            detail: {
                phase: 'render',
                operation: 'dashboard_range_response',
                duration_ms: 12,
                outcome: 'success',
            },
        });
        expect(consoleLog).not.toHaveBeenCalled();
    });

    it('silently tolerates runtimes without performance measure support', () => {
        vi.stubGlobal('performance', { now: vi.fn(() => 100) });
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        expect(() => logPerformance('ipc', 'dashboard_snapshot', 4)).not.toThrow();
        expect(consoleLog).not.toHaveBeenCalled();
    });
});

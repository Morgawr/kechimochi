export type PerformancePhase =
    | 'ipc'
    | 'fetch'
    | 'aggregation'
    | 'render'
    | 'image_load'
    | 'chart_import'
    | 'chart_construction';

export function performanceNow(): number {
    return globalThis.performance?.now?.() ?? Date.now();
}

export function logPerformance(
    phase: PerformancePhase,
    operation: string,
    durationMs: number,
    details: Record<string, unknown> = {},
): void {
    const performanceApi = globalThis.performance;
    if (typeof performanceApi?.measure !== 'function') return;

    const name = `kechimochi:${phase}:${operation}`;
    const end = performanceNow();
    const normalizedDuration = Math.max(0, durationMs);
    try {
        // Keep only the latest sample for each operation. Measurements remain
        // available in browser performance tooling without flooding either
        // the console or an unbounded in-memory entry list.
        performanceApi.clearMeasures?.(name);
        performanceApi.measure(name, {
            start: Math.max(0, end - normalizedDuration),
            end,
            detail: {
                phase,
                operation,
                duration_ms: Number(normalizedDuration.toFixed(3)),
                ...details,
            },
        });
    } catch {
        // Older embedded webviews may not support measure options or details.
        // Instrumentation must never add visible noise or affect interaction.
    }
}

export function measureSynchronous<T>(
    phase: Extract<PerformancePhase, 'aggregation' | 'render' | 'chart_construction'>,
    operation: string,
    callback: () => T,
    details: Record<string, unknown> = {},
): T {
    const started = performanceNow();
    try {
        return callback();
    } finally {
        logPerformance(phase, operation, performanceNow() - started, details);
    }
}

export async function measureTransport<T>(
    phase: 'ipc' | 'fetch',
    operation: string,
    callback: () => Promise<T>,
): Promise<T> {
    const started = performanceNow();
    try {
        const value = await callback();
        logPerformance(phase, operation, performanceNow() - started, { outcome: 'success' });
        return value;
    } catch (error) {
        logPerformance(phase, operation, performanceNow() - started, { outcome: 'error' });
        throw error;
    }
}

// Kept for compatibility with the dashboard callers while other views share
// the generic transport probe.
export const measureDashboardTransport = measureTransport;

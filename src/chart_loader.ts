export type ChartConstructor = typeof import('chart.js/auto')['default'];

let chartConstructorPromise: Promise<ChartConstructor> | null = null;

/**
 * Keeps Chart.js out of the startup bundle and shares one in-flight import
 * between the dashboard and report-card renderer.
 */
export function loadChartConstructor(): Promise<ChartConstructor> {
    chartConstructorPromise ??= import('chart.js/auto').then(module => module.default);
    return chartConstructorPromise;
}

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildReportCardFileName,
    renderReportCardImage,
    resolveReportCardThemeColors,
} from '../../../src/profile/reportcard/report_card_image';
import type { ReportCardImageOptions } from '../../../src/profile/reportcard/report_card_image';

const chartMocks = vi.hoisted(() => ({
    create: vi.fn<(canvas: HTMLCanvasElement, config: Record<string, unknown>) => void>(),
    destroy: vi.fn<() => void>(),
}));

vi.mock('chart.js/auto', () => ({
    default: class MockChart {
        constructor(canvas: HTMLCanvasElement, config: Record<string, unknown>) {
            chartMocks.create(canvas, config);
        }

        destroy() {
            chartMocks.destroy();
        }
    },
}));

// ── buildReportCardFileName ───────────────────────────────────────────────────

describe('buildReportCardFileName', () => {
    it('produces the expected prefix, variant and extension', () => {
        expect(buildReportCardFileName('Alice', 'activity')).toBe('kechimochi_card_activity_Alice.png');
        expect(buildReportCardFileName('Alice', 'content')).toBe('kechimochi_card_content_Alice.png');
    });

    it('replaces spaces with underscores', () => {
        expect(buildReportCardFileName('Jane Doe', 'activity')).toBe('kechimochi_card_activity_Jane_Doe.png');
    });

    it('replaces special characters with underscores', () => {
        expect(buildReportCardFileName('user@example.com', 'content')).toBe('kechimochi_card_content_user_example_com.png');
    });

    it('preserves hyphens and underscores', () => {
        expect(buildReportCardFileName('my-user_name', 'activity')).toBe('kechimochi_card_activity_my-user_name.png');
    });

    it('handles unicode characters by replacing them', () => {
        expect(buildReportCardFileName('ユーザ', 'content')).toBe('kechimochi_card_content____.png');
    });

    it('handles an empty profile name', () => {
        expect(buildReportCardFileName('', 'activity')).toBe('kechimochi_card_activity_.png');
    });

    it('handles purely alphanumeric names without modification', () => {
        expect(buildReportCardFileName('Morgawr123', 'content')).toBe('kechimochi_card_content_Morgawr123.png');
    });
});

// ── resolveReportCardThemeColors ──────────────────────────────────────────────

describe('resolveReportCardThemeColors', () => {
    beforeEach(() => {
        // Reset any custom property stubs so each test starts clean.
        vi.restoreAllMocks();
    });

    it('returns hard-coded fallbacks when CSS variables are absent', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration);

        const colors = resolveReportCardThemeColors();

        expect(colors.backgroundColor).toBe('#1e1e2e');
        expect(colors.cardBackgroundColor).toBe('#2a2a3e');
        expect(colors.primaryTextColor).toBe('#cdd6f4');
        expect(colors.secondaryTextColor).toBe('#a6adc8');
        expect(colors.borderColor).toBe('#45475a');
        expect(colors.chartColors).toEqual(['#f4a6b8', '#b8cdda', '#e0bbe4', '#957DAD', '#D291BC']);
    });

    it('returns values from CSS variables when they are set', () => {
        const variableMap: Record<string, string> = {
            '--bg-dark': '#111111',
            '--bg-card': '#222222',
            '--text-primary': '#ffffff',
            '--text-secondary': '#aaaaaa',
            '--border-color': '#333333',
            '--chart-1': '#ff0000',
            '--chart-2': '#00ff00',
            '--chart-3': '#0000ff',
            '--chart-4': '#ffff00',
            '--chart-5': '#00ffff',
        };

        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: (name: string) => variableMap[name] ?? '',
        } as unknown as CSSStyleDeclaration);

        const colors = resolveReportCardThemeColors();

        expect(colors.backgroundColor).toBe('#111111');
        expect(colors.cardBackgroundColor).toBe('#222222');
        expect(colors.primaryTextColor).toBe('#ffffff');
        expect(colors.secondaryTextColor).toBe('#aaaaaa');
        expect(colors.borderColor).toBe('#333333');
        expect(colors.chartColors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff']);
    });

    it('trims whitespace from CSS variable values', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: (name: string) => name === '--bg-dark' ? '  #abcdef  ' : '',
        } as unknown as CSSStyleDeclaration);

        const colors = resolveReportCardThemeColors();

        expect(colors.backgroundColor).toBe('#abcdef');
    });

    it('returns an array of five chart colors', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration);

        const colors = resolveReportCardThemeColors();

        expect(colors.chartColors).toHaveLength(5);
    });
});

// ── renderReportCardImage ─────────────────────────────────────────────────────

describe('renderReportCardImage', () => {
    let context: CanvasRenderingContext2D;
    let outputBlob: Blob;
    let imageOutcome: 'load' | 'error';

    const themeColors = {
        backgroundColor: '#101010',
        cardBackgroundColor: '#202020',
        primaryTextColor: '#f0f0f0',
        secondaryTextColor: '#a0a0a0',
        borderColor: '#303030',
        chartColors: ['#ff0000', '#00ff00'],
    };

    function buildOptions(overrides: Partial<ReportCardImageOptions> = {}): ReportCardImageOptions {
        return {
            profileName: 'Alice Example',
            profilePictureDataUrl: null,
            initials: 'AE',
            subtitle: 'Activity breakdown',
            slices: [
                { label: 'Reading', minutes: 90, characters: 5000, percent: 75 },
                { label: 'Watching', minutes: 30, characters: 800, percent: 25 },
            ],
            generatedAtIso: '2026-07-21T01:02:03.000Z',
            themeColors,
            metric: 'time',
            ...overrides,
        };
    }

    function createCanvasContext(): CanvasRenderingContext2D {
        return {
            scale: vi.fn(),
            fillRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arcTo: vi.fn(),
            closePath: vi.fn(),
            save: vi.fn(),
            arc: vi.fn(),
            clip: vi.fn(),
            drawImage: vi.fn(),
            restore: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn(() => ({ width: 100 })),
        } as unknown as CanvasRenderingContext2D;
    }

    beforeEach(() => {
        vi.restoreAllMocks();
        chartMocks.create.mockClear();
        chartMocks.destroy.mockClear();
        imageOutcome = 'load';
        outputBlob = new Blob(['png'], { type: 'image/png' });
        context = createCanvasContext();

        Object.defineProperty(document, 'fonts', {
            value: { ready: Promise.resolve() },
            configurable: true,
        });

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
            callback(outputBlob);
        });

        const MockImage = vi.fn().mockImplementation(function (this: { onload: (() => void) | null; onerror: (() => void) | null }) {
            this.onload = null;
            this.onerror = null;
            Object.defineProperty(this, 'src', {
                set: () => {
                    queueMicrotask(() => {
                        if (imageOutcome === 'error') {
                            this.onerror?.();
                        } else {
                            this.onload?.();
                        }
                    });
                },
            });
        });

        vi.stubGlobal('Image', MockImage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('renders a deterministic PNG with initials, legend, chart, branding, and date', async () => {
        const blob = await renderReportCardImage(buildOptions());

        expect(blob).toBe(outputBlob);
        expect(context.scale).toHaveBeenCalledWith(2, 2);
        expect(context.fillRect).toHaveBeenCalledWith(0, 0, 720, 340);
        expect(context.fillText).toHaveBeenCalledWith('AE', 70, 80);
        expect(context.fillText).toHaveBeenCalledWith('Alice Example', 120, 78);
        expect(context.fillText).toHaveBeenCalledWith('Activity breakdown', 120, 100);
        expect(context.fillText).toHaveBeenCalledWith('Reading', 60, 158);
        expect(context.fillText).toHaveBeenCalledWith('5,000ch', 305, 158);
        expect(context.fillText).toHaveBeenCalledWith('1h 30m', 430, 158);
        expect(context.fillText).toHaveBeenCalledWith('(75%)', 505, 158);
        expect(context.fillText).toHaveBeenCalledWith('kechimochi', 624, 316);
        expect(context.fillText).toHaveBeenCalledWith('as of 2026-07-21 · percentages calculated based on time', 36, 316);

        const [chartCanvas, chartConfig] = chartMocks.create.mock.calls[0];
        expect(chartCanvas.width).toBe(260);
        expect(chartCanvas.height).toBe(260);
        expect(chartConfig).toMatchObject({
            type: 'doughnut',
            data: {
                labels: ['Reading', 'Watching'],
                datasets: [{
                    data: [90, 30],
                    backgroundColor: ['#ff0000', '#00ff00'],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: false,
                animation: false,
                devicePixelRatio: 1,
            },
        });
        expect(context.drawImage).toHaveBeenCalledWith(chartCanvas, 550, 95, 130, 130);
        expect(chartMocks.destroy).toHaveBeenCalledOnce();

        const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.instances[0] as unknown as HTMLCanvasElement;
        expect(canvas.width).toBe(1440);
        expect(canvas.height).toBe(680);
        expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    });

    it('draws a loaded profile image inside the avatar clip', async () => {
        await renderReportCardImage(buildOptions({ profilePictureDataUrl: 'data:image/png;base64,avatar' }));

        const drawImageCalls = vi.mocked(context.drawImage).mock.calls as unknown as unknown[][];
        const imageDraw = drawImageCalls.find(call => call.length === 5 && call[1] === 34);
        expect(imageDraw).toEqual([expect.anything(), 34, 44, 72, 72]);
        expect(context.clip).toHaveBeenCalledOnce();
        expect(context.fillText).not.toHaveBeenCalledWith('AE', 70, 80);
    });

    it('falls back to initials when the profile image cannot be loaded', async () => {
        imageOutcome = 'error';

        await renderReportCardImage(buildOptions({ profilePictureDataUrl: 'data:image/png;base64,broken' }));

        expect(context.fillText).toHaveBeenCalledWith('AE', 70, 80);
    });

    it('draws the characters-based footer label when metric is characters', async () => {
        await renderReportCardImage(buildOptions({ metric: 'characters' }));

        expect(context.fillText).toHaveBeenCalledWith('as of 2026-07-21 · percentages calculated based on characters', 36, 316);
    });

    it('draws the donut from character values when metric is characters', async () => {
        await renderReportCardImage(buildOptions({ metric: 'characters' }));

        const [, chartConfig] = chartMocks.create.mock.calls[0];
        expect(chartConfig).toMatchObject({
            data: { datasets: [{ data: [5000, 800] }] },
        });
    });

    it('right-aligns the chars, time, and percent columns to non-colliding anchors', async () => {
        await renderReportCardImage(buildOptions({
            slices: [
                { label: 'Visual Novel', minutes: 20535, characters: 9_999_999_999, percent: 48 },
            ],
        }));

        expect(context.fillText).toHaveBeenCalledWith('9,999,999,999ch', 305, 158);
        expect(context.fillText).toHaveBeenCalledWith('342h 15m', 430, 158);
        expect(context.fillText).toHaveBeenCalledWith('(48%)', 505, 158);
    });

    it('renders the empty state without a chart or date footer', async () => {
        await renderReportCardImage(buildOptions({ slices: [], generatedAtIso: '' }));

        expect(context.fillText).toHaveBeenCalledWith('No activity logged yet.', 60, 158);
        expect(context.fillText).not.toHaveBeenCalledWith(expect.stringMatching(/^as of /), expect.any(Number), expect.any(Number));
        expect(chartMocks.create).not.toHaveBeenCalled();
        expect(chartMocks.destroy).not.toHaveBeenCalled();
    });

    it('rejects when a 2D drawing context is unavailable', async () => {
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);

        await expect(renderReportCardImage(buildOptions())).rejects.toThrow(
            'Cannot obtain 2D canvas context for report card rendering',
        );
    });

    it('rejects when the browser cannot encode the canvas as a PNG', async () => {
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(null));

        await expect(renderReportCardImage(buildOptions())).rejects.toThrow('Failed to render report card image');
    });
});

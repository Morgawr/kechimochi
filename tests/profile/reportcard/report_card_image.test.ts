import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildReportCardFileName,
    resolveReportCardThemeColors,
} from '../../../src/profile/reportcard/report_card_image';

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
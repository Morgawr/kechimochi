import { describe, expect, it, vi } from 'vitest';
import {
    applyTheme,
    buildCustomThemeStyles,
    createExportableThemePack,
    parseManagedThemePacks,
    parseStoredCustomThemes,
    resolveThemeSelection,
    writeThemeCache,
    validateThemePack,
} from '../src/themes';
import { STORAGE_KEYS } from '../src/constants';

const baseVariables = {
    'bg-dark': '#101010',
    'bg-card': '#202020',
    'bg-card-hover': '#303030',
    'text-primary': '#ffffff',
    'text-secondary': '#cccccc',
    'accent-green': '#00ff88',
    'accent-green-hover': '#22ffaa',
    'accent-red': '#ff4466',
    'accent-blue': '#4488ff',
    'accent-yellow': '#ffdd44',
    'accent-purple': '#aa66ff',
    'border-color': '#444444',
    'shadow-sm': '0 2px 4px rgba(0,0,0,0.2)',
    'shadow-md': '0 4px 12px rgba(0,0,0,0.4)',
    'heatmap-hue': '180',
    'heatmap-sat-base': '40',
    'heatmap-sat-range': '50',
    'heatmap-light-base': '45',
    'heatmap-light-range': '35',
    'accent-text': '#000000',
    'chart-1': '#111111',
    'chart-2': '#222222',
    'chart-3': '#333333',
    'chart-4': '#444444',
    'chart-5': '#555555',
} as const;

describe('themes.ts', () => {
    it('validates theme packs and rejects unsafe css overrides', () => {
        const valid = validateThemePack({
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: baseVariables,
            cssOverrides: '.btn { border-radius: 999px; }',
        });

        expect(valid.id).toBe('custom:test-theme');
        expect(() => validateThemePack({
            version: 1,
            id: 'light',
            name: 'Reserved',
            variables: baseVariables,
        })).toThrow('reserved');
        expect(() => validateThemePack({
            version: 1,
            id: 'custom:unsafe',
            name: 'Unsafe',
            variables: baseVariables,
            cssOverrides: '@import url("https://example.com/bad.css");',
        })).toThrow('unsupported');
    });

    it('scopes custom css overrides to the active theme', () => {
        const styles = buildCustomThemeStyles([{
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: { ...baseVariables },
            cssOverrides: '.btn, body::before { border-radius: 999px; } @media (max-width: 600px) { .card { padding: 2rem; } }',
        }]);

        expect(styles).toContain("body[data-theme='custom:test-theme'] .btn");
        expect(styles).toContain("body[data-theme='custom:test-theme']::before");
        expect(styles).toContain("@media (max-width: 600px)");
        expect(styles).toContain("body[data-theme='custom:test-theme'] .card");
    });

    it('exports built-in themes as custom packs and falls back when custom themes disappear', () => {
        const builtInExport = createExportableThemePack('light', []);
        expect(builtInExport.id).toBe('custom:light');
        expect(builtInExport.cssOverrides).toBe('');

        const customThemes = parseStoredCustomThemes(JSON.stringify([{
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: baseVariables,
        }]));
        const customExport = createExportableThemePack('custom:test-theme', customThemes);
        expect(customExport.cssOverrides).toBe('');
        expect(resolveThemeSelection('custom:test-theme', customThemes)).toBe('custom:test-theme');
        expect(resolveThemeSelection('custom:missing', customThemes)).toBe('pastel-pink');
    });

    it('applies custom themes to the document', () => {
        document.body.dataset.theme = '';
        const customThemes = parseStoredCustomThemes(JSON.stringify([{
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: baseVariables,
            cssOverrides: '.btn { border-radius: 999px; }',
        }]));

        const resolved = applyTheme('custom:test-theme', customThemes);
        expect(resolved).toBe('custom:test-theme');
        expect(document.body.dataset.theme).toBe('custom:test-theme');
        expect(document.getElementById('kechimochi-custom-theme-styles')?.textContent).toContain('border-radius: 999px;');
    });

    it('writes only the selected theme cache and clears the legacy custom theme payload', () => {
        const setItem = vi.fn();
        const removeItem = vi.fn();

        writeThemeCache('dark', parseStoredCustomThemes(JSON.stringify([{
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: baseVariables,
            cssOverrides: '.btn { border-radius: 999px; }',
        }])), { setItem, removeItem } as unknown as Storage);

        expect(removeItem).toHaveBeenCalledWith(STORAGE_KEYS.CUSTOM_THEMES_CACHE);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(setItem).toHaveBeenCalledWith(STORAGE_KEYS.THEME_CACHE, 'dark');
    });

    it('does not reintroduce quota-sensitive full theme writes when many custom themes exist', () => {
        const setItem = vi.fn();
        const removeItem = vi.fn();
        const customThemes = Array.from({ length: 200 }, (_, index) => ({
            version: 1 as const,
            id: `custom:test-theme-${index}`,
            name: `Test Theme ${index}`,
            variables: { ...baseVariables },
            cssOverrides: '.btn { border-radius: 999px; }',
        }));

        expect(() => writeThemeCache('custom:test-theme-0', customThemes, { setItem, removeItem } as unknown as Storage)).not.toThrow();
        expect(removeItem).toHaveBeenCalledWith(STORAGE_KEYS.CUSTOM_THEMES_CACHE);
        expect(setItem).toHaveBeenCalledTimes(1);
    });

    it('normalizes literal slash-n sequences in css overrides from imported packs', () => {
        const theme = validateThemePack({
            version: 1,
            id: 'custom:slash-n-theme',
            name: 'Slash N Theme',
            variables: baseVariables,
            cssOverrides: ".btn { border-radius: 999px; }\\n\\n.card { border-radius: 30px; }",
        });

        const css = buildCustomThemeStyles([theme]);

        expect(css).toContain("body[data-theme='custom:slash-n-theme'] .btn");
        expect(css).toContain("body[data-theme='custom:slash-n-theme'] .card");
    });

    it('parses managed theme pack contents and skips invalid entries', () => {
        const managedThemes = parseManagedThemePacks([
            JSON.stringify({
                version: 1,
                id: 'custom:managed-theme',
                name: 'Managed Theme',
                variables: baseVariables,
            }),
            '{"version":1,"id":"custom:broken"',
        ]);

        expect(managedThemes).toHaveLength(1);
        expect(managedThemes[0].id).toBe('custom:managed-theme');
    });
});

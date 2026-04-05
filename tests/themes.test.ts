import { describe, expect, it, vi } from 'vitest';
import {
    applyTheme,
    buildCustomThemeStyles,
    createExportableThemePack,
    getThemePackFilename,
    parseManagedThemePacks,
    parseStoredCustomThemes,
    resolveThemePackAssets,
    resolveThemeSelection,
    writeThemeCache,
    validateThemePack,
} from '../src/themes';
import { STORAGE_KEYS } from '../src/constants';

const baseVariables = {
    'surface-base': '#101010',
    'surface-card': '#202020',
    'surface-card-hover': '#303030',
    'text-primary': '#ffffff',
    'text-secondary': '#cccccc',
    'accent-primary': '#00ff88',
    'accent-primary-hover': '#22ffaa',
    'accent-danger': '#ff4466',
    'accent-interactive': '#4488ff',
    'accent-highlight': '#ffdd44',
    'accent-secondary': '#aa66ff',
    'border-subtle': '#444444',
    'shadow-soft': '0 2px 4px rgba(0,0,0,0.2)',
    'shadow-strong': '0 4px 12px rgba(0,0,0,0.4)',
    'heatmap-hue': '180',
    'heatmap-saturation-base': '40',
    'heatmap-saturation-range': '50',
    'heatmap-lightness-base': '45',
    'heatmap-lightness-range': '35',
    'accent-contrast': '#000000',
    'chart-series-1': '#111111',
    'chart-series-2': '#222222',
    'chart-series-3': '#333333',
    'chart-series-4': '#444444',
    'chart-series-5': '#555555',
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

    it('supports version 1 themes with bundled fonts, typography, and relative assets', async () => {
        const theme = validateThemePack({
            version: 1,
            id: 'custom:bundle-theme',
            name: 'Bundle Theme',
            variables: baseVariables,
            background: {
                type: 'video',
                src: 'assets/background.mp4',
                poster: 'assets/poster.webp',
                fit: 'contain',
            },
            fonts: [{
                family: 'Reload Sans',
                src: 'assets/reload.woff2',
                format: 'woff2',
                weight: '700',
            }],
            typography: {
                body_family: "'Reload Sans', sans-serif",
                heading_family: "'Reload Sans', sans-serif",
                monospace_family: "'Reload Mono', monospace",
            },
        });

        const resolved = await resolveThemePackAssets(theme, async (_themeId, assetPath) => `https://cdn.example/${assetPath}`);
        const styles = buildCustomThemeStyles([resolved]);

        expect(resolved.background?.src).toBe('https://cdn.example/assets/background.mp4');
        expect(resolved.background?.poster).toBe('https://cdn.example/assets/poster.webp');
        expect(resolved.fonts?.[0]?.src).toBe('https://cdn.example/assets/reload.woff2');
        expect(styles).toContain("@font-face {");
        expect(styles).toContain("font-family: 'Reload Sans'");
        expect(styles).toContain("body[data-theme='custom:bundle-theme']{font-family:'Reload Sans', sans-serif;}");
        expect(styles).toContain("body[data-theme='custom:bundle-theme'] h1,body[data-theme='custom:bundle-theme'] h2");
    });

    it('exports built-in themes as custom packs and falls back when custom themes disappear', () => {
        const builtInExport = createExportableThemePack('light', []);
        expect(builtInExport.id).toBe('custom:light');
        expect(builtInExport.cssOverrides).toBe('');
        expect(getThemePackFilename(builtInExport)).toBe('kechimochi_theme_light-theme-custom.json');

        const customThemes = parseStoredCustomThemes(JSON.stringify([{
            version: 1,
            id: 'custom:test-theme',
            name: 'Test Theme',
            variables: baseVariables,
        }]));
        const customExport = createExportableThemePack('custom:test-theme', customThemes);
        expect(customExport.cssOverrides).toBe('');
        expect(getThemePackFilename(customExport)).toBe('kechimochi_theme_test-theme.json');
        expect(getThemePackFilename(customExport, true)).toBe('kechimochi_theme_test-theme.zip');
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

    it('renders a themed background layer for version 1 custom themes', () => {
        document.body.innerHTML = '<div id="app"><div id="view-container"></div></div>';

        const resolved = applyTheme('custom:bundle-theme', [{
            version: 1,
            id: 'custom:bundle-theme',
            name: 'Bundle Theme',
            variables: { ...baseVariables },
            background: {
                type: 'image',
                src: 'https://cdn.example/assets/bg.webp',
                fit: 'fill',
                opacity: 0.45,
                blur_px: 2,
            },
        }]);

        expect(resolved).toBe('custom:bundle-theme');
        const backdrop = document.getElementById('kechimochi-custom-theme-backdrop');
        expect(backdrop?.style.display).toBe('block');
        expect(backdrop?.style.position).toBe('fixed');
        expect(backdrop?.firstElementChild).not.toBeNull();
        expect((backdrop?.firstElementChild as HTMLElement).style.backgroundImage).toContain('https://cdn.example/assets/bg.webp');
        expect((backdrop?.firstElementChild as HTMLElement).style.backgroundSize).toBe('100% 100%');
    });

    it('renders autoplay video backgrounds and keeps app content above the backdrop', async () => {
        document.body.innerHTML = '<div id="app"><div id="view-container"></div><main id="content"></main></div>';
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

        const resolved = applyTheme('custom:video-theme', [{
            version: 1,
            id: 'custom:video-theme',
            name: 'Video Theme',
            variables: { ...baseVariables },
            background: {
                type: 'video',
                src: 'https://cdn.example/assets/bg.mp4',
                fit: 'cover',
            },
        }]);

        await Promise.resolve();

        expect(resolved).toBe('custom:video-theme');

        const backdrop = document.getElementById('kechimochi-custom-theme-backdrop');
        const video = backdrop?.firstElementChild;
        const content = document.getElementById('content') as HTMLElement | null;
        const appRoot = document.getElementById('app') as HTMLElement | null;

        expect(backdrop?.style.display).toBe('block');
        expect(backdrop?.style.position).toBe('fixed');
        expect(backdrop?.style.zIndex).toBe('0');
        expect(video).toBeInstanceOf(HTMLVideoElement);
        expect(video?.tagName).toBe('VIDEO');
        expect((video as HTMLVideoElement | null)?.autoplay).toBe(true);
        expect((video as HTMLVideoElement | null)?.muted).toBe(true);
        expect((video as HTMLVideoElement | null)?.defaultMuted).toBe(true);
        expect((video as HTMLVideoElement | null)?.getAttribute('playsinline')).toBe('');
        expect((video as HTMLVideoElement | null)?.style.objectFit).toBe('cover');
        expect(appRoot?.style.zIndex).toBe('1');
        expect(content?.style.position).toBe('');
        expect(content?.style.zIndex).toBe('');
        expect(playSpy).toHaveBeenCalledOnce();

        playSpy.mockRestore();
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
            cssOverrides: String.raw`.btn { border-radius: 999px; }\n\n.card { border-radius: 30px; }`,
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

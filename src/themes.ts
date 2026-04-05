import { Logger } from './core/logger';
import { DEFAULTS, STORAGE_KEYS } from './constants';
import {
    type ThemeBackgroundDefinition,
    type ThemeFontDefinition,
    type ThemePackV1,
    type ThemeVariableKey,
    type ThemeVariables,
    type ThemeTypographyDefinition,
} from './types';

export type {
    ThemeBackgroundDefinition,
    ThemeFontDefinition,
    ThemePackV1,
    ThemeTypographyDefinition,
    ThemeVariables,
    ThemeVariableKey,
} from './types';

const CUSTOM_THEME_STYLE_ID = 'kechimochi-custom-theme-styles';
const CUSTOM_THEME_BACKDROP_ID = 'kechimochi-custom-theme-backdrop';
const THEME_BACKDROP_MANAGED_APP_POSITION = 'themeBackdropManagedAppPosition';
const THEME_BACKDROP_MANAGED_APP_Z_INDEX = 'themeBackdropManagedAppZIndex';
const BUILTIN_EXPORT_PREFIX = 'custom:';

type ThemeDefinition = ThemePackV1 & { builtIn: boolean };
type ThemeOption = Pick<ThemeDefinition, 'id' | 'name' | 'builtIn'>;

type ThemeVariableDescriptor = {
    key: ThemeVariableKey;
    cssVar: BuiltInThemeCssVariableKey;
};

const BUILTIN_THEME_CSS_VARIABLE_KEYS = [
    'bg-dark',
    'bg-card',
    'bg-card-hover',
    'text-primary',
    'text-secondary',
    'accent-green',
    'accent-green-hover',
    'accent-red',
    'accent-blue',
    'accent-yellow',
    'accent-purple',
    'border-color',
    'shadow-sm',
    'shadow-md',
    'heatmap-hue',
    'heatmap-sat-base',
    'heatmap-sat-range',
    'heatmap-light-base',
    'heatmap-light-range',
    'accent-text',
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
] as const;

type BuiltInThemeCssVariableKey = typeof BUILTIN_THEME_CSS_VARIABLE_KEYS[number];
type BuiltInThemeCssVariables = Partial<Record<BuiltInThemeCssVariableKey, string>>;
type BuiltInThemeSpec = readonly [id: string, name: string, values: readonly (string | undefined)[]];

const BACKSLASH = '\\';
const ESCAPED_BACKSLASH = '\\\\';
const ESCAPED_SINGLE_QUOTE = "\\'";
const ESCAPED_CRLF = String.raw`\r\n`;
const ESCAPED_NEWLINE = String.raw`\n`;
const ESCAPED_TAB = String.raw`\t`;

const THEME_VARIABLE_DESCRIPTORS: readonly ThemeVariableDescriptor[] = [
    { key: 'surface-base', cssVar: 'bg-dark' },
    { key: 'surface-card', cssVar: 'bg-card' },
    { key: 'surface-card-hover', cssVar: 'bg-card-hover' },
    { key: 'text-primary', cssVar: 'text-primary' },
    { key: 'text-secondary', cssVar: 'text-secondary' },
    { key: 'accent-primary', cssVar: 'accent-green' },
    { key: 'accent-primary-hover', cssVar: 'accent-green-hover' },
    { key: 'accent-danger', cssVar: 'accent-red' },
    { key: 'accent-interactive', cssVar: 'accent-blue' },
    { key: 'accent-highlight', cssVar: 'accent-yellow' },
    { key: 'accent-secondary', cssVar: 'accent-purple' },
    { key: 'border-subtle', cssVar: 'border-color' },
    { key: 'shadow-soft', cssVar: 'shadow-sm' },
    { key: 'shadow-strong', cssVar: 'shadow-md' },
    { key: 'heatmap-hue', cssVar: 'heatmap-hue' },
    { key: 'heatmap-saturation-base', cssVar: 'heatmap-sat-base' },
    { key: 'heatmap-saturation-range', cssVar: 'heatmap-sat-range' },
    { key: 'heatmap-lightness-base', cssVar: 'heatmap-light-base' },
    { key: 'heatmap-lightness-range', cssVar: 'heatmap-light-range' },
    { key: 'accent-contrast', cssVar: 'accent-text' },
    { key: 'chart-series-1', cssVar: 'chart-1' },
    { key: 'chart-series-2', cssVar: 'chart-2' },
    { key: 'chart-series-3', cssVar: 'chart-3' },
    { key: 'chart-series-4', cssVar: 'chart-4' },
    { key: 'chart-series-5', cssVar: 'chart-5' },
] as const;

const DEFAULT_THEME_VARIABLES: Pick<
    ThemeVariables,
    'heatmap-hue' | 'heatmap-saturation-base' | 'heatmap-saturation-range' | 'heatmap-lightness-base' | 'heatmap-lightness-range' | 'accent-contrast'
> = {
    'heatmap-hue': '353',
    'heatmap-saturation-base': '30',
    'heatmap-saturation-range': '70',
    'heatmap-lightness-base': '45',
    'heatmap-lightness-range': '41',
    'accent-contrast': '#ffffff',
};

function normalizeThemeVariables(input: Record<string, unknown>, sourceLabel: string): ThemeVariables {
    const variables = {} as ThemeVariables;

    for (const descriptor of THEME_VARIABLE_DESCRIPTORS) {
        const value = input[descriptor.key];

        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`${sourceLabel} variable "${descriptor.key}" must be a non-empty string.`);
        }

        variables[descriptor.key] = value.trim();
    }

    return variables;
}

function createThemeVariables(overrides: Partial<ThemeVariables>): ThemeVariables {
    return normalizeThemeVariables({ ...DEFAULT_THEME_VARIABLES, ...overrides }, 'Built-in theme');
}

function createThemeVariablesFromCssVariables(overrides: BuiltInThemeCssVariables): ThemeVariables {
    const normalizedOverrides = Object.fromEntries(
        THEME_VARIABLE_DESCRIPTORS
            .map(descriptor => [descriptor.key, overrides[descriptor.cssVar]])
            .filter(([, value]) => value !== undefined),
    ) as Partial<ThemeVariables>;

    return createThemeVariables(normalizedOverrides);
}

function createThemeVariablesFromCssValueList(values: readonly (string | undefined)[]): ThemeVariables {
    const overrides: BuiltInThemeCssVariables = {};

    BUILTIN_THEME_CSS_VARIABLE_KEYS.forEach((key, index) => {
        const value = values[index];
        if (value !== undefined) {
            overrides[key] = value;
        }
    });

    return createThemeVariablesFromCssVariables(overrides);
}

function createBuiltInTheme([id, name, values]: BuiltInThemeSpec): ThemeDefinition {
    return {
        version: 1,
        id,
        name,
        builtIn: true,
        variables: createThemeVariablesFromCssValueList(values),
    };
}

const BUILTIN_THEME_SPECS = [
    ['pastel-pink', 'Pastel Pink (Default)', ['#2e232b', '#3d2e37', '#4f3b47', '#fff0f5', '#d8bfd8', '#ffb3ba', '#ffdfba', '#ff9eaa', '#b19cd9', '#fadadd', '#f5c0c0', '#554460', '0 2px 4px rgba(0, 0, 0, 0.2)', '0 4px 12px rgba(0, 0, 0, 0.3)', '353', '30', '70', undefined, undefined, '#000000', '#f4a6b8', '#b8cdda', '#e0bbe4', '#957DAD', '#D291BC']],
    ['light', 'Light Theme', ['#f8f9fa', '#ffffff', '#f1f3f5', '#212529', '#495057', '#228be6', '#1c7ed6', '#fa5252', '#7950f2', '#fab005', '#be4bdb', '#dee2e6', '0 2px 4px rgba(0, 0, 0, 0.05)', '0 4px 12px rgba(0, 0, 0, 0.1)', '210', '40', '60', undefined, undefined, '#ffffff', '#228be6', '#fa5252', '#40c057', '#fd7e14', '#7950f2']],
    ['dark', 'Dark Theme', ['#121212', '#1e1e1e', '#2d2d2d', '#e0e0e0', '#b0b0b0', '#bb86fc', '#d1a8ff', '#cf6679', '#03dac6', '#fdd835', '#bb86fc', '#333333', '0 2px 4px rgba(0, 0, 0, 0.5)', '0 4px 12px rgba(0, 0, 0, 0.7)', '260', '50', '50', undefined, undefined, '#ffffff', '#bb86fc', '#03dac6', '#fdd835', '#ff8a65', '#82b1ff']],
    ['light-greyscale', 'Light Greyscale', ['#ffffff', '#f5f5f5', '#e0e0e0', '#000000', '#424242', '#212121', '#424242', '#424242', '#616161', '#757575', '#212121', '#bdbdbd', '0 2px 4px rgba(0,0,0,0.1)', '0 4px 12px rgba(0,0,0,0.15)', '0', '0', '0', '80', '-60', '#ffffff', '#212121', '#424242', '#616161', '#757575', '#9e9e9e']],
    ['dark-greyscale', 'Dark Greyscale', ['#000000', '#121212', '#1e1e1e', '#ffffff', '#aaaaaa', '#f5f5f5', '#e0e0e0', '#bdbdbd', '#e0e0e0', '#f5f5f5', '#eeeeee', '#333333', '0 2px 4px rgba(0,0,0,0.5)', '0 4px 12px rgba(0,0,0,0.8)', '0', '0', '0', '20', '60', '#000000', '#f5f5f5', '#e0e0e0', '#bdbdbd', '#9e9e9e', '#757575']],
    ['molokai', 'Molokai', ['#1b1d1e', '#232526', '#3e3d32', '#f8f8f2', '#8f908a', '#a6e22e', '#c4e22e', '#f92672', '#66d9ef', '#e6db74', '#ae81ff', '#465457', '0 2px 4px rgba(0,0,0,0.4)', '0 4px 12px rgba(0,0,0,0.6)', '80', '40', '60', undefined, undefined, '#000000', '#a6e22e', '#f92672', '#66d9ef', '#e6db74', '#ae81ff']],
    ['green-olive', 'Green Olive', ['#232d20', '#2d3a2a', '#3d4d38', '#e8f0e5', '#a7bfa2', '#89b07a', '#a3c498', '#d17a7a', '#7a9cb0', '#e5e8e5', '#9a7ab0', '#4a5d45', '0 2px 4px rgba(0,0,0,0.3)', '0 4px 12px rgba(0,0,0,0.4)', '100', undefined, undefined, undefined, undefined, undefined, '#89b07a', '#a7bfa2', '#7a9cb0', '#9a7ab0', '#bcc4bcc3']],
    ['deep-blue', 'Deep Blue', ['#0a192f', '#112240', '#233554', '#e6f1ff', '#8892b0', '#64ffda', '#80ffe2', '#ff4d4d', '#3399ff', '#ccd6f6', '#bd93f9', '#1d2d50', '0 2px 4px rgba(0,0,0,0.5)', '0 4px 12px rgba(0,0,0,0.7)', '170', undefined, undefined, undefined, undefined, undefined, '#64ffda', '#3399ff', '#bd93f9', '#ff79c6', '#8be9fd']],
    ['purple', 'Purple', ['#1e1b2e', '#2e2a44', '#3f3a5c', '#f0ebff', '#b1a7d1', '#d1a7ff', '#e0c7ff', '#ff7eb6', '#7eb6ff', '#ffeb3b', '#9c27b0', '#4a446a', '0 2px 4px rgba(0,0,0,0.3)', '0 4px 12px rgba(0,0,0,0.5)', '270', undefined, undefined, undefined, undefined, undefined, '#d1a7ff', '#7eb6ff', '#ff7eb6', '#ffeb3b', '#9c27b0']],
    ['fire-red', 'Fire Red', ['#2b1111', '#3d1a1a', '#542525', '#ffeeee', '#d1a7a7', '#ff4d4d', '#ff6666', '#ff1a1a', '#ff7e7e', '#ffd700', '#e91e63', '#6a2a2a', '0 2px 4px rgba(0,0,0,0.4)', '0 4px 12px rgba(0,0,0,0.6)', '0', undefined, undefined, undefined, undefined, undefined, '#ff4d4d', '#ff7e7e', '#ffd700', '#ff1a1a', '#e91e63']],
    ['yellow-lime', 'Yellow Lime', ['#2a2b10', '#3a3b1a', '#4a4b2a', '#ffffef', '#d1d1a7', '#d4ff00', '#e0ff33', '#ff4d4d', '#33d4ff', '#fdd835', '#9c27b0', '#5a5b2a', '0 2px 4px rgba(0,0,0,0.3)', '0 4px 12px rgba(0,0,0,0.5)', '65', undefined, undefined, undefined, undefined, undefined, '#d4ff00', '#33d4ff', '#fdd835', '#ff4d4d', '#9c27b0']],
    ['noctua-brown', 'Noctua Brown', ['#3c2e28', '#4d3c33', '#634d42', '#f2e5d5', '#c2ada1', '#d9bfa9', '#e6cec0', '#ff7e7e', '#708090', '#d9c5b2', '#c2ada1', '#5d4a3f', '0 2px 4px rgba(0,0,0,0.4)', '0 4px 12px rgba(0,0,0,0.6)', '20', '20', '40', undefined, undefined, '#3c2e28', '#904732', '#c2ada1', '#d9c5b2', '#708090', '#46342e']],
] satisfies readonly BuiltInThemeSpec[];

export const BUILTIN_THEMES: ThemeDefinition[] = BUILTIN_THEME_SPECS.map(createBuiltInTheme);

const BUILTIN_THEME_MAP = new Map(BUILTIN_THEMES.map(theme => [theme.id, theme]));
const BUILTIN_THEME_ID_SET = new Set(BUILTIN_THEMES.map(theme => theme.id));
const SAFE_THEME_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const UNSAFE_CSS_PATTERNS = [
    /@import\b/i,
    /javascript:/i,
    /expression\s*\(/i,
    /behavior\s*:/i,
    /-moz-binding/i,
];

export type ThemeAssetResolver = (themeId: string, assetPath: string) => Promise<string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeThemeAssetReference(value: string): string {
    return value.trim().replaceAll(BACKSLASH, '/');
}

function isAbsoluteThemeAssetReference(value: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/|data:|blob:)/i.test(value);
}

function isSafeRelativeThemeAssetPath(value: string): boolean {
    if (value.length === 0) return false;
    if (value.startsWith('/')) return false;
    if (/^[A-Za-z]:\//.test(value)) return false;
    const segments = value.split('/');
    return segments.every(segment => segment !== '..' && segment.trim().length > 0);
}

function validateThemeAssetReference(value: unknown, label: string): string {
    if (!isNonEmptyString(value)) {
        throw new Error(`${label} must be a non-empty string.`);
    }

    const normalized = normalizeThemeAssetReference(value);
    if (!isAbsoluteThemeAssetReference(normalized) && !isSafeRelativeThemeAssetPath(normalized)) {
        throw new Error(`${label} must be an absolute URL/data URI or a safe relative asset path.`);
    }

    return normalized;
}

function validateThemeBackground(input: unknown): ThemeBackgroundDefinition | undefined {
    if (input === undefined) return undefined;
    if (!isRecord(input)) {
        throw new Error('Theme pack background must be an object.');
    }

    const type = input.type;
    if (type !== 'image' && type !== 'video') {
        throw new Error('Theme pack background type must be "image" or "video".');
    }

    const fit = input.fit;
    if (fit !== undefined && fit !== 'cover' && fit !== 'contain' && fit !== 'fill') {
        throw new Error('Theme pack background fit must be "cover", "contain", or "fill".');
    }

    if (input.opacity !== undefined && !isFiniteNumber(input.opacity)) {
        throw new Error('Theme pack background opacity must be a finite number.');
    }
    if (input.blur_px !== undefined && !isFiniteNumber(input.blur_px)) {
        throw new Error('Theme pack background blur_px must be a finite number.');
    }
    if (input.playback_rate !== undefined && !isFiniteNumber(input.playback_rate)) {
        throw new Error('Theme pack background playback_rate must be a finite number.');
    }
    if (input.loop !== undefined && typeof input.loop !== 'boolean') {
        throw new Error('Theme pack background loop must be a boolean.');
    }
    if (input.muted !== undefined && typeof input.muted !== 'boolean') {
        throw new Error('Theme pack background muted must be a boolean.');
    }

    const background: ThemeBackgroundDefinition = {
        type,
        src: validateThemeAssetReference(input.src, 'Theme pack background src'),
    };

    if (isNonEmptyString(input.poster)) {
        background.poster = validateThemeAssetReference(input.poster, 'Theme pack background poster');
    }
    if (fit !== undefined) {
        background.fit = fit;
    }
    if (input.opacity !== undefined) {
        background.opacity = Math.min(1, Math.max(0, input.opacity));
    }
    if (input.blur_px !== undefined) {
        background.blur_px = Math.max(0, input.blur_px);
    }
    if (input.playback_rate !== undefined) {
        background.playback_rate = Math.max(0.1, input.playback_rate);
    }
    if (input.loop !== undefined) {
        background.loop = input.loop;
    }
    if (input.muted !== undefined) {
        background.muted = input.muted;
    }

    return background;
}

function validateThemeFonts(input: unknown): ThemeFontDefinition[] | undefined {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) {
        throw new Error('Theme pack fonts must be an array.');
    }

    return input.map((entry, index) => {
        if (!isRecord(entry)) {
            throw new Error(`Theme pack font ${index + 1} must be an object.`);
        }

        const family = typeof entry.family === 'string' ? entry.family.trim() : '';
        if (!family) {
            throw new Error(`Theme pack font ${index + 1} family is required.`);
        }

        const format = entry.format;
        if (format !== undefined && format !== 'woff2' && format !== 'woff' && format !== 'truetype' && format !== 'opentype') {
            throw new Error(`Theme pack font ${index + 1} format is unsupported.`);
        }

        const style = entry.style;
        if (style !== undefined && style !== 'normal' && style !== 'italic' && style !== 'oblique') {
            throw new Error(`Theme pack font ${index + 1} style is unsupported.`);
        }

        return {
            family,
            src: validateThemeAssetReference(entry.src, `Theme pack font ${index + 1} src`),
            weight: isNonEmptyString(entry.weight) ? entry.weight.trim() : undefined,
            style,
            format,
        } satisfies ThemeFontDefinition;
    });
}

function validateThemeTypography(input: unknown): ThemeTypographyDefinition | undefined {
    if (input === undefined) return undefined;
    if (!isRecord(input)) {
        throw new Error('Theme pack typography must be an object.');
    }

    const typography: ThemeTypographyDefinition = {};
    if (isNonEmptyString(input.body_family)) {
        typography.body_family = input.body_family.trim();
    }
    if (isNonEmptyString(input.heading_family)) {
        typography.heading_family = input.heading_family.trim();
    }
    if (isNonEmptyString(input.monospace_family)) {
        typography.monospace_family = input.monospace_family.trim();
    }

    return Object.keys(typography).length > 0 ? typography : undefined;
}

function slugifyThemeName(name: string): string {
    const normalized = name.toLowerCase();
    let slug = '';
    let lastWasDash = false;

    for (const char of normalized) {
        const isAlphaNumeric = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
        if (isAlphaNumeric) {
            slug += char;
            lastWasDash = false;
            continue;
        }
        if (!lastWasDash) {
            slug += '-';
            lastWasDash = true;
        }
    }

    slug = slug.replace(/^-|-$/g, '');
    return slug || 'theme';
}

function escapeSingleQuotedValue(value: string): string {
    return value.replaceAll(BACKSLASH, ESCAPED_BACKSLASH).replaceAll("'", ESCAPED_SINGLE_QUOTE);
}

function selectorScope(themeId: string): string {
    return `body[data-theme='${escapeSingleQuotedValue(themeId)}']`;
}

function normalizeCssOverrides(cssOverrides: string): string {
    return cssOverrides
        .replaceAll('\r\n', '\n')
        .replaceAll(ESCAPED_CRLF, '\n')
        .replaceAll(ESCAPED_NEWLINE, '\n')
        .replaceAll(ESCAPED_TAB, '\t');
}

function stripComments(css: string): string {
    let output = '';
    let index = 0;
    while (index < css.length) {
        if (css[index] === '/' && css[index + 1] === '*') {
            const commentEnd = css.indexOf('*/', index + 2);
            if (commentEnd === -1) {
                break;
            }
            index = commentEnd + 2;
            continue;
        }
        output += css[index];
        index += 1;
    }
    return output;
}

function readQuoted(css: string, start: number): number {
    const quote = css[start];
    let index = start + 1;
    while (index < css.length) {
        const current = css[index];
        if (current === '\\') {
            index += 2;
            continue;
        }
        if (current === quote) {
            return index;
        }
        index += 1;
    }
    throw new Error('Unterminated string literal in CSS overrides.');
}

function findNextBrace(css: string, start: number, target: '{' | '}'): number {
    let round = 0;
    let square = 0;
    let index = start;
    while (index < css.length) {
        const current = css[index];
        if (current === '"' || current === '\'') {
            index = readQuoted(css, index);
        } else if (current === '(') {
            round += 1;
        } else if (current === ')') {
            round = Math.max(0, round - 1);
        } else if (current === '[') {
            square += 1;
        } else if (current === ']') {
            square = Math.max(0, square - 1);
        } else if (round === 0 && square === 0 && current === target) {
            return index;
        }
        index += 1;
    }
    return -1;
}

function extractBlock(css: string, openBraceIndex: number): { body: string; nextIndex: number } {
    let depth = 0;
    let index = openBraceIndex;
    while (index < css.length) {
        const current = css[index];
        if (current === '"' || current === '\'') {
            index = readQuoted(css, index);
        } else if (current === '{') {
            depth += 1;
        } else if (current === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    body: css.slice(openBraceIndex + 1, index),
                    nextIndex: index + 1,
                };
            }
        }
        index += 1;
    }
    throw new Error('Unbalanced braces in CSS overrides.');
}

function splitSelectors(selectorText: string): string[] {
    const selectors: string[] = [];
    let start = 0;
    let round = 0;
    let square = 0;
    let index = 0;
    while (index < selectorText.length) {
        const current = selectorText[index];
        if (current === '"' || current === '\'') {
            index = readQuoted(selectorText, index);
        } else if (current === '(') round += 1;
        else if (current === ')') round = Math.max(0, round - 1);
        else if (current === '[') square += 1;
        else if (current === ']') square = Math.max(0, square - 1);
        else if (current === ',' && round === 0 && square === 0) {
            selectors.push(selectorText.slice(start, index));
            start = index + 1;
        }
        index += 1;
    }
    selectors.push(selectorText.slice(start));
    return selectors;
}

function scopeSelector(selector: string, themeId: string): string {
    const trimmed = selector.trim();
    if (!trimmed) return selectorScope(themeId);

    const scope = selectorScope(themeId);
    if (trimmed.includes(':root')) {
        return trimmed.replaceAll(':root', scope);
    }
    const bodyMatch = /^body\b/i.exec(trimmed);
    if (bodyMatch) {
        return `${scope}${trimmed.slice(bodyMatch[0].length)}`;
    }
    return `${scope} ${trimmed}`;
}

function scopeQualifiedRule(css: string, index: number, themeId: string): { css: string; nextIndex: number } {
    const braceIndex = findNextBrace(css, index, '{');
    if (braceIndex === -1) {
        return { css: '', nextIndex: css.length };
    }

    const selectorText = css.slice(index, braceIndex).trim();
    const { body, nextIndex } = extractBlock(css, braceIndex);
    const scopedSelectors = splitSelectors(selectorText)
        .map(part => scopeSelector(part, themeId))
        .join(', ');
    return {
        css: `${scopedSelectors}{${body}}`,
        nextIndex,
    };
}

function scopeAtRule(css: string, index: number, themeId: string): { css: string; nextIndex: number } {
    const braceIndex = findNextBrace(css, index, '{');
    if (braceIndex === -1) {
        throw new Error('Unsupported CSS at-rule in overrides.');
    }

    const prelude = css.slice(index, braceIndex).trim();
    const { body, nextIndex } = extractBlock(css, braceIndex);
    if (/^@keyframes\b/i.test(prelude)) {
        return { css: `${prelude}{${body}}`, nextIndex };
    }
    if (/^@(media|supports|layer)\b/i.test(prelude)) {
        return { css: `${prelude}{${scopeCssOverrides(body, themeId)}}`, nextIndex };
    }
    throw new Error('Unsupported CSS at-rule in overrides.');
}

function scopeCssOverrides(cssOverrides: string, themeId: string): string {
    const css = stripComments(cssOverrides).trim();
    if (!css) return '';

    let output = '';
    let index = 0;
    while (index < css.length) {
        const current = css[index];
        if (/\s/.test(current)) {
            output += current;
            index += 1;
            continue;
        }

        const scopedRule = current === '@'
            ? scopeAtRule(css, index, themeId)
            : scopeQualifiedRule(css, index, themeId);
        output += scopedRule.css;
        index = scopedRule.nextIndex;
    }

    return output.trim();
}

function validateCssOverrides(cssOverrides: string | undefined, themeId: string): string | undefined {
    if (!cssOverrides) return undefined;
    const trimmed = normalizeCssOverrides(cssOverrides).trim();
    if (!trimmed) return undefined;
    for (const pattern of UNSAFE_CSS_PATTERNS) {
        if (pattern.test(trimmed)) {
            throw new Error('Theme pack CSS overrides contain an unsupported construct.');
        }
    }
    scopeCssOverrides(trimmed, themeId);
    return trimmed;
}

function validateVariables(input: unknown): ThemeVariables {
    if (!isRecord(input)) {
        throw new Error('Theme pack variables must be an object.');
    }

    return normalizeThemeVariables(input, 'Theme pack');
}

export function validateThemePack(raw: unknown): ThemePackV1 {
    if (!isRecord(raw)) {
        throw new Error('Theme pack must be a JSON object.');
    }

    const version = raw.version;
    if (version !== 1) {
        throw new Error('Unsupported theme pack version.');
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || !SAFE_THEME_ID.test(id)) {
        throw new Error('Theme pack id must use only letters, numbers, colons, underscores, and hyphens.');
    }
    if (BUILTIN_THEME_ID_SET.has(id)) {
        throw new Error('Theme pack id is reserved by a built-in theme.');
    }

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) {
        throw new Error('Theme pack name is required.');
    }

    const background = validateThemeBackground(raw.background);
    const fonts = validateThemeFonts(raw.fonts);
    const typography = validateThemeTypography(raw.typography);
    return {
        version,
        id,
        name,
        variables: validateVariables(raw.variables),
        cssOverrides: validateCssOverrides(typeof raw.cssOverrides === 'string' ? raw.cssOverrides : undefined, id),
        background,
        fonts,
        typography,
    };
}

export function parseThemePackText(content: string): ThemePackV1 {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error('Theme pack file is not valid JSON.');
    }
    return validateThemePack(parsed);
}

export function parseStoredCustomThemes(raw: string | null): ThemePackV1[] {
    if (!raw || raw.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        const themeMap = new Map<string, ThemePackV1>();
        for (const entry of parsed) {
            try {
                const validated = validateThemePack(entry);
                themeMap.set(validated.id, validated);
            } catch (error) {
                Logger.warn('[kechimochi] Skipping invalid cached custom theme', error);
            }
        }

        return [...themeMap.values()].sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
        Logger.warn('[kechimochi] Failed to parse cached custom themes', error);
        return [];
    }
}

export function parseManagedThemePacks(contents: string[]): ThemePackV1[] {
    const themeMap = new Map<string, ThemePackV1>();
    for (const content of contents) {
        try {
            const validated = parseThemePackText(content);
            themeMap.set(validated.id, validated);
        } catch (error) {
            Logger.warn('[kechimochi] Skipping invalid managed custom theme', error);
        }
    }

    return [...themeMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function serializeCustomThemes(themes: ThemePackV1[]): string {
    return JSON.stringify(themes, null, 2);
}

export function getThemeDefinition(themeId: string, customThemes: ThemePackV1[]): ThemeDefinition | null {
    const builtIn = BUILTIN_THEME_MAP.get(themeId);
    if (builtIn) return builtIn;

    const customTheme = customThemes.find(theme => theme.id === themeId);
    return customTheme ? { ...customTheme, builtIn: false } : null;
}

export function getThemeOptions(customThemes: Array<Pick<ThemePackV1, 'id' | 'name'>>): { builtIn: ThemeOption[]; custom: ThemeOption[] } {
    return {
        builtIn: BUILTIN_THEMES,
        custom: customThemes
            .map(theme => ({ ...theme, builtIn: false }))
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

export function isBuiltInTheme(themeId: string): boolean {
    return BUILTIN_THEME_ID_SET.has(themeId);
}

export function resolveThemeSelection(themeId: string, customThemes: ThemePackV1[]): string {
    return getThemeDefinition(themeId, customThemes)?.id ?? DEFAULTS.THEME;
}

export function upsertCustomTheme(existingThemes: ThemePackV1[], theme: ThemePackV1): ThemePackV1[] {
    const themeMap = new Map(existingThemes.map(entry => [entry.id, entry]));
    themeMap.set(theme.id, theme);
    return [...themeMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function removeCustomTheme(existingThemes: ThemePackV1[], themeId: string): ThemePackV1[] {
    return existingThemes.filter(theme => theme.id !== themeId);
}

function escapeCssUrl(value: string): string {
    return value.replaceAll(BACKSLASH, '/').replaceAll("'", ESCAPED_SINGLE_QUOTE);
}

function buildFontFaceCss(theme: ThemePackV1): string {
    if (!theme.fonts || theme.fonts.length === 0) return '';

    return theme.fonts.map(font => {
        const formatPart = font.format ? ` format('${escapeSingleQuotedValue(font.format)}')` : '';
        return [
            '@font-face {',
            `  font-family: '${escapeSingleQuotedValue(font.family)}';`,
            `  src: url('${escapeCssUrl(font.src)}')${formatPart};`,
            `  font-weight: ${font.weight || 'normal'};`,
            `  font-style: ${font.style || 'normal'};`,
            '  font-display: swap;',
            '}',
        ].join('\n');
    }).join('\n');
}

function buildVariableCss(theme: ThemePackV1): string {
    const declarations = THEME_VARIABLE_DESCRIPTORS
        .map((descriptor: ThemeVariableDescriptor) => `  --${descriptor.cssVar}: ${theme.variables[descriptor.key]};`)
        .join('\n');
    return `${selectorScope(theme.id)} {\n${declarations}\n}\n`;
}

function buildTypographyCss(theme: ThemePackV1): string {
    if (!theme.typography) return '';

    const scope = selectorScope(theme.id);
    const cssParts: string[] = [];

    if (theme.typography.body_family) {
        cssParts.push(`${scope}{font-family:${theme.typography.body_family};}`);
    }
    if (theme.typography.heading_family) {
        cssParts.push(`${scope} h1,${scope} h2,${scope} h3,${scope} h4,${scope} h5,${scope} h6{font-family:${theme.typography.heading_family};}`);
    }
    if (theme.typography.monospace_family) {
        cssParts.push(`${scope} code,${scope} pre,${scope} kbd,${scope} samp{font-family:${theme.typography.monospace_family};}`);
    }

    return cssParts.join('\n');
}

export function buildCustomThemeStyles(themes: ThemePackV1[]): string {
    return themes.map(theme => {
        const cssParts = [buildFontFaceCss(theme), buildVariableCss(theme), buildTypographyCss(theme)].filter(Boolean);
        if (theme.cssOverrides) {
            cssParts.push(scopeCssOverrides(theme.cssOverrides, theme.id));
        }
        return cssParts.join('\n');
    }).join('\n');
}

function shouldResolveThemeAssetReference(value: string): boolean {
    return !isAbsoluteThemeAssetReference(value);
}

async function resolveThemeAssetReference(themeId: string, value: string, resolver?: ThemeAssetResolver): Promise<string> {
    if (!resolver || !shouldResolveThemeAssetReference(value)) {
        return value;
    }

    const resolved = await resolver(themeId, value);
    return resolved || value;
}

export async function resolveThemePackAssets(theme: ThemePackV1, resolver?: ThemeAssetResolver): Promise<ThemePackV1> {
    if (!resolver) {
        return theme;
    }

    const resolvedBackground = theme.background
        ? {
            ...theme.background,
            src: await resolveThemeAssetReference(theme.id, theme.background.src, resolver),
            poster: theme.background.poster
                ? await resolveThemeAssetReference(theme.id, theme.background.poster, resolver)
                : undefined,
        }
        : undefined;

    const resolvedFonts = theme.fonts
        ? await Promise.all(theme.fonts.map(async (font) => ({
            ...font,
            src: await resolveThemeAssetReference(theme.id, font.src, resolver),
        })))
        : undefined;

    return {
        ...theme,
        background: resolvedBackground,
        fonts: resolvedFonts,
    };
}

function ensureStyleElement(doc: Document): HTMLStyleElement {
    const existing = doc.getElementById(CUSTOM_THEME_STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
        return existing;
    }

    const style = doc.createElement('style');
    style.id = CUSTOM_THEME_STYLE_ID;
    (doc.head || doc.body || doc.documentElement).appendChild(style);
    return style;
}

export function syncThemeStyles(customThemes: ThemePackV1[], doc: Document = document): void {
    const style = ensureStyleElement(doc);
    style.textContent = buildCustomThemeStyles(customThemes);
}

function getBackdropRoot(doc: Document): HTMLElement {
    return doc.body || doc.documentElement;
}

function getBackdropForegroundRoot(doc: Document): HTMLElement | null {
    const appRoot = doc.getElementById('app');
    return appRoot instanceof HTMLElement ? appRoot : null;
}

function ensureBackdropElement(doc: Document): HTMLDivElement {
    const existing = doc.getElementById(CUSTOM_THEME_BACKDROP_ID);
    if (existing instanceof HTMLDivElement) {
        return existing;
    }

    const root = getBackdropRoot(doc);

    const backdrop = doc.createElement('div');
    backdrop.id = CUSTOM_THEME_BACKDROP_ID;
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.overflow = 'hidden';
    backdrop.style.pointerEvents = 'none';
    backdrop.style.zIndex = '0';
    backdrop.style.display = 'none';
    root.prepend(backdrop);
    return backdrop;
}

function syncBackdropLayering(doc: Document): void {
    const appRoot = getBackdropForegroundRoot(doc);
    if (!(appRoot instanceof HTMLElement)) {
        return;
    }

    if (!appRoot.style.position) {
        appRoot.dataset[THEME_BACKDROP_MANAGED_APP_POSITION] = 'true';
        appRoot.style.position = 'relative';
    }
    if (!appRoot.style.zIndex) {
        appRoot.dataset[THEME_BACKDROP_MANAGED_APP_Z_INDEX] = 'true';
        appRoot.style.zIndex = '1';
    }
}

function clearBackdropElement(doc: Document): void {
    const existing = doc.getElementById(CUSTOM_THEME_BACKDROP_ID);

    if (existing instanceof HTMLDivElement) {
        existing.remove();
    }

    const appRoot = getBackdropForegroundRoot(doc);
    if (!(appRoot instanceof HTMLElement)) {
        return;
    }

    if (appRoot.dataset[THEME_BACKDROP_MANAGED_APP_POSITION] === 'true') {
        appRoot.style.position = '';
        delete appRoot.dataset[THEME_BACKDROP_MANAGED_APP_POSITION];
    }

    if (appRoot.dataset[THEME_BACKDROP_MANAGED_APP_Z_INDEX] === 'true') {
        appRoot.style.zIndex = '';
        delete appRoot.dataset[THEME_BACKDROP_MANAGED_APP_Z_INDEX];
    }
}

function prefersReducedMotion(doc: Document): boolean {
    return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function buildBackgroundLayer(doc: Document, background: ThemeBackgroundDefinition): HTMLElement {
    const layer = background.type === 'video' ? doc.createElement('video') : doc.createElement('div');
    const opacity = background.opacity ?? 1;
    const blurPx = background.blur_px ?? 0;
    const fit = background.fit || 'cover';

    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.width = '100%';
    layer.style.height = '100%';
    layer.style.opacity = String(opacity);
    layer.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    layer.style.transform = blurPx > 0 ? 'scale(1.03)' : 'none';

    if (layer instanceof HTMLVideoElement) {
        layer.autoplay = !prefersReducedMotion(doc);
        layer.loop = background.loop ?? true;
        layer.muted = background.muted ?? true;
        layer.defaultMuted = background.muted ?? true;
        layer.playsInline = true;
        layer.preload = 'auto';
        layer.setAttribute('muted', '');
        layer.setAttribute('playsinline', '');
        if (layer.autoplay) {
            layer.setAttribute('autoplay', '');
        }
        if (layer.loop) {
            layer.setAttribute('loop', '');
        }
        layer.src = background.src;
        layer.poster = background.poster || '';
        layer.playbackRate = background.playback_rate ?? 1;
        layer.style.objectFit = fit;
        layer.style.objectPosition = 'center center';
    } else {
        layer.style.backgroundImage = `url('${escapeCssUrl(background.src)}')`;
        layer.style.backgroundPosition = 'center center';
        layer.style.backgroundRepeat = 'no-repeat';
        layer.style.backgroundSize = fit === 'fill' ? '100% 100%' : fit;
    }

    return layer;
}

function syncThemeBackdrop(theme: ThemePackV1 | null, doc: Document = document): void {
    if (!theme?.background) {
        clearBackdropElement(doc);
        return;
    }

    const backdrop = ensureBackdropElement(doc);
    backdrop.replaceChildren();
    backdrop.style.display = 'block';
    syncBackdropLayering(doc);

    const usePosterFallback = theme.background.type === 'video' && prefersReducedMotion(doc) && theme.background.poster;
    const background: ThemeBackgroundDefinition = usePosterFallback
        ? { ...theme.background, type: 'image', src: theme.background.poster! }
        : theme.background;

    const layer = buildBackgroundLayer(doc, background);
    backdrop.appendChild(layer);

    if (layer instanceof HTMLVideoElement && layer.autoplay) {
        queueMicrotask(() => {
            void layer.play().catch(() => undefined);
        });
    }
}

export function applyTheme(themeId: string, customThemes: ThemePackV1[], doc: Document = document): string {
    syncThemeStyles(customThemes, doc);
    const resolvedTheme = resolveThemeSelection(themeId, customThemes);
    doc.body.dataset.theme = resolvedTheme;
    syncThemeBackdrop(getThemeDefinition(resolvedTheme, customThemes), doc);
    return resolvedTheme;
}

export function writeThemeCache(themeId: string, _customThemes: ThemePackV1[], storage: Storage = localStorage): void {
    if (typeof storage.removeItem === 'function') {
        storage.removeItem(STORAGE_KEYS.CUSTOM_THEMES_CACHE);
    }

    storage.setItem(STORAGE_KEYS.THEME_CACHE, themeId);
}

export function hydrateThemeRuntimeFromCache(storage: Storage = localStorage, doc: Document = document): boolean {
    const cachedTheme = storage.getItem(STORAGE_KEYS.THEME_CACHE) || DEFAULTS.THEME;
    if (isBuiltInTheme(cachedTheme)) {
        syncThemeStyles([], doc);
        doc.body.dataset.theme = cachedTheme;
        syncThemeBackdrop(null, doc);
        return true;
    }

    syncThemeStyles([], doc);
    doc.body.dataset.theme = DEFAULTS.THEME;
    syncThemeBackdrop(null, doc);
    return false;
}

export function createExportableThemePack(themeId: string, customThemes: ThemePackV1[]): ThemePackV1 {
    const theme = getThemeDefinition(themeId, customThemes);
    if (!theme) {
        throw new Error('Theme could not be found for export.');
    }

    if (!theme.builtIn) {
        return {
            version: theme.version,
            id: theme.id,
            name: theme.name,
            variables: { ...theme.variables },
            cssOverrides: theme.cssOverrides || '',
            background: theme.background ? { ...theme.background } : undefined,
            fonts: theme.fonts?.map(font => ({ ...font })),
            typography: theme.typography ? { ...theme.typography } : undefined,

        };
    }

    return {
        version: 1,
        id: `${BUILTIN_EXPORT_PREFIX}${theme.id}`,
        name: `${theme.name} Custom`,
        variables: { ...theme.variables },
        cssOverrides: '',
    };
}

export function getThemePackFilename(themePack: ThemePackV1, hasAssets = false): string {
    const extension = hasAssets ? 'zip' : 'json';
    return `kechimochi_theme_${slugifyThemeName(themePack.name)}.${extension}`;
}

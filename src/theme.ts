import { STORAGE_KEYS, DEFAULTS } from './constants';

export function isThemeOverrideEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED) === '1';
}

export function getThemeOverrideValue(): string {
    return localStorage.getItem(STORAGE_KEYS.THEME_OVERRIDE) || DEFAULTS.THEME;
}

export function setThemeOverrideEnabled(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, enabled ? '1' : '0');
}

export function setThemeOverrideValue(theme: string): void {
    localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE, theme);
}

/** Returns the theme that should actually be displayed, given the synced value. */
export function resolveEffectiveTheme(syncedTheme: string): string {
    return isThemeOverrideEnabled() ? getThemeOverrideValue() : syncedTheme;
}

/** Applies a theme to the DOM and updates the boot cache. */
export function applyTheme(theme: string): void {
    document.body.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.THEME_CACHE, theme);
}
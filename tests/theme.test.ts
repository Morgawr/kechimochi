import { describe, it, expect, beforeEach } from 'vitest';
import {
    isThemeOverrideEnabled,
    getThemeOverrideValue,
    setThemeOverrideEnabled,
    setThemeOverrideValue,
    resolveEffectiveTheme,
    applyTheme,
} from '../src/theme';
import { STORAGE_KEYS, DEFAULTS } from '../src/constants';

describe('theme helpers', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.body.dataset.theme;
    });

    describe('isThemeOverrideEnabled', () => {
        it('returns false when no flag is set', () => {
            expect(isThemeOverrideEnabled()).toBe(false);
        });

        it("returns true when flag is '1'", () => {
            localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, '1');
            expect(isThemeOverrideEnabled()).toBe(true);
        });

        it("returns false when flag is '0' or any other value", () => {
            localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, '0');
            expect(isThemeOverrideEnabled()).toBe(false);

            localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, 'true');
            expect(isThemeOverrideEnabled()).toBe(false);
        });
    });

    describe('getThemeOverrideValue', () => {
        it('returns the default theme when no override is stored', () => {
            expect(getThemeOverrideValue()).toBe(DEFAULTS.THEME);
        });

        it('returns the stored override value when present', () => {
            localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE, 'molokai');
            expect(getThemeOverrideValue()).toBe('molokai');
        });
    });

    describe('setters', () => {
        it('setThemeOverrideEnabled writes the flag', () => {
            setThemeOverrideEnabled(true);
            expect(localStorage.getItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED)).toBe('1');

            setThemeOverrideEnabled(false);
            expect(localStorage.getItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED)).toBe('0');
        });

        it('setThemeOverrideValue writes the theme name', () => {
            setThemeOverrideValue('dark');
            expect(localStorage.getItem(STORAGE_KEYS.THEME_OVERRIDE)).toBe('dark');
        });
    });

    describe('resolveEffectiveTheme', () => {
        it('returns the synced theme when override is disabled', () => {
            expect(resolveEffectiveTheme('purple')).toBe('purple');
        });

        it('returns the override value when override is enabled', () => {
            setThemeOverrideEnabled(true);
            setThemeOverrideValue('dark');
            expect(resolveEffectiveTheme('purple')).toBe('dark');
        });

        it('falls back to default when override is enabled but no value stored', () => {
            setThemeOverrideEnabled(true);
            expect(resolveEffectiveTheme('purple')).toBe(DEFAULTS.THEME);
        });
    });

    describe('applyTheme', () => {
        it('sets body data-theme and updates the cache', () => {
            applyTheme('molokai');
            expect(document.body.dataset.theme).toBe('molokai');
            expect(localStorage.getItem(STORAGE_KEYS.THEME_CACHE)).toBe('molokai');
        });
    });
});
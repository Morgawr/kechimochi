import { describe, it, expect, beforeEach } from 'vitest';
import {
    isValidFontChoice,
    getCachedFont,
    getFontOverrideValue,
    setFontOverrideValue,
    resolveEffectiveFont,
    applyFont,
} from '../src/fonts';
import { STORAGE_KEYS, DEFAULTS } from '../src/constants';

describe('font helpers', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.body.dataset.font;
    });

    describe('isValidFontChoice', () => {
        it('accepts every documented font option', () => {
            expect(isValidFontChoice('inter')).toBe(true);
            expect(isValidFontChoice('montserrat')).toBe(true);
            expect(isValidFontChoice('nunito')).toBe(true);
            expect(isValidFontChoice('source-sans-3')).toBe(true);
        });

        it('rejects unknown values', () => {
            expect(isValidFontChoice('comic-sans')).toBe(false);
            expect(isValidFontChoice('')).toBe(false);
        });
    });

    describe('getCachedFont', () => {
        it('returns the default font when nothing is cached', () => {
            expect(getCachedFont()).toBe(DEFAULTS.FONT);
        });

        it('returns the cached font written by applyFont', () => {
            applyFont('source-sans-3');
            expect(getCachedFont()).toBe('source-sans-3');
        });

        it('falls back to the default font when the cache is garbage', () => {
            localStorage.setItem(STORAGE_KEYS.FONT_CACHE, 'comic-sans');
            expect(getCachedFont()).toBe(DEFAULTS.FONT);
        });
    });

    describe('getFontOverrideValue', () => {
        it('returns the default font when no override is stored', () => {
            expect(getFontOverrideValue()).toBe(DEFAULTS.FONT);
        });

        it('returns the stored override value when present', () => {
            localStorage.setItem(STORAGE_KEYS.FONT_OVERRIDE, 'nunito');
            expect(getFontOverrideValue()).toBe('nunito');
        });

        it('falls back to the default font when the stored value is garbage', () => {
            localStorage.setItem(STORAGE_KEYS.FONT_OVERRIDE, 'comic-sans');
            expect(getFontOverrideValue()).toBe(DEFAULTS.FONT);
        });
    });

    describe('setFontOverrideValue', () => {
        it('writes the font name', () => {
            setFontOverrideValue('montserrat');
            expect(localStorage.getItem(STORAGE_KEYS.FONT_OVERRIDE)).toBe('montserrat');
        });
    });

    describe('resolveEffectiveFont', () => {
        it('returns the synced font when the shared override flag is disabled', () => {
            expect(resolveEffectiveFont('source-sans-3')).toBe('source-sans-3');
        });

        it('falls back to the default font when the synced value is garbage', () => {
            expect(resolveEffectiveFont('comic-sans')).toBe(DEFAULTS.FONT);
        });

        it('returns the override value when the shared override flag is enabled', () => {
            localStorage.setItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED, '1');
            setFontOverrideValue('nunito');
            expect(resolveEffectiveFont('montserrat')).toBe('nunito');
        });
    });

    describe('applyFont', () => {
        it('sets body data-font and updates the cache', () => {
            applyFont('montserrat');
            expect(document.body.dataset.font).toBe('montserrat');
            expect(localStorage.getItem(STORAGE_KEYS.FONT_CACHE)).toBe('montserrat');
        });
    });
});
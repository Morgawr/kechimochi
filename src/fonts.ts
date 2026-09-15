import { STORAGE_KEYS, DEFAULTS } from './constants';
import { isThemeOverrideEnabled } from './theme';

export const FONT_OPTIONS = [
    { value: 'inter', label: 'Inter (Default)' },
    { value: 'montserrat', label: 'Montserrat' },
    { value: 'nunito', label: 'Nunito' },
    { value: 'source-sans-3', label: 'Source Sans 3' },
] as const;

export type FontChoice = typeof FONT_OPTIONS[number]['value'];

export function isValidFontChoice(value: string): value is FontChoice {
    return FONT_OPTIONS.some(option => option.value === value);
}

/** The font applied before the synced value has loaded, written by {@link applyFont}. */
export function getCachedFont(): FontChoice {
    const cached = localStorage.getItem(STORAGE_KEYS.FONT_CACHE);
    return cached && isValidFontChoice(cached) ? cached : DEFAULTS.FONT;
}

export function getFontOverrideValue(): FontChoice {
    const stored = localStorage.getItem(STORAGE_KEYS.FONT_OVERRIDE);
    return stored && isValidFontChoice(stored) ? stored : DEFAULTS.FONT;
}

export function setFontOverrideValue(font: FontChoice): void {
    localStorage.setItem(STORAGE_KEYS.FONT_OVERRIDE, font);
}

/** Returns the font that should actually be displayed, given the synced value. */
export function resolveEffectiveFont(syncedFont: string): FontChoice {
    if (isThemeOverrideEnabled()) {
        return getFontOverrideValue();
    }
    return isValidFontChoice(syncedFont) ? syncedFont : DEFAULTS.FONT;
}

/** Applies a font to the DOM and updates the boot cache. */
export function applyFont(font: FontChoice): void {
    document.body.dataset.font = font;
    localStorage.setItem(STORAGE_KEYS.FONT_CACHE, font);
}

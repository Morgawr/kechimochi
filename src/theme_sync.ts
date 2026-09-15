import {Logger} from './logger';
import {STORAGE_KEYS, DEFAULTS} from './constants';

(function() {
    try {
        document.body.dataset.theme = localStorage.getItem(STORAGE_KEYS.THEME_CACHE) || 'pastel-pink';
        document.body.dataset.font = localStorage.getItem(STORAGE_KEYS.FONT_CACHE) || DEFAULTS.FONT;
    } catch (e) {
        Logger?.error?.('Theme sync failed', e);
    }
})();

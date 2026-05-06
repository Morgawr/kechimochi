import {Logger} from './logger';
import {STORAGE_KEYS} from './constants';

(function() {
    try {
        document.body.dataset.theme = localStorage.getItem(STORAGE_KEYS.THEME_CACHE) || 'pastel-pink';
    } catch (e) {
        Logger?.error?.('Theme sync failed', e);
    }
})();

import { Logger } from './core/logger';
import { STORAGE_KEYS } from './constants';

(function() {
    try {
        const theme = localStorage.getItem(STORAGE_KEYS.THEME_CACHE) || 'pastel-pink';
        document.body.dataset.theme = theme;
    } catch (e) {
        Logger?.error?.('Theme sync failed', e);
    }
})();

import { Logger } from './core/logger';
import { hydrateThemeRuntimeFromCache } from './themes';

(function() {
    try {
        hydrateThemeRuntimeFromCache();
    } catch (e) {
        Logger?.error?.('Theme sync failed', e);
    }
})();

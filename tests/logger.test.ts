import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/logger';

describe('Logger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('forwards warning messages to console.warn', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        Logger.warn('heads up', { code: 1 });

        expect(warn).toHaveBeenCalledWith('heads up', { code: 1 });
    });

    it('forwards debug messages in dev builds', () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

        Logger.debug('trace', 123);

        expect(debug).toHaveBeenCalledWith('trace', 123);
    });
});

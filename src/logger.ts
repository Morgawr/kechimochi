/* eslint-disable no-console */

/**
 * Centralized logger to satisfy linter and provide consistent logging.
 */
export const Logger = {
    info: (...args: unknown[]) => {
        console.log(...args);
    },
    error: (...args: unknown[]) => {
        console.error(...args);
    },
    warn: (...args: unknown[]) => {
        console.warn(...args);
    },
    debug: (...args: unknown[]) => {
        if (import.meta.env?.DEV) {
            console.debug(...args);
        }
    }
};

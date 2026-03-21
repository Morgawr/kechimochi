import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerError = vi.fn();

vi.mock('../src/core/logger', () => ({
    Logger: {
        error: loggerError,
    },
}));

describe('theme_sync.ts', () => {
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        vi.resetModules();
        loggerError.mockReset();
        document.body.dataset.theme = '';
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'localStorage', {
            value: originalLocalStorage,
            configurable: true,
        });
    });

    it('applies the cached theme from localStorage on import', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                getItem: vi.fn(() => 'molokai'),
            },
            configurable: true,
        });

        await import('../src/theme_sync');

        expect(document.body.dataset.theme).toBe('molokai');
    });

    it('falls back to pastel-pink when no cached theme exists', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                getItem: vi.fn(() => null),
            },
            configurable: true,
        });

        await import('../src/theme_sync');

        expect(document.body.dataset.theme).toBe('pastel-pink');
    });

    it('logs an error when theme sync throws', async () => {
        const failure = new Error('storage unavailable');
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                getItem: vi.fn(() => {
                    throw failure;
                }),
            },
            configurable: true,
        });

        await import('../src/theme_sync');

        expect(loggerError).toHaveBeenCalledWith('Theme sync failed', failure);
    });
});

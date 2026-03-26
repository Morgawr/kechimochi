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
                getItem: vi.fn((key: string) => {
                    if (key === 'kechimochi_theme') return 'molokai';
                    if (key === 'kechimochi_custom_themes') return 'not-valid-json';
                    return null;
                }),
            },
            configurable: true,
        });

        await import('../src/theme_sync');

        expect(document.body.dataset.theme).toBe('molokai');
        expect(document.getElementById('kechimochi-custom-theme-styles')?.textContent || '').toBe('');
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

    it('hydrates cached custom theme styles on import', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                getItem: vi.fn((key: string) => {
                    if (key === 'kechimochi_theme') return 'custom:test-theme';
                    if (key === 'kechimochi_custom_themes') {
                        return JSON.stringify([{
                            version: 1,
                            id: 'custom:test-theme',
                            name: 'Test Theme',
                            variables: {
                                'bg-dark': '#101010',
                                'bg-card': '#202020',
                                'bg-card-hover': '#303030',
                                'text-primary': '#ffffff',
                                'text-secondary': '#cccccc',
                                'accent-green': '#00ff88',
                                'accent-green-hover': '#22ffaa',
                                'accent-red': '#ff4466',
                                'accent-blue': '#4488ff',
                                'accent-yellow': '#ffdd44',
                                'accent-purple': '#aa66ff',
                                'border-color': '#444444',
                                'shadow-sm': '0 2px 4px rgba(0,0,0,0.2)',
                                'shadow-md': '0 4px 12px rgba(0,0,0,0.4)',
                                'heatmap-hue': '180',
                                'heatmap-sat-base': '40',
                                'heatmap-sat-range': '50',
                                'heatmap-light-base': '45',
                                'heatmap-light-range': '35',
                                'accent-text': '#000000',
                                'chart-1': '#111111',
                                'chart-2': '#222222',
                                'chart-3': '#333333',
                                'chart-4': '#444444',
                                'chart-5': '#555555',
                            },
                            cssOverrides: '.btn { border-radius: 999px; }',
                        }]);
                    }
                    return null;
                }),
            },
            configurable: true,
        });

        await import('../src/theme_sync');

        expect(document.body.dataset.theme).toBe('pastel-pink');
        expect(document.getElementById('kechimochi-custom-theme-styles')?.textContent || '').toBe('');
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

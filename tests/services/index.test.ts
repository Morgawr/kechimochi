import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const desktopFactory = vi.fn(() => ({ kind: 'desktop' }));
const webFactory = vi.fn(() => ({ kind: 'web' }));
const loggerWarn = vi.fn();

vi.mock('../../src/services/desktop', () => ({
    DesktopServices: vi.fn(() => desktopFactory()),
}));

vi.mock('../../src/services/web', () => ({
    WebServices: vi.fn(() => webFactory()),
}));

vi.mock('../../src/logger', () => ({
    Logger: {
        warn: loggerWarn,
    },
}));

describe('services/index.ts', () => {
    const originalLocation = globalThis.location;
    const originalNavigator = globalThis.navigator;
    const envVitest = process.env.VITEST;

    function setRuntime(options: { protocol?: string; origin?: string; userAgent?: string; tauri?: boolean }) {
        Object.defineProperty(globalThis, 'location', {
            value: {
                protocol: options.protocol ?? 'http:',
                origin: options.origin ?? 'http://localhost',
            },
            configurable: true,
        });

        Object.defineProperty(globalThis, 'navigator', {
            value: {
                userAgent: options.userAgent ?? 'Mozilla/5.0',
            },
            configurable: true,
        });

        if (options.tauri) {
            (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
        } else {
            delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
            delete (globalThis as Record<string, unknown>).__TAURI__;
            delete (globalThis as Record<string, unknown>).__TAURI_IPC__;
            delete (globalThis as Record<string, unknown>).__TAURI_INVOKE__;
        }
    }

    beforeEach(() => {
        vi.resetModules();
        desktopFactory.mockClear();
        webFactory.mockClear();
        loggerWarn.mockClear();
        process.env.VITEST = envVitest;
        setRuntime({});
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            configurable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            configurable: true,
        });
        process.env.VITEST = envVitest;
        delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
        delete (globalThis as Record<string, unknown>).__TAURI__;
        delete (globalThis as Record<string, unknown>).__TAURI_IPC__;
        delete (globalThis as Record<string, unknown>).__TAURI_INVOKE__;
    });

    it('lazily returns desktop services during Vitest runtime', async () => {
        const services = await import('../../src/services/index');

        expect(services.getServices()).toEqual({ kind: 'desktop' });
        expect(desktopFactory).toHaveBeenCalledTimes(1);
        expect(webFactory).not.toHaveBeenCalled();
    });

    it('lazily falls back to web services in a clear browser runtime', async () => {
        process.env.VITEST = '';
        setRuntime({ protocol: 'https:', origin: 'https://example.com', userAgent: 'Mozilla/5.0' });

        const services = await import('../../src/services/index');

        expect(services.getServices()).toEqual({ kind: 'web' });
        expect(loggerWarn).toHaveBeenCalledWith('[kechimochi] Services were accessed before init; using web adapter lazily');
        expect(webFactory).toHaveBeenCalledTimes(1);
    });

    it('throws when services are accessed before init in an ambiguous runtime', async () => {
        process.env.VITEST = '';
        setRuntime({ protocol: 'file:', origin: 'file://app', userAgent: 'Mozilla/5.0' });

        const services = await import('../../src/services/index');

        expect(() => services.getServices()).toThrow('[kechimochi] Services have not been initialised.');
        expect(desktopFactory).not.toHaveBeenCalled();
        expect(webFactory).not.toHaveBeenCalled();
    });

    it('initializes desktop services when Tauri globals are present', async () => {
        process.env.VITEST = '';
        setRuntime({ tauri: true, protocol: 'tauri:', origin: 'tauri://localhost' });

        const services = await import('../../src/services/index');
        const result = await services.initServices();

        expect(result).toEqual({ kind: 'desktop' });
        expect(desktopFactory).toHaveBeenCalledTimes(1);
        expect(webFactory).not.toHaveBeenCalled();
    });

    it('initializes web services when desktop runtime is not detected', async () => {
        process.env.VITEST = '';
        setRuntime({ protocol: 'https:', origin: 'https://example.com', userAgent: 'Mozilla/5.0' });

        const services = await import('../../src/services/index');
        const result = await services.initServices();

        expect(result).toEqual({ kind: 'web' });
        expect(loggerWarn).toHaveBeenCalledWith('[kechimochi] Desktop runtime not detected, using web services adapter');
        expect(webFactory).toHaveBeenCalledTimes(1);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../src/constants';

const OriginalDate = globalThis.Date;
const loggerMock = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
};

function stubStorage(options: {
    mockDate?: string | null;
    legacyMockDate?: string | null;
    throwOnRead?: boolean;
} = {}) {
    const { mockDate = null, legacyMockDate = null, throwOnRead = false } = options;

    const sessionGetItem = vi.fn((key: string) => {
        if (throwOnRead) throw new Error('storage unavailable');
        return key === STORAGE_KEYS.MOCK_DATE ? mockDate : null;
    });
    const localGetItem = vi.fn((key: string) => {
        if (throwOnRead) throw new Error('storage unavailable');
        return key === STORAGE_KEYS.MOCK_DATE ? legacyMockDate : null;
    });
    const localRemoveItem = vi.fn();

    vi.stubGlobal('sessionStorage', {
        getItem: sessionGetItem,
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
        getItem: localGetItem,
        setItem: vi.fn(),
        removeItem: localRemoveItem,
        clear: vi.fn(),
    });

    return { sessionGetItem, localGetItem, localRemoveItem };
}

async function importMainWithFailingBootstrap(error: unknown) {
    const domReady = captureDomContentLoaded();
    vi.doMock('../src/logger', () => ({ Logger: loggerMock }));
    vi.doMock('../src/services', () => ({
        initServices: vi.fn(() => Promise.reject(error)),
        getServices: vi.fn(() => ({
            isDesktop: () => true,
            supportsWindowControls: () => true,
        })),
    }));
    vi.doMock('../src/app_shell', () => ({
        syncAppShell: vi.fn(),
    }));

    await import('../src/main');
    domReady.restore();
    domReady.run();
}

function captureDomContentLoaded() {
    let listener: EventListener | null = null;
    const originalAddEventListener = document.addEventListener.bind(document);
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, callback, options) => {
        if (type === 'DOMContentLoaded') {
            listener = callback as EventListener;
            return;
        }
        originalAddEventListener(type, callback, options);
    });

    return {
        restore: () => addEventListenerSpy.mockRestore(),
        run: () => listener?.(new Event('DOMContentLoaded')),
    };
}

describe('main.ts bootstrap side effects', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="app"></div>';
        globalThis.Date = OriginalDate;
        stubStorage();
    });

    afterEach(() => {
        globalThis.Date = OriginalDate;
        vi.unstubAllGlobals();
        vi.doUnmock('../src/logger');
        vi.doUnmock('../src/services');
        vi.doUnmock('../src/app_shell');
    });

    it('installs a mocked Date from session storage and clears the legacy key', async () => {
        const storage = stubStorage({
            mockDate: '2026-01-02',
            legacyMockDate: '2025-12-31',
        });
        const domReady = captureDomContentLoaded();

        await import('../src/main');
        domReady.restore();

        expect(storage.localRemoveItem).toHaveBeenCalledWith(STORAGE_KEYS.MOCK_DATE);
        expect(new Date().toISOString()).toBe('2026-01-02T12:00:00.000Z');
        expect(Date.now()).toBe(new OriginalDate('2026-01-02T12:00:00Z').getTime());
        expect(new Date('2020-03-04T00:00:00Z').toISOString()).toBe('2020-03-04T00:00:00.000Z');
    });

    it('logs and continues when mock-date storage cannot be read', async () => {
        vi.doMock('../src/logger', () => ({ Logger: loggerMock }));
        stubStorage({ throwOnRead: true });
        const domReady = captureDomContentLoaded();

        await import('../src/main');
        domReady.restore();

        expect(loggerMock.warn).toHaveBeenCalledWith(
            '[kechimochi] Failed to access storage for mock date:',
            expect.any(Error),
        );
    });

    it('renders a generic bootstrap failure screen from DOMContentLoaded startup errors', async () => {
        await importMainWithFailingBootstrap(new Error('renderer failed'));

        await vi.waitFor(() => expect(document.getElementById('alert-body')?.textContent).toContain(
            'Kechimochi failed to finish startup.',
        ));
        expect(document.getElementById('alert-body')?.textContent).toContain('renderer failed');
        expect(loggerMock.error).toHaveBeenCalledWith('Failed to start application:', expect.any(Error));
    });

    it('renders the unsupported schema bootstrap failure with upgrade guidance', async () => {
        const blurSpy = vi.spyOn(HTMLButtonElement.prototype, 'blur').mockImplementation(() => {});
        await importMainWithFailingBootstrap(new Error('Database schema version 3 is newer than this app supports (2)'));

        await vi.waitFor(() => expect(document.getElementById('alert-body')?.textContent).toContain(
            'Use a newer version of the app that supports this database schema.',
        ));

        document.getElementById('alert-ok')?.dispatchEvent(new Event('click'));
        expect(blurSpy).toHaveBeenCalled();
        blurSpy.mockRestore();
    });

    it('does not replace an existing startup error screen during bootstrap failure handling', async () => {
        document.body.innerHTML = '<div id="app"><p id="alert-body">Existing startup error</p></div>';

        await importMainWithFailingBootstrap(new Error('renderer failed'));

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(document.getElementById('alert-body')?.textContent).toBe('Existing startup error');
    });
});

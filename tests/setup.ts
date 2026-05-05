import { beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

function createMemoryStorage(): Storage {
    const store = new Map<string, string>();

    return {
        get length() {
            return store.size;
        },
        clear() {
            store.clear();
        },
        getItem(key: string) {
            return store.get(key) ?? null;
        },
        key(index: number) {
            return Array.from(store.keys())[index] ?? null;
        },
        removeItem(key: string) {
            store.delete(key);
        },
        setItem(key: string, value: string) {
            store.set(key, String(value));
        },
    };
}

function isUsableStorage(storage: unknown): storage is Storage {
    if (!storage || typeof storage !== 'object') {
        return false;
    }

    const candidate = storage as Partial<Storage>;
    return typeof candidate.clear === 'function'
        && typeof candidate.getItem === 'function'
        && typeof candidate.key === 'function'
        && typeof candidate.removeItem === 'function'
        && typeof candidate.setItem === 'function';
}

const fallbackLocalStorage = createMemoryStorage();

function getDefinedLocalStorage(): Storage | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    if (!descriptor || !('value' in descriptor)) {
        return undefined;
    }

    return descriptor.value as Storage;
}

function ensureUsableLocalStorage(): void {
    if (isUsableStorage(getDefinedLocalStorage())) {
        return;
    }

    Object.defineProperty(globalThis, 'localStorage', {
        value: fallbackLocalStorage,
        configurable: true,
        writable: true,
    });
}

ensureUsableLocalStorage();

beforeEach(() => {
    ensureUsableLocalStorage();
    localStorage.clear();

    const globals = globalThis as Record<string, unknown>;
    globals.__APP_VERSION__ = '0.1.0-dev.test';
    globals.__APP_BUILD_CHANNEL__ = 'dev';
    globals.__APP_RELEASE_STAGE__ = 'beta';
    globals.__APP_RELEASE_NOTES__ = '## [0.1.0] - 2026-03-24\n\n### Added\n- Bundled notes';
    globals.__APP_RELEASES_URL__ = 'https://github.com/Morgawr/kechimochi/releases';
});

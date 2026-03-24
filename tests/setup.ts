import { beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

beforeEach(() => {
    const globals = globalThis as Record<string, unknown>;
    globals.__APP_VERSION__ = '0.1.0-dev.test';
    globals.__APP_BUILD_CHANNEL__ = 'dev';
    globals.__APP_RELEASE_STAGE__ = 'beta';
    globals.__APP_RELEASE_NOTES__ = '## [0.1.0] - 2026-03-24\n\n### Added\n- Bundled notes';
    globals.__APP_RELEASES_URL__ = 'https://github.com/Morgawr/kechimochi/releases';
});

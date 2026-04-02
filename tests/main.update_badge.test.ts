import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import * as modals from '../src/modals';
import type { UpdateState } from '../src/types';
import {
    renderMainAppShell,
    resetMainApiMocks,
    resetMainModalMocks,
    setBuildGlobals,
    stubMainStorage,
} from './helpers/main_harness';

vi.mock('../src/api', async () => {
    const { createMainApiMock } = await import('./helpers/main_harness');
    return createMainApiMock();
});

vi.mock('../src/modals', async () => {
    const { createMainModalMock } = await import('./helpers/main_harness');
    return createMainModalMock();
});

vi.mock('chart.js/auto', async () => {
    const { createChartJsAutoMock } = await import('./helpers/main_harness');
    return createChartJsAutoMock();
});

describe('App update badge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetMainApiMocks(api);
        resetMainModalMocks(modals);
        setBuildGlobals('1.0.0', 'release', 'beta');
        renderMainAppShell();
        stubMainStorage();
    });

    it('shows the update badge and opens the update modal when clicked', async () => {
        const { App } = await import('../src/main');
        const visibleState: UpdateState = {
            checking: false,
            autoCheckEnabled: true,
            availableRelease: {
                version: '1.0.1',
                body: '## [1.0.1]',
                url: 'https://example.com',
                publishedAt: '',
                prerelease: false,
            },
            installedVersion: '1.0.0',
            isSupported: true,
        };
        const manager = {
            getState: vi.fn(() => visibleState),
            subscribe: vi.fn((cb: (state: UpdateState) => void) => {
                cb(visibleState);
                return vi.fn();
            }),
            initialize: vi.fn(() => Promise.resolve()),
            openAvailableUpdateModal: vi.fn(() => Promise.resolve()),
        };

        await App.start(manager as never);

        const badge = document.getElementById('update-available-badge') as HTMLButtonElement;
        expect(badge.style.display).toBe('inline-flex');
        expect(badge.textContent).toContain('1.0.1');

        badge.click();
        expect(manager.openAvailableUpdateModal).toHaveBeenCalled();
        expect(api.initializeUserDb).toHaveBeenCalled();
    });
});

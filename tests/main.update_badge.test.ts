import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import type { UpdateState } from '../src/types';
import {
    getMainModalMock,
    renderMainAppShell,
    resetMainApiMocks,
    resetMainModalMocks,
    setBuildGlobals,
    stubMainStorage,
} from './helpers/main_harness';

const modals = getMainModalMock();

vi.mock('../src/api', async () => {
    const { createMainApiMock } = await import('./helpers/main_harness');
    return createMainApiMock();
});

vi.mock('../src/modal_base', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        customAlert: mocks.customAlert,
        customConfirm: mocks.customConfirm,
        customPrompt: mocks.customPrompt,
        showBlockingStatus: mocks.showBlockingStatus,
    };
});

vi.mock('../src/profile/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showInitialSetupPrompt: mocks.showInitialSetupPrompt,
    };
});

vi.mock('../src/activity_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showLogActivityModal: mocks.showLogActivityModal,
    };
});

vi.mock('../src/media/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showAddMediaModal: mocks.showAddMediaModal,
        showImportMergeModal: mocks.showImportMergeModal,
        showJitenSearchModal: mocks.showJitenSearchModal,
        showMediaCsvConflictModal: mocks.showMediaCsvConflictModal,
    };
});

vi.mock('../src/milestone_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showAddMilestoneModal: mocks.showAddMilestoneModal,
    };
});

vi.mock('../src/sync_modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showSyncEnablementWizard: mocks.showSyncEnablementWizard,
        showSyncAttachPreview: mocks.showSyncAttachPreview,
    };
});

vi.mock('../src/update/modal', async () => {
    const { getMainModalMock } = await import('./helpers/main_harness');
    const mocks = getMainModalMock();
    return {
        showInstalledUpdateModal: mocks.showInstalledUpdateModal,
        showAvailableUpdateModal: mocks.showAvailableUpdateModal,
    };
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

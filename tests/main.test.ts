import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '../src/api';
import type { ActivitySummary } from '../src/api';
import * as modals from '../src/modals';

const mockWindow = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    toggleMaximize: vi.fn(),
};

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => mockWindow),
}));

vi.mock('chart.js/auto', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            destroy: vi.fn(),
            update: vi.fn()
        }))
    }
});

vi.mock('../src/api', () => ({
    switchProfile: vi.fn(),
    listProfiles: vi.fn(() => Promise.resolve(['test-user'])),
    getUsername: vi.fn(() => Promise.resolve('os-user')),
    getSetting: vi.fn((key) => {
        if (key === 'theme') return Promise.resolve('dark');
        return Promise.resolve(null);
    }),
    getLogs: vi.fn(() => Promise.resolve([{ id: 0, date: '2024-01-01', duration_minutes: 0, title: 'T', media_id: 1, media_type: 'M', language: 'J' } as ActivitySummary])),
    getAllMedia: vi.fn(() => Promise.resolve([])),
    getHeatmap: vi.fn(() => Promise.resolve([{ date: '2024-01-01', total_minutes: 10 }])),
    getMilestones: vi.fn(() => Promise.resolve([])),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
    deleteProfile: vi.fn(),
    clearMilestones: vi.fn(),
    deleteMilestone: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../src/modals', () => ({
    initialProfilePrompt: vi.fn(() => Promise.resolve('new-user')),
    customAlert: vi.fn(),
    customConfirm: vi.fn(),
    customPrompt: vi.fn(),
    showLogActivityModal: vi.fn(),
}));

describe('main.ts initialization', () => {
    const bootApp = async () => {
        await import('../src/main');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(() => expect(api.listProfiles).toHaveBeenCalled());
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        
        document.body.innerHTML = `
            <div id="view-container"></div>
            <select id="select-profile"></select>
            <div id="dev-build-badge"></div>
            <div class="nav-link" data-view="dashboard"></div>
            <div class="nav-link" data-view="media"></div>
            <div class="nav-link" data-view="profile"></div>
            <button id="win-min"></button>
            <button id="win-max"></button>
            <button id="win-close"></button>
            <button id="btn-add-profile"></button>
            <button id="btn-delete-profile"></button>
            <button id="btn-add-activity"></button>
        `;
        
        // Mock localStorage
        const store: Record<string, string> = { 'kechimochi_profile': 'test-user' };
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(key => store[key] || null),
            setItem: vi.fn((key, val) => store[key] = val),
        });
        
        vi.stubGlobal('sessionStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(() => {}),
        });
    });

    it('should initialize the App', async () => {
        await bootApp();
        expect(localStorage.getItem).toHaveBeenCalled();
    });

    it('should handle adding a profile', async () => {
        await bootApp();
        
        vi.mocked(api.switchProfile).mockResolvedValue();
        vi.mocked(modals.customPrompt).mockResolvedValue('new-user');
        
        const addBtn = document.getElementById('btn-add-profile');
        addBtn?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(modals.customPrompt).toHaveBeenCalled());
        expect(api.switchProfile).toHaveBeenCalledWith('new-user');
    });

    it('should handle deleting a profile', async () => {
        await bootApp();

        vi.mocked(api.listProfiles).mockResolvedValue(['user1', 'user2']);
        vi.mocked(modals.customConfirm).mockResolvedValue(true);
        
        const deleteBtn = document.getElementById('btn-delete-profile');
        deleteBtn?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(api.deleteProfile).toHaveBeenCalled());
    });

    it('should switch views', async () => {
        await bootApp();

        const mediaLink = document.querySelector('[data-view="media"]');
        mediaLink?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(mediaLink?.classList.contains('active')).toBe(true));
        const profileLink = document.querySelector('[data-view="profile"]');
        profileLink?.dispatchEvent(new Event('click'));
        await vi.waitFor(() => expect(profileLink?.classList.contains('active')).toBe(true));

        const dashboardLink = document.querySelector('[data-view="dashboard"]');
        dashboardLink?.dispatchEvent(new Event('click'));
        await vi.waitFor(() => expect(dashboardLink?.classList.contains('active')).toBe(true));
    });

    it('should handle app-navigate event', async () => {
        await bootApp();

        window.dispatchEvent(new CustomEvent('app-navigate', { 
            detail: { view: 'media', focusMediaId: 123 } 
        }));
        
        const mediaLink = document.querySelector('[data-view="media"]');
        await vi.waitFor(() => expect(mediaLink?.classList.contains('active')).toBe(true));
    });

    it('should handle no profiles fallback', async () => {
        vi.mocked(api.listProfiles).mockResolvedValueOnce([]).mockResolvedValue(['new-user']);
        vi.mocked(modals.initialProfilePrompt).mockResolvedValue('new-user');
        
        await bootApp();
        
        await vi.waitFor(() => expect(modals.initialProfilePrompt).toHaveBeenCalled());
        expect(api.switchProfile).toHaveBeenCalledWith('new-user');
    });

    it('should handle global add activity button', async () => {
        await bootApp();
        
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        
        const addActivityBtn = document.getElementById('btn-add-activity');
        await addActivityBtn?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(modals.showLogActivityModal).toHaveBeenCalled());
    });

    it('should handle profile updated event', async () => {
        await bootApp();

        vi.mocked(api.listProfiles).mockResolvedValue(['test-user']);
        window.dispatchEvent(new Event('profile-updated'));

        await vi.waitFor(() => expect(api.listProfiles).toHaveBeenCalled());
    });

    it('should handle window controls', async () => {
        await bootApp();

        const minBtn = document.getElementById('win-min');
        const maxBtn = document.getElementById('win-max');
        const closeBtn = document.getElementById('win-close');

        minBtn?.dispatchEvent(new Event('click'));
        maxBtn?.dispatchEvent(new Event('click'));
        closeBtn?.dispatchEvent(new Event('click'));

        const mockWindow = vi.mocked(getCurrentWindow)();
        expect(mockWindow.minimize).toHaveBeenCalled();
        expect(mockWindow.toggleMaximize).toHaveBeenCalled();
        expect(mockWindow.close).toHaveBeenCalled();
    });
});

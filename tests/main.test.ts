import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '../src/api';
import type { ActivitySummary } from '../src/api';
import * as modals from '../src/modals';
import { STORAGE_KEYS, SETTING_KEYS } from '../src/constants';
import { Logger } from '../src/core/logger';

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
    initializeUserDb: vi.fn(() => Promise.resolve()),
    getUsername: vi.fn(() => Promise.resolve('os-user')),
    getSetting: vi.fn((key) => {
        if (key === SETTING_KEYS.THEME) return Promise.resolve('dark');
        if (key === SETTING_KEYS.PROFILE_NAME) return Promise.resolve('test-user');
        return Promise.resolve(null);
    }),
    getProfilePicture: vi.fn(() => Promise.resolve(null)),
    getLogs: vi.fn(() => Promise.resolve([{ id: 0, date: '2024-01-01', duration_minutes: 0, title: 'T', media_id: 1, media_type: 'M', language: 'Japanese' } as ActivitySummary])),
    getAllMedia: vi.fn(() => Promise.resolve([])),
    getHeatmap: vi.fn(() => Promise.resolve([{ date: '2024-01-01', total_minutes: 10 }])),
    getMilestones: vi.fn(() => Promise.resolve([])),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
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
        await vi.waitFor(() => expect(api.initializeUserDb).toHaveBeenCalled());
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        
        document.body.innerHTML = `
            <div id="view-container"></div>
            <div id="nav-user-avatar"></div>
            <img id="nav-user-avatar-image" />
            <span id="nav-user-avatar-fallback"></span>
            <span id="nav-user-name"></span>
            <div id="dev-build-badge"></div>
            <div class="nav-link" data-view="dashboard"></div>
            <div class="nav-link" data-view="media"></div>
            <div class="nav-link" data-view="profile"></div>
            <button id="win-min"></button>
            <button id="win-max"></button>
            <button id="win-close"></button>
            <button id="btn-add-activity"></button>
        `;
        
        // Mock localStorage
        const store: Record<string, string> = { [STORAGE_KEYS.CURRENT_PROFILE]: 'test-user' };
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

        globalThis.dispatchEvent(new CustomEvent('app-navigate', { 
            detail: { view: 'media', focusMediaId: 123 } 
        }));
        
        const mediaLink = document.querySelector('[data-view="media"]');
        await vi.waitFor(() => expect(mediaLink?.classList.contains('active')).toBe(true));
    });

    it('should handle initial profile prompt', async () => {
        vi.mocked(api.getSetting).mockResolvedValue(null);
        const store: Record<string, string> = {};
        vi.mocked(localStorage.getItem).mockImplementation((key) => store[key] || null);
        vi.mocked(modals.initialProfilePrompt).mockResolvedValue('new-user');
        
        await bootApp();
        
        await vi.waitFor(() => expect(modals.initialProfilePrompt).toHaveBeenCalled());
        expect(api.initializeUserDb).toHaveBeenCalledWith('new-user');
    });

    it('should handle global add activity button', async () => {
        await bootApp();
        
        vi.mocked(modals.showLogActivityModal).mockResolvedValue(true);
        
        const addActivityBtn = document.getElementById('btn-add-activity');
        addActivityBtn?.dispatchEvent(new Event('click'));
        
        await vi.waitFor(() => expect(modals.showLogActivityModal).toHaveBeenCalled());
    });

    it('should handle profile updated event', async () => {
        await bootApp();

        vi.mocked(api.getSetting).mockImplementation(async (key) => {
            if (key === SETTING_KEYS.PROFILE_NAME) return 'updated-user';
            return null;
        });
        globalThis.dispatchEvent(new Event('profile-updated'));

        await vi.waitFor(() => expect(document.getElementById('nav-user-name')?.textContent).toBe('updated-user'));
    });

    it('should show avatar image when a profile picture exists', async () => {
        vi.mocked(api.getProfilePicture).mockResolvedValue({
            mime_type: 'image/png',
            base64_data: 'YWJj',
            byte_size: 3,
            width: 1,
            height: 1,
            updated_at: '2026-03-23T00:00:00Z',
        });

        await bootApp();

        const img = document.getElementById('nav-user-avatar-image') as HTMLImageElement;
        await vi.waitFor(() => expect(img.style.display).toBe('block'));
        expect(img.src).toContain('data:image/png;base64,YWJj');
    });

    it('should fall back to initials when profile picture loading fails', async () => {
        vi.mocked(api.getProfilePicture).mockRejectedValue(new Error('missing backend route'));

        await bootApp();

        const fallback = document.getElementById('nav-user-avatar-fallback');
        const currentName = document.getElementById('nav-user-name')?.textContent ?? '';
        await vi.waitFor(() => expect(fallback?.textContent).toBe(currentName.slice(0, 2).toUpperCase()));
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

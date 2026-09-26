import { beforeEach, describe, expect, it } from 'vitest';

import { renderNavigationIcons, syncAppShell } from '../src/app_shell';

describe('syncAppShell', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="desktop-title-bar" class="title-bar"></div>
            <header class="app-nav-bar"></header>
        `;
        delete document.body.dataset.runtime;
    });

    it('removes the desktop title bar in web mode', () => {
        syncAppShell(false);

        expect(document.body.dataset.runtime).toBe('web');
        expect(document.getElementById('desktop-title-bar')).toBeNull();
        expect(document.querySelector('.app-nav-bar')).not.toBeNull();
    });

    it('keeps the desktop title bar in desktop mode', () => {
        syncAppShell(true);

        expect(document.body.dataset.runtime).toBe('desktop');
        expect(document.getElementById('desktop-title-bar')).not.toBeNull();
    });

    it('removes the desktop title bar when native window controls are unavailable', () => {
        syncAppShell(true, false);

        expect(document.body.dataset.runtime).toBe('mobile-app');
        expect(document.getElementById('desktop-title-bar')).toBeNull();
    });
});

describe('renderNavigationIcons', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <nav>
                <a class="nav-link" data-view="dashboard">
                    <span class="nav-link-icon" aria-hidden="true"></span>
                </a>
                <a class="nav-link" data-view="media">
                    <span class="nav-link-icon" aria-hidden="true"></span>
                </a>
                <a class="nav-link" data-view="timeline">
                    <span class="nav-link-icon" aria-hidden="true"></span>
                </a>
            </nav>
            <button class="nav-sync-status-btn" id="nav-sync-status-btn" type="button" aria-label="Sync status">
                <span class="sync-status-dot" id="nav-sync-status-dot" aria-hidden="true"></span>
            </button>
            <span class="activity-btn-icon" aria-hidden="true"></span>
            <button class="mobile-sync-status-btn" id="mobile-sync-status-btn" type="button" aria-label="Sync status">
                <span class="sync-status-dot mobile-sync-status-dot" id="mobile-sync-status-dot" aria-hidden="true"></span>
            </button>
        `;
    });

    it('fills the dashboard, media and timeline nav link icons with an svg', () => {
        renderNavigationIcons(document);

        expect(document.querySelector('.nav-link[data-view="dashboard"] .nav-link-icon svg')).not.toBeNull();
        expect(document.querySelector('.nav-link[data-view="media"] .nav-link-icon svg')).not.toBeNull();
        expect(document.querySelector('.nav-link[data-view="timeline"] .nav-link-icon svg')).not.toBeNull();
    });

    it('keeps the sync status dot and puts the svg before it in the desktop sync button', () => {
        renderNavigationIcons(document);

        const button = document.getElementById('nav-sync-status-btn')!;
        expect(button.querySelector('#nav-sync-status-dot')).not.toBeNull();
        expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    });

    it('keeps the sync status dot and puts the svg before it in the mobile sync button', () => {
        renderNavigationIcons(document);

        const button = document.getElementById('mobile-sync-status-btn')!;
        expect(button.querySelector('#mobile-sync-status-dot')).not.toBeNull();
        expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    });

    it('fills the activity button icon with an svg', () => {
        renderNavigationIcons(document);

        expect(document.querySelector('.activity-btn-icon svg')).not.toBeNull();
    });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { syncAppShell } from '../src/app_shell';

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

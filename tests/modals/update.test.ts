import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    showAvailableUpdateModal,
    showInstalledUpdateModal,
} from '../../src/modals/update';

describe('modals/update.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runAllTimers();
    });

    it('renders the installed update modal with the default releases link', async () => {
        const promise = showInstalledUpdateModal(
            '1.2.3',
            '## Highlights\n\n### Added\n- New sync card',
        );

        const overlay = document.querySelector('.modal-overlay') as HTMLElement;
        const releaseLink = overlay.querySelector('a') as HTMLAnchorElement;

        expect(overlay.textContent).toContain('Kechimochi was updated to 1.2.3');
        expect(overlay.textContent).toContain('Here is the latest changelog');
        expect(overlay.textContent).not.toContain('Make sure to back up your data');
        expect(overlay.innerHTML).toContain('<h4');
        expect(overlay.innerHTML).toContain('New sync card');
        expect(releaseLink.href).toBe('https://github.com/Morgawr/kechimochi/releases');

        (overlay.querySelector('#update-modal-close') as HTMLButtonElement).click();

        await expect(promise).resolves.toBeUndefined();
    });

    it('renders the available update modal with a backup warning and custom release url', async () => {
        const promise = showAvailableUpdateModal(
            '1.2.3',
            '1.2.4',
            '## Fixes\n\n- Better recovery flow',
            'https://example.com/releases/1.2.4',
        );

        const overlay = document.querySelector('.modal-overlay') as HTMLElement;
        const releaseLink = overlay.querySelector('a') as HTMLAnchorElement;

        expect(overlay.textContent).toContain('New update available');
        expect(overlay.textContent).toContain('1.2.3 -> 1.2.4');
        expect(overlay.textContent).toContain('Make sure to back up your data');
        expect(overlay.textContent).toContain('Better recovery flow');
        expect(releaseLink.href).toBe('https://example.com/releases/1.2.4');

        (overlay.querySelector('#update-modal-close') as HTMLButtonElement).click();

        await expect(promise).resolves.toBeUndefined();
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ISSUES_URL, getReleasesUrl } from '../../src/app_version';
import { openVersionModal } from '../../src/version_modal';

describe('version_modal.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runAllTimers();
    });

    it('renders an About dialog with the running version and the release notes and issues links', async () => {
        const promise = openVersionModal();

        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        const titleId = dialog.getAttribute('aria-labelledby') ?? '';
        const linkUrls = Array.from(dialog.querySelectorAll('a')).map(link => link.getAttribute('href'));

        expect(document.getElementById(titleId)?.textContent).toBe('About Kechimochi');
        expect(dialog.textContent).toContain("You're running Kechimochi v");
        expect(linkUrls).toEqual([getReleasesUrl(), ISSUES_URL]);

        (document.getElementById('version-modal-close') as HTMLButtonElement).click();

        await expect(promise).resolves.toBeUndefined();
    });
});

import { escapeHTML } from './html';
import { createCancelableOverlay } from './modal_base';
import { formatRunningVersionSentence, getReleasesUrl, ISSUES_URL } from './app_version';

const VERSION_MODAL_TITLE_ID = 'version-modal-title';

export function openVersionModal(): Promise<void> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createCancelableOverlay(resolve, { closeOnEscape: true });

        overlay.innerHTML = `
            <div class="modal-content version-modal" role="dialog" aria-labelledby="${VERSION_MODAL_TITLE_ID}">
                <h3 id="${VERSION_MODAL_TITLE_ID}" class="version-modal-title">About Kechimochi</h3>
                <div class="version-modal-body">
                    <p>${escapeHTML(formatRunningVersionSentence())}</p>
                    <p>What's new? See the <a href="${escapeHTML(getReleasesUrl())}" target="_blank" rel="noreferrer">release notes</a>.</p>
                    <p>Found a bug? File an issue on <a href="${escapeHTML(ISSUES_URL)}" target="_blank" rel="noreferrer">GitHub</a>.</p>
                </div>
                <div class="version-modal-actions">
                    <button type="button" class="btn btn-primary" id="version-modal-close">Close</button>
                </div>
            </div>
        `;

        overlay.querySelector('#version-modal-close')?.addEventListener('click', () => {
            cleanup();
            resolve();
        });
    });
}

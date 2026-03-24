import { escapeHTML } from '../core/html';
import { getReleasesUrl } from '../app_version';
import { createOverlay } from './base';
import { renderReleaseNotesHtml } from '../updates/release_notes';

interface UpdateModalOptions {
    title: string;
    subtitle: string;
    releaseNotes: string;
    releaseUrl?: string;
    showBackupWarning?: boolean;
}

async function showUpdateModal(options: UpdateModalOptions): Promise<void> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        const releaseNotesHtml = renderReleaseNotesHtml(options.releaseNotes);
        const releaseUrl = options.releaseUrl ?? getReleasesUrl();

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 680px; width: min(92vw, 680px); max-height: 85vh; display: flex; flex-direction: column;">
                <h3 style="margin-bottom: 0.5rem;">${escapeHTML(options.title)}</h3>
                <p style="margin: 0 0 1rem; color: var(--text-secondary);">${escapeHTML(options.subtitle)}</p>
                ${options.showBackupWarning
                    ? '<p style="margin: 0 0 1rem; padding: 0.75rem 0.9rem; border-radius: var(--radius-md); border: 1px solid rgba(255, 166, 0, 0.35); background: rgba(255, 166, 0, 0.08); color: var(--text-primary);">Make sure to back up your data before updating, just in case a migration goes wrong.</p>'
                    : ''}
                <div style="overflow: auto; padding-right: 0.25rem; margin-right: -0.25rem;">
                    ${releaseNotesHtml}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap;">
                    <a href="${escapeHTML(releaseUrl)}" target="_blank" rel="noreferrer" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600;">
                        Open GitHub Releases
                    </a>
                    <button class="btn btn-primary" id="update-modal-close">Close</button>
                </div>
            </div>
        `;

        overlay.querySelector('#update-modal-close')?.addEventListener('click', () => {
            cleanup();
            resolve();
        });
    });
}

export function showInstalledUpdateModal(version: string, releaseNotes: string): Promise<void> {
    return showUpdateModal({
        title: `Kechimochi was updated to ${version}`,
        subtitle: 'Here is the latest changelog for this installed release.',
        releaseNotes,
    });
}

export function showAvailableUpdateModal(currentVersion: string, nextVersion: string, releaseNotes: string, releaseUrl?: string): Promise<void> {
    return showUpdateModal({
        title: 'New update available',
        subtitle: `${currentVersion} -> ${nextVersion}`,
        releaseNotes,
        releaseUrl,
        showBackupWarning: true,
    });
}

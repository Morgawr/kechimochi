import { escapeHTML } from '../core/html';
import type { RemoteSyncProfileSummary, SyncAttachPreview } from '../types';
import { createOverlay } from './base';

export type SyncEnablementChoice =
    | { action: 'create_new' }
    | { action: 'attach'; profileId: string };

function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleString();
}

export async function showSyncEnablementWizard(
    profiles: RemoteSyncProfileSummary[],
    googleEmail?: string | null,
): Promise<SyncEnablementChoice | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        const selectedProfileId = profiles[0]?.profile_id ?? null;

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 760px; width: min(92vw, 760px); max-height: 85vh; display: flex; flex-direction: column;">
                <h3 style="margin-bottom: 0.5rem;">Enable Cloud Sync</h3>
                <p style="margin: 0; color: var(--text-secondary);">
                    ${googleEmail
                        ? `Signed in as <strong style="color: var(--text-primary);">${escapeHTML(googleEmail)}</strong>.`
                        : 'Choose how this device should connect to Google Drive.'}
                </p>
                <p style="margin: 0.75rem 0 0; color: var(--text-secondary); font-size: 0.92rem;">
                    ${profiles.length === 0
                        ? 'No existing sync profiles were found for this account yet. Create a new cloud profile to start syncing this library.'
                        : 'You can create a brand new cloud profile or attach this device to an existing one. Existing profiles always show an attach preview before anything is applied.'}
                </p>
                ${profiles.length > 0
                    ? `<div style="margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.8rem; overflow: auto; padding-right: 0.25rem;">
                        ${profiles.map((profile, index) => `
                            <label style="display: flex; gap: 0.9rem; align-items: flex-start; padding: 0.95rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02); cursor: pointer;">
                                <input
                                    type="radio"
                                    name="sync-profile-choice"
                                    value="${escapeHTML(profile.profile_id)}"
                                    ${index === 0 ? 'checked' : ''}
                                    style="margin-top: 0.15rem;"
                                />
                                <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                    <strong style="color: var(--text-primary);">${escapeHTML(profile.profile_name)}</strong>
                                    <span style="color: var(--text-secondary); font-size: 0.88rem;">Updated ${escapeHTML(formatTimestamp(profile.updated_at))}</span>
                                    <span style="color: var(--text-secondary); font-size: 0.82rem;">Last writer device: ${escapeHTML(profile.last_writer_device_id)}</span>
                                </div>
                            </label>
                        `).join('')}
                    </div>`
                    : `<div style="margin-top: 1.25rem; padding: 1rem 1.1rem; border-radius: var(--radius-md); border: 1px solid rgba(56, 189, 248, 0.28); background: rgba(56, 189, 248, 0.07); color: var(--text-primary);">
                        This will upload your current local state as the first remote snapshot for this Google account.
                    </div>`}
                <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap;">
                    <button class="btn btn-ghost" id="sync-enable-cancel">Cancel</button>
                    <button class="btn btn-secondary" id="sync-enable-create">Create New Profile</button>
                    ${profiles.length > 0
                        ? '<button class="btn btn-primary" id="sync-enable-attach">Attach Selected Profile</button>'
                        : ''}
                </div>
            </div>
        `;

        let currentProfileId: string | null = selectedProfileId;
        const attachButton = overlay.querySelector<HTMLButtonElement>('#sync-enable-attach');
        const updateAttachState = () => {
            if (attachButton) {
                attachButton.disabled = !currentProfileId;
            }
        };

        overlay.querySelector('#sync-enable-cancel')?.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        overlay.querySelector('#sync-enable-create')?.addEventListener('click', () => {
            cleanup();
            resolve({ action: 'create_new' });
        });

        attachButton?.addEventListener('click', () => {
            if (!currentProfileId) return;
            cleanup();
            resolve({ action: 'attach', profileId: currentProfileId });
        });

        overlay
            .querySelectorAll<HTMLInputElement>('input[name="sync-profile-choice"]')
            .forEach((input) => {
                input.addEventListener('change', () => {
                    currentProfileId = input.value || null;
                    updateAttachState();
                });
            });

        updateAttachState();
    });
}

export async function showSyncAttachPreview(preview: SyncAttachPreview): Promise<boolean> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        const hasWarnings =
            preview.conflict_count > 0 || preview.potential_duplicate_titles.length > 0;

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 720px; width: min(92vw, 720px); max-height: 85vh; display: flex; flex-direction: column;">
                <h3 style="margin-bottom: 0.5rem;">Attach Existing Sync Profile</h3>
                <p style="margin: 0; color: var(--text-secondary);">
                    Review how <strong style="color: var(--text-primary);">${escapeHTML(preview.profile_name)}</strong> compares with this device before attaching it.
                </p>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.8rem; margin-top: 1.25rem;">
                    <div style="padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Local only</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${preview.local_only_media_count}</div>
                    </div>
                    <div style="padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Remote only</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${preview.remote_only_media_count}</div>
                    </div>
                    <div style="padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Matched by UID</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${preview.matched_media_count}</div>
                    </div>
                    <div style="padding: 0.9rem 1rem; border: 1px solid ${preview.conflict_count > 0 ? 'rgba(255, 99, 132, 0.45)' : 'var(--border-color)'}; border-radius: var(--radius-md); background: ${preview.conflict_count > 0 ? 'rgba(255, 99, 132, 0.07)' : 'transparent'};">
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Conflicts to review</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${preview.conflict_count}</div>
                    </div>
                </div>
                ${preview.potential_duplicate_titles.length > 0
                    ? `<div style="margin-top: 1rem; padding: 0.95rem 1rem; border-radius: var(--radius-md); border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08);">
                        <strong style="display: block; margin-bottom: 0.4rem;">Potential duplicate titles</strong>
                        <div style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.6rem;">These titles appear on both sides with different sync UIDs, so you should sanity-check the merge result after attaching.</div>
                        <ul style="margin: 0; padding-left: 1.2rem; max-height: 160px; overflow: auto;">
                            ${preview.potential_duplicate_titles.map((title) => `<li>${escapeHTML(title)}</li>`).join('')}
                        </ul>
                    </div>`
                    : ''}
                ${preview.conflict_count > 0
                    ? `<div style="margin-top: 1rem; padding: 0.95rem 1rem; border-radius: var(--radius-md); border: 1px solid rgba(255, 99, 132, 0.35); background: rgba(255, 99, 132, 0.08); color: var(--text-primary);">
                        Attaching will keep your local data safe, but you will land in conflict review before the merged state can be published.
                    </div>`
                    : ''}
                <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap;">
                    <button class="btn btn-ghost" id="sync-attach-cancel">Cancel</button>
                    <button class="btn btn-primary" id="sync-attach-confirm">${hasWarnings ? 'Attach and Review' : 'Attach Profile'}</button>
                </div>
            </div>
        `;

        overlay.querySelector('#sync-attach-cancel')?.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        overlay.querySelector('#sync-attach-confirm')?.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
    });
}

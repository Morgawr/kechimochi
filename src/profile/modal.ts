import { escapeHTML } from '../html';
import { createOverlay } from '../modal_base';

export type InitialSetupChoice =
    | { action: 'create_local'; profileName: string }
    | { action: 'sync_remote' };

export async function showInitialSetupPrompt(
    defaultName: string = 'User',
    options?: { allowCloudSync?: boolean },
): Promise<InitialSetupChoice> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        const allowCloudSync = options?.allowCloudSync ?? true;
        const escapedDefaultName = escapeHTML(defaultName);

        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center; max-width: 560px; width: min(92vw, 560px);">
                <h3 style="margin-bottom: 0.5rem;">Welcome to Kechimochi!</h3>
                <p style="color: var(--text-secondary); font-size: 0.92rem; margin-bottom: 0;">
                    ${allowCloudSync
                        ? 'Create a new local profile, or sign in to Google Drive and import an existing synced library.'
                        : 'Enter your name to create a new local profile and get started.'}
                </p>
                <div style="margin-top: 1.25rem; text-align: left;">
                    <label for="initial-prompt-input" style="display: block; margin-bottom: 0.45rem; color: var(--text-secondary); font-size: 0.85rem;">Profile name for a new local library</label>
                    <input type="text" id="initial-prompt-input" placeholder="e.g. ${escapedDefaultName}" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.6rem 0.7rem; border-radius: var(--radius-sm);" autocomplete="off" />
                    ${allowCloudSync
                        ? '<p style="margin: 0.6rem 0 0; color: var(--text-secondary); font-size: 0.82rem;">Only enter a name if you are starting a brand new local database on this device.</p>'
                        : ''}
                </div>
                <div style="display: flex; justify-content: center; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap;">
                    ${allowCloudSync
                        ? '<button class="btn btn-secondary" id="initial-prompt-sync">Sync From Google Drive</button>'
                        : ''}
                    <button class="btn btn-primary" id="initial-prompt-confirm" disabled>Create Local Profile</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector<HTMLInputElement>('#initial-prompt-input')!;
        const confirmBtn = overlay.querySelector<HTMLButtonElement>('#initial-prompt-confirm')!;

        const resolveLocalProfile = () => {
            const profileName = input.value.trim();
            if (!profileName) {
                return;
            }
            cleanup();
            resolve({ action: 'create_local', profileName });
        };

        const checkInput = () => {
            confirmBtn.disabled = input.value.trim().length === 0;
        };

        input.addEventListener('input', checkInput);
        confirmBtn.addEventListener('click', resolveLocalProfile);
        overlay.querySelector('#initial-prompt-sync')?.addEventListener('click', () => {
            cleanup();
            resolve({ action: 'sync_remote' });
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                resolveLocalProfile();
            }
        });

        input.focus();
    });
}

export async function initialProfilePrompt(defaultName: string = 'User'): Promise<string> {
    const choice = await showInitialSetupPrompt(defaultName, { allowCloudSync: false });
    if (choice.action !== 'create_local') {
        throw new Error('Local-only profile prompt returned an unexpected action.');
    }
    return choice.profileName;
}

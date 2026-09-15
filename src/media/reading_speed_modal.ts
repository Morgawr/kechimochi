import { createCancelableOverlay } from '../modal_base';
import { escapeHTML } from '../html';

const MAX_READING_SPEED_DIGITS = 7;

export interface ReadingSpeedOverrideChoice {
    charactersPerHour: number | null;
}

export async function showReadingSpeedOverrideModal(
    mediaTitle: string,
    currentSpeed: number | null,
): Promise<ReadingSpeedOverrideChoice | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null), { closeOnEscape: true });

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <h3>Set Custom Reading Speed</h3>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.3rem;">
                    <label style="font-size: 0.85rem; color: var(--text-secondary);">Reading speed for "${escapeHTML(mediaTitle)}"</label>
                    <input type="text" id="reading-speed-input" inputmode="numeric" autocomplete="off" placeholder="char/hr" maxlength="${MAX_READING_SPEED_DIGITS}" value="${currentSpeed ?? ''}" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                    <p style="margin: 0.3rem 0 0; font-size: 0.8rem; color: var(--text-secondary); font-style: italic;">Overrides the automatic estimate for this entry only. Leave empty to go back to the automatic estimate.</p>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="reading-speed-cancel">Cancel</button>
                    <button class="btn btn-primary" id="reading-speed-confirm">Save</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector<HTMLInputElement>('#reading-speed-input')!;
        input.addEventListener('input', () => {
            input.value = input.value.replaceAll(/\D/g, '').slice(0, MAX_READING_SPEED_DIGITS);
        });

        const confirm = () => {
            const parsedSpeed = Number.parseInt(input.value, 10);
            cleanup();
            resolve({ charactersPerHour: Number.isNaN(parsedSpeed) || parsedSpeed <= 0 ? null : parsedSpeed });
        };

        overlay.querySelector('#reading-speed-cancel')!.addEventListener('click', dismiss);
        overlay.querySelector('#reading-speed-confirm')!.addEventListener('click', confirm);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirm(); }
        });

        input.focus();
    });
}

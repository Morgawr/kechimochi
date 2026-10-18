import { createCancelableOverlay } from '../../modal_base';
import { escapeAttribute, escapeHTML } from '../../html';
import { DURATION_INPUT_TOOLTIP, formatCompactDuration, wireDurationInput } from '../../time';
import { DEFAULT_ANIME_EPISODE_DURATION_MINUTES } from './episode_duration';

export interface EpisodeDurationOverrideChoice {
    episodeDurationMinutes: number | null;
}

export async function showEpisodeDurationOverrideModal(
    mediaTitle: string,
    currentEpisodeDurationMinutes: number | null,
): Promise<EpisodeDurationOverrideChoice | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null), { closeOnEscape: true });
        const defaultDurationLabel = formatCompactDuration(DEFAULT_ANIME_EPISODE_DURATION_MINUTES);

        overlay.innerHTML = `
            <div class="modal-content">
                <h3>Set Episode Duration</h3>
                <div class="episode-duration-modal-field">
                    <label for="episode-duration-input" class="episode-duration-modal-label">Length of one episode of "${escapeHTML(mediaTitle)}"</label>
                    <input type="text" id="episode-duration-input" class="episode-duration-modal-input" autocomplete="off" placeholder="${escapeAttribute(defaultDurationLabel)}" title="${escapeAttribute(DURATION_INPUT_TOOLTIP)}" value="${currentEpisodeDurationMinutes === null ? '' : escapeAttribute(formatCompactDuration(currentEpisodeDurationMinutes))}" />
                    <div id="episode-duration-hint" class="duration-hint"></div>
                    <p class="episode-duration-modal-note">Leave empty to use the default of ${escapeHTML(defaultDurationLabel)}.</p>
                </div>
                <div class="episode-duration-modal-actions">
                    <button type="button" class="btn btn-ghost" id="episode-duration-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary" id="episode-duration-confirm">Save</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector<HTMLInputElement>('#episode-duration-input')!;
        const hint = overlay.querySelector<HTMLElement>('#episode-duration-hint')!;
        const confirmButton = overlay.querySelector<HTMLButtonElement>('#episode-duration-confirm')!;

        const readChoice = (): EpisodeDurationOverrideChoice | null => {
            if (input.value.trim().length === 0) return { episodeDurationMinutes: null };
            const minutes = getDurationMinutes();
            return minutes === null || minutes <= 0 ? null : { episodeDurationMinutes: minutes };
        };

        const syncConfirmButton = () => {
            confirmButton.disabled = readChoice() === null;
        };

        const { getDurationMinutes } = wireDurationInput(input, hint, syncConfirmButton, {
            emptyInputMinutes: DEFAULT_ANIME_EPISODE_DURATION_MINUTES,
        });
        syncConfirmButton();

        const confirmChoice = () => {
            const choice = readChoice();
            if (choice === null) return;
            cleanup();
            resolve(choice);
        };

        overlay.querySelector('#episode-duration-cancel')!.addEventListener('click', dismiss);
        confirmButton.addEventListener('click', confirmChoice);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                confirmChoice();
            }
        });

        input.focus();
    });
}

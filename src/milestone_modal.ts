import { getSetting, Milestone } from './api';
import { buildCalendar, normalizeWeekStartDay } from './calendar';
import { createCancelableOverlay, customAlert } from './modal_base';
import { escapeAttribute } from './html';
import { DURATION_INPUT_PLACEHOLDER, DURATION_INPUT_TOOLTIP, wireDurationInput } from './time';
import { SETTING_KEYS } from './constants';
import { COUNT_INPUT_PLACEHOLDER, readCount, wireDigitsOnlyInput } from './counts';
import {
    MISSING_INPUTS_ALERT_TITLE,
    describeMissingAmount,
    formatMissingInputsMessage,
    syncConfirmButton,
} from './log_entry_validation';

type MilestoneDefaults = {
    duration?: number;
    characters?: number;
};

function isExistingMilestone(input?: Milestone | MilestoneDefaults): input is Milestone {
    if (!input) return false;
    return typeof (input as Milestone).name === 'string' && typeof (input as Milestone).media_title === 'string';
}

export async function showAddMilestoneModal(mediaTitle: string, mediaUid: string, initialValues?: Milestone | MilestoneDefaults): Promise<Milestone | null> {
    const weekStartDaySetting = await getSetting(SETTING_KEYS.WEEK_START_DAY);
    const weekStartDay = normalizeWeekStartDay(weekStartDaySetting);
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null), { closeOnEscape: true });
        const existingMilestone = isExistingMilestone(initialValues) ? initialValues : undefined;
        const defaults: MilestoneDefaults = existingMilestone ? {} : (initialValues || {});
        const isEditMode = !!existingMilestone;

        const today = new Date().toISOString().split('T')[0];
        const existingDate = existingMilestone?.date?.trim();
        const hasExistingDate = typeof existingDate === 'string' && existingDate.length > 0;
        let selectedDate: string | undefined = hasExistingDate ? existingDate : undefined;
        const initialDuration = Math.max(0, Math.floor(existingMilestone?.duration ?? defaults.duration ?? 0));
        const initialCharacters = Math.max(0, Math.floor(existingMilestone?.characters ?? defaults.characters ?? 0));

        overlay.innerHTML = `
            <style>
                .milestone-input:focus {
                    border-color: var(--accent-blue) !important;
                    outline: none;
                }
            </style>
            <div class="modal-content" style="max-width: 400px;">
                <h3>${isEditMode ? 'Edit Milestone' : 'Add Milestone'}</h3>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Milestone Name</label>
                        <input type="text" id="milestone-name" class="milestone-input" placeholder="e.g. Finished Route A" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Duration</label>
                        <input type="text" id="milestone-duration" class="milestone-input" autocomplete="off" placeholder="${escapeAttribute(DURATION_INPUT_PLACEHOLDER)}" title="${escapeAttribute(DURATION_INPUT_TOOLTIP)}" value="${initialDuration > 0 ? String(initialDuration) : ''}" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                        <div id="milestone-duration-hint" class="duration-hint"></div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Characters</label>
                        <input type="text" id="milestone-characters" class="milestone-input" inputmode="numeric" autocomplete="off" placeholder="${escapeAttribute(COUNT_INPUT_PLACEHOLDER)}" value="${initialCharacters > 0 ? String(initialCharacters) : ''}" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer;">
                            <input type="checkbox" id="milestone-record-date" ${hasExistingDate ? 'checked' : ''} />
                            Record date?
                        </label>
                        <div id="milestone-calendar-container" style="display: ${hasExistingDate ? 'flex' : 'none'}; margin-top: 0.5rem; justify-content: center;">
                            <div id="milestone-calendar"></div>
                        </div>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="milestone-cancel">Cancel</button>
                    <button class="btn btn-primary" id="milestone-confirm">${isEditMode ? 'Save Changes' : 'Add Milestone'}</button>
                </div>
            </div>
        `;

        const nameInput = overlay.querySelector<HTMLInputElement>('#milestone-name')!;
        const durationInput = overlay.querySelector<HTMLInputElement>('#milestone-duration')!;
        const durationHint = overlay.querySelector<HTMLElement>('#milestone-duration-hint')!;
        const confirmButton = overlay.querySelector<HTMLButtonElement>('#milestone-confirm')!;
        const recordDateCheckbox = overlay.querySelector<HTMLInputElement>('#milestone-record-date')!;
        const calendarContainer = overlay.querySelector<HTMLElement>('#milestone-calendar-container')!;
        const charactersInput = overlay.querySelector<HTMLInputElement>('#milestone-characters')!;
        const listMissingInputs = (): string[] => {
            const missingInputs: string[] = [];
            if (!nameInput.value.trim()) missingInputs.push('a milestone name');
            const missingAmount = describeMissingAmount(getDurationMinutes(), readCount(charactersInput));
            if (missingAmount) missingInputs.push(missingAmount);
            return missingInputs;
        };
        const syncMilestoneConfirmButton = () => syncConfirmButton(confirmButton, listMissingInputs());
        const { getDurationMinutes } = wireDurationInput(durationInput, durationHint, syncMilestoneConfirmButton);
        wireDigitsOnlyInput(charactersInput);
        charactersInput.addEventListener('input', syncMilestoneConfirmButton);
        nameInput.addEventListener('input', syncMilestoneConfirmButton);
        nameInput.value = existingMilestone?.name ?? '';
        syncMilestoneConfirmButton();
        if (hasExistingDate) {
            buildCalendar(overlay.querySelector<HTMLElement>('#milestone-calendar')!, existingDate, (d) => {
                selectedDate = d;
            }, { weekStartDay });
        }

        const handleConfirm = () => {
            const missingInputs = listMissingInputs();
            if (missingInputs.length > 0) {
                customAlert(MISSING_INPUTS_ALERT_TITLE, formatMissingInputsMessage(missingInputs));
                return;
            }

            const name = nameInput.value.trim();
            const totalDuration = getDurationMinutes();
            const characters = readCount(charactersInput);
            if (totalDuration === null) return;

            cleanup();
            resolve({
                id: existingMilestone?.id,
                media_uid: mediaUid,
                media_title: mediaTitle,
                name,
                duration: totalDuration,
                characters,
                date: selectedDate
            });
        };

        [nameInput, durationInput, charactersInput].forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                }
            });
        });

        recordDateCheckbox.addEventListener('change', () => {
            if (recordDateCheckbox.checked) {
                calendarContainer.style.display = 'flex';
                selectedDate = selectedDate || today;
                buildCalendar(overlay.querySelector<HTMLElement>('#milestone-calendar')!, selectedDate, (d) => {
                    selectedDate = d;
                }, { weekStartDay });
            } else {
                calendarContainer.style.display = 'none';
                selectedDate = undefined;
            }
        });

        overlay.querySelector('#milestone-cancel')!.addEventListener('click', dismiss);
        confirmButton.addEventListener('click', handleConfirm);
        nameInput.focus();
    });
}

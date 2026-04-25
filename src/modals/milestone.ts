import { Milestone } from '../api';
import { buildCalendar } from './calendar';
import { createOverlay, customAlert } from './base';

type MilestoneDefaults = {
    duration?: number;
    characters?: number;
};

function isExistingMilestone(input?: Milestone | MilestoneDefaults): input is Milestone {
    if (!input) return false;
    return typeof (input as Milestone).name === 'string' && typeof (input as Milestone).media_title === 'string';
}

export async function showAddMilestoneModal(mediaTitle: string, initialValues?: Milestone | MilestoneDefaults): Promise<Milestone | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup: baseCleanup } = createOverlay();
        const existingMilestone = isExistingMilestone(initialValues) ? initialValues : undefined;
        const defaults: MilestoneDefaults = existingMilestone ? {} : (initialValues || {});
        const isEditMode = !!existingMilestone;

        const today = new Date().toISOString().split('T')[0];
        const existingDate = existingMilestone?.date?.trim();
        const hasExistingDate = typeof existingDate === 'string' && existingDate.length > 0;
        let selectedDate: string | undefined = hasExistingDate ? existingDate : undefined;
        const initialDuration = Math.max(0, Math.floor(existingMilestone?.duration ?? defaults.duration ?? 0));
        const initialHours = Math.floor(initialDuration / 60);
        const initialMinutes = initialDuration % 60;
        const initialCharacters = Math.max(0, Math.floor(existingMilestone?.characters ?? defaults.characters ?? 0));

        overlay.innerHTML = `
            <style>
                /* Remove spin buttons */
                #milestone-hours::-webkit-outer-spin-button,
                #milestone-minutes::-webkit-outer-spin-button,
                #milestone-hours::-webkit-inner-spin-button,
                #milestone-minutes::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
                #milestone-hours, #milestone-minutes {
                    -moz-appearance: textfield;
                }
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
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <input type="number" id="milestone-hours" class="milestone-input" value="${initialHours}" min="0" style="width: 70px; background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center;" />
                            <span style="font-size: 0.85rem;">h</span>
                            <input type="number" id="milestone-minutes" class="milestone-input" value="${initialMinutes}" min="0" style="width: 70px; background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center;" />
                            <span style="font-size: 0.85rem;">m</span>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Characters</label>
                        <input type="number" id="milestone-characters" class="milestone-input" value="${initialCharacters}" min="0" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
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

        const handleGlobalEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        };

        const cleanup = () => {
            globalThis.removeEventListener('keydown', handleGlobalEsc);
            baseCleanup();
        };

        globalThis.addEventListener('keydown', handleGlobalEsc);

        const nameInput = overlay.querySelector<HTMLInputElement>('#milestone-name')!;
        const hoursInput = overlay.querySelector<HTMLInputElement>('#milestone-hours')!;
        const minutesInput = overlay.querySelector<HTMLInputElement>('#milestone-minutes')!;
        const recordDateCheckbox = overlay.querySelector<HTMLInputElement>('#milestone-record-date')!;
        const calendarContainer = overlay.querySelector<HTMLElement>('#milestone-calendar-container')!;
        const charactersInput = overlay.querySelector<HTMLInputElement>('#milestone-characters')!;
        nameInput.value = existingMilestone?.name ?? '';
        if (hasExistingDate) {
            buildCalendar('milestone-calendar', existingDate!, (d) => {
                selectedDate = d;
            });
        }

        const handleConfirm = () => {
            const name = nameInput.value.trim();
            if (!name) {
                customAlert("Required Field", "Please enter a Milestone Name.");
                return;
            }

            const hours = Number.parseInt(hoursInput.value) || 0;
            const mins = Number.parseInt(minutesInput.value) || 0;
            const characters = Number.parseInt(charactersInput.value) || 0;
            const totalDuration = (hours * 60) + mins;

            if (totalDuration === 0 && characters === 0) {
                customAlert("Input Required", "Please enter either duration or characters.");
                return;
            }

            cleanup();
            resolve({
                id: existingMilestone?.id,
                media_uid: existingMilestone?.media_uid,
                media_title: mediaTitle,
                name,
                duration: totalDuration,
                characters,
                date: selectedDate
            });
        };

        [nameInput, hoursInput, minutesInput, charactersInput].forEach(el => {
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
                buildCalendar('milestone-calendar', selectedDate, (d) => {
                    selectedDate = d;
                });
            } else {
                calendarContainer.style.display = 'none';
                selectedDate = undefined;
            }
        });

        overlay.querySelector('#milestone-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#milestone-confirm')!.addEventListener('click', handleConfirm);
        nameInput.focus();
    });
}

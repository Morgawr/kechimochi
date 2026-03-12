import { Milestone } from '../api';
import { buildCalendar } from './calendar';

export async function showAddMilestoneModal(mediaTitle: string): Promise<Milestone | null> {
    return new Promise((resolve) => {
        (window as any).__modalCounter = ((window as any).__modalCounter || 0) + 1;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('data-overlay-id', (window as any).__modalCounter.toString());
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        const today = new Date().toISOString().split('T')[0];
        let selectedDate: string | undefined = undefined;

        overlay.innerHTML = `
            <style>
                /* Remove spin buttons */
                #milestone-hours::-webkit-outer-spin-button,
                #milestone-hours::-webkit-inner-spin-button,
                #milestone-minutes::-webkit-outer-spin-button,
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
                <h3>Add Milestone</h3>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Milestone Name</label>
                        <input type="text" id="milestone-name" class="milestone-input" placeholder="e.g. Finished Route A" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Duration</label>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <input type="number" id="milestone-hours" class="milestone-input" value="0" min="0" style="width: 70px; background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center;" />
                            <span style="font-size: 0.85rem;">h</span>
                            <input type="number" id="milestone-minutes" class="milestone-input" value="0" min="0" style="width: 70px; background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center;" />
                            <span style="font-size: 0.85rem;">m</span>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer;">
                            <input type="checkbox" id="milestone-record-date" />
                            Record date?
                        </label>
                        <div id="milestone-calendar-container" style="display: none; margin-top: 0.5rem; justify-content: center;">
                            <div id="milestone-calendar"></div>
                        </div>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="milestone-cancel">Cancel</button>
                    <button class="btn btn-primary" id="milestone-confirm">Add Milestone</button>
                </div>
            </div>
        `;
        
        const cleanup = () => {
             window.removeEventListener('keydown', handleGlobalEsc);
             overlay.classList.remove('active');
             overlay.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
             setTimeout(() => overlay.remove(), 300);
        };

        const handleGlobalEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        };
        window.addEventListener('keydown', handleGlobalEsc);
        
        const nameInput = overlay.querySelector('#milestone-name') as HTMLInputElement;
        const hoursInput = overlay.querySelector('#milestone-hours') as HTMLInputElement;
        const minutesInput = overlay.querySelector('#milestone-minutes') as HTMLInputElement;
        const recordDateCheckbox = overlay.querySelector('#milestone-record-date') as HTMLInputElement;
        const calendarContainer = overlay.querySelector('#milestone-calendar-container') as HTMLElement;

        const handleConfirm = () => {
            const name = nameInput.value.trim();
            if (!name) return;
            
            const hours = parseInt(hoursInput.value) || 0;
            const mins = parseInt(minutesInput.value) || 0;
            const totalDuration = (hours * 60) + mins;

            cleanup(); 
            resolve({ 
                media_title: mediaTitle,
                name: name,
                duration: totalDuration,
                date: selectedDate
            });
        };

        [nameInput, hoursInput, minutesInput].forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                }
            });
        });

        recordDateCheckbox.addEventListener('change', () => {
            if (recordDateCheckbox.checked) {
                calendarContainer.style.display = 'flex';
                selectedDate = today;
                buildCalendar('milestone-calendar', today, (d) => {
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

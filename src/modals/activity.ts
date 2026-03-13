import { getAllMedia, addLog, addMedia, updateMedia } from '../api';
import { buildCalendar } from './calendar';
import { customPrompt, createOverlay } from './base';

export async function showExportCsvModal(): Promise<{mode: 'all' | 'range', start?: string, end?: string} | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 90vw; width: max-content;">
                <h3>Export CSV</h3>
                <div style="margin-top: 1rem;">
                    <label style="display: flex; gap: 0.5rem; align-items: center; cursor: pointer;"><input type="radio" name="export-mode" value="all" checked /> All History</label>
                    <label style="display: flex; gap: 0.5rem; align-items: center; cursor: pointer; margin-top: 0.5rem;"><input type="radio" name="export-mode" value="range" /> Date Range</label>
                </div>
                <div id="export-range-inputs" style="display: none; align-items: flex-start; gap: 1.5rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: #1a151f;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;"><label style="font-size: 0.85rem; color: var(--text-secondary);">Start Date</label><div id="cal-start-container"></div></div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;"><label style="font-size: 0.85rem; color: var(--text-secondary);">End Date</label><div id="cal-end-container"></div></div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="export-cancel">Cancel</button>
                    <button class="btn btn-primary" id="export-confirm">Export</button>
                </div>
            </div>`;
        
        let selectedStart = todayStr;
        let selectedEnd = todayStr;
        buildCalendar('cal-start-container', todayStr, (d) => selectedStart = d);
        buildCalendar('cal-end-container', todayStr, (d) => selectedEnd = d);

        const modeRange = overlay.querySelector<HTMLInputElement>('input[value="range"]')!;
        const rangeInputs = overlay.querySelector<HTMLElement>('#export-range-inputs')!;
        overlay.querySelectorAll('input[name="export-mode"]').forEach(el => el.addEventListener('change', () => rangeInputs.style.display = modeRange.checked ? 'flex' : 'none'));
        
        overlay.querySelector('#export-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#export-confirm')!.addEventListener('click', () => { 
            if (modeRange.checked) {
                const start = selectedStart < selectedEnd ? selectedStart : selectedEnd;
                const end = selectedStart > selectedEnd ? selectedStart : selectedEnd;
                resolve({ mode: 'range', start, end });
            }
            else resolve({ mode: 'all' });
            cleanup();
        });
    });
}

export async function showLogActivityModal(prefillMediaTitle?: string): Promise<boolean> {
    const mediaList = await getAllMedia();
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();

        const activeMedia = mediaList.filter(m => m.status !== 'Archived' && m.tracking_status === 'Ongoing');

        overlay.innerHTML = `
            <div class="modal-content">
                <h3>Log Activity</h3>
                <form id="add-activity-form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="activity-media" list="media-datalist" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" value="${prefillMediaTitle || ''}" required />
                        <datalist id="media-datalist">${activeMedia.map(m => `<option value="${m.title}">`).join('')}</datalist>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Duration (minutes)</label>
                        <input type="number" id="activity-duration" min="1" step="1" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" required />
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Date</label>
                        <div id="activity-cal-container"></div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem;">
                        <button type="button" class="btn btn-ghost" id="activity-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary">Log Activity</button>
                    </div>
                </form>
            </div>`;

        const pad = (n: number) => n.toString().padStart(2, '0');
        const today = new Date();
        let selectedDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        buildCalendar('activity-cal-container', selectedDate, (d) => selectedDate = d);

        if (prefillMediaTitle) {
            overlay.querySelector<HTMLInputElement>('#activity-duration')!.focus();
        } else {
            overlay.querySelector<HTMLInputElement>('#activity-media')!.focus();
        }

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
                resolve(false);
            }
        };

        globalThis.addEventListener('keydown', handleEscape, true);

        const originalCleanup = cleanup;
        const newCleanup = () => {
             globalThis.removeEventListener('keydown', handleEscape, true);
             originalCleanup();
        };

        overlay.querySelector('#activity-cancel')!.addEventListener('click', () => { newCleanup(); resolve(false); });
        overlay.querySelector('#add-activity-form')!.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mediaTitle = overlay.querySelector<HTMLInputElement>('#activity-media')!.value.trim();
            // The instruction mentioned `const field = (el as HTMLInputElement).dataset.field;`
            // but `el` is not defined in this scope. Assuming it was a partial instruction
            // or a placeholder for a different context.
            const duration = Number.parseInt(overlay.querySelector<HTMLInputElement>('#activity-duration')!.value, 10);
            if (!mediaTitle || !duration) return;

            const existingMedia = mediaList.find(m => m.title.toLowerCase() === mediaTitle.toLowerCase());
            let mediaId: number;

            if (existingMedia?.id) {
                mediaId = existingMedia.id;
                if (existingMedia.status === 'Archived') {
                    existingMedia.status = 'Active';
                    await updateMedia(existingMedia);
                }
            } else {
                const typeResp = await customPrompt(`"${mediaTitle}" is new! What type of media is this?`, "Reading");
                if (!typeResp) return;
                mediaId = await addMedia({ title: mediaTitle, media_type: typeResp, status: "Active", language: "Japanese", description: "", cover_image: "", extra_data: "{}", content_type: "Unknown", tracking_status: "Untracked" });
            }

            await addLog({ media_id: mediaId, duration_minutes: duration, date: selectedDate });
            newCleanup();
            resolve(true);
        });
    });
}

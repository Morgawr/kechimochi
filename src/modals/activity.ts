import { getAllMedia, getLogs, addLog, updateLog, addMedia, updateMedia, ActivitySummary } from '../api';
import { ACTIVITY_TYPES } from '../constants';
import { buildCalendar } from './calendar';
import { customPrompt, customAlert, createOverlay } from './base';
import { Logger } from '../core/logger';
import { escapeHTML } from '../core/html';

const pad = (n: number) => n.toString().padStart(2, '0');
const getTodayStr = () => {
    const today = new Date();
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
};

export async function showExportCsvModal(): Promise<{mode: 'all' | 'range', start?: string, end?: string} | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        
        const todayStr = getTodayStr();
        
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
                const [start, end] = [selectedStart, selectedEnd].sort((a, b) => a.localeCompare(b));
                resolve({ mode: 'range', start, end });
            }
            else resolve({ mode: 'all' });
            cleanup();
        });
    });
}

export async function showLogActivityModal(prefillMediaTitle?: string, editLog?: ActivitySummary): Promise<boolean> {
    const mediaList = await getAllMedia();
    const allLogs = await getLogs();
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();

        const activeMedia = mediaList.filter(m => m.status !== 'Archived' && m.tracking_status === 'Ongoing');
        const totalsByMediaId = new Map<number, { duration: number; characters: number }>();
        for (const log of allLogs) {
            const current = totalsByMediaId.get(log.media_id) || { duration: 0, characters: 0 };
            totalsByMediaId.set(log.media_id, {
                duration: current.duration + (log.duration_minutes || 0),
                characters: current.characters + (log.characters || 0)
            });
        }
        if (editLog) {
            const current = totalsByMediaId.get(editLog.media_id) || { duration: 0, characters: 0 };
            totalsByMediaId.set(editLog.media_id, {
                duration: Math.max(0, current.duration - (editLog.duration_minutes || 0)),
                characters: Math.max(0, current.characters - (editLog.characters || 0))
            });
        }

        const escapedTitle = escapeHTML(editLog?.title || prefillMediaTitle || '');
        const activeMediaOptions = activeMedia.map(m => `<option value="${escapeHTML(m.title)}">`).join('');

        // Determine the default activity type
        const prefillMedia = mediaList.find(m => m.title.toLowerCase() === (editLog?.title || prefillMediaTitle || '').toLowerCase());
        const defaultActivityType = editLog?.media_type || prefillMedia?.media_type || 'Reading';
            
        overlay.innerHTML = `
            <div class="modal-content" style="width: 450px;">
                <h3>${editLog ? 'Edit Activity' : 'Log Activity'}</h3>
                <form id="add-activity-form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="activity-media" list="media-datalist" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" value="${escapedTitle}" ${editLog ? 'disabled' : ''} required oninvalid="this.setCustomValidity('Media Title is required')" oninput="this.setCustomValidity('')" />
                        <datalist id="media-datalist">${activeMediaOptions}</datalist>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                                <label style="font-size: 0.85rem; color: var(--text-secondary);">Activity Type</label>
                                <select id="activity-type" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;">
                                    ${ACTIVITY_TYPES.map(t => `<option value="${t}" ${t === defaultActivityType ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                        </div>
                        <div id="mobile-date-field" style="display: none; flex-direction: column; gap: 0.5rem;">
                            <label style="font-size: 0.85rem; color: var(--text-secondary);">Date</label>
                            <input id="mobile-date-input" type="date" />
                        </div>
                    </div>
                    <div style="display: flex; gap: 1rem; width: 100%;">
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                                <label style="font-size: 0.85rem; color: var(--text-secondary);">Duration (mins)</label>
                                <div id="activity-duration-mode-toggle" style="display: flex; gap: 0.25rem;">
                                    <button type="button" id="activity-duration-mode-incremental" class="btn btn-sm btn-primary" style="padding: 0.2rem 0.45rem;">Session</button>
                                    <button type="button" id="activity-duration-mode-differential" class="btn btn-sm btn-ghost" style="padding: 0.2rem 0.45rem;">Total</button>
                                </div>
                            </div>
                            <input type="number" id="activity-duration" value="${editLog?.duration_minutes || 0}" min="0" step="1" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                            <div id="activity-duration-helper" style="font-size: 0.74rem; color: var(--text-secondary); min-height: 1.1em;"></div>
                        </div>
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                                <label style="font-size: 0.85rem; color: var(--text-secondary);">Characters</label>
                                <div id="activity-characters-mode-toggle" style="display: flex; gap: 0.25rem;">
                                    <button type="button" id="activity-characters-mode-incremental" class="btn btn-sm btn-primary" style="padding: 0.2rem 0.45rem;">Session</button>
                                    <button type="button" id="activity-characters-mode-differential" class="btn btn-sm btn-ghost" style="padding: 0.2rem 0.45rem;">Total</button>
                                </div>
                            </div>
                            <input type="number" id="activity-characters" value="${editLog?.characters || 0}" min="0" step="1" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                            <div id="activity-characters-helper" style="font-size: 0.74rem; color: var(--text-secondary); min-height: 1.1em;"></div>
                        </div>
                    </div>
                    <div id="desktop-date-field" style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Date</label>
                        <div id="activity-cal-container"></div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem;">
                        <button type="button" class="btn btn-ghost" id="activity-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary">${editLog ? 'Update Activity' : 'Log Activity'}</button>
                    </div>
                </form>
            </div>`;

        let selectedDate = editLog?.date || getTodayStr();
        buildCalendar('activity-cal-container', selectedDate, (d) => selectedDate = d);

        // Set default date for mobile input
        const mobileDateInput = overlay.querySelector<HTMLInputElement>('#mobile-date-input')!;
        mobileDateInput.value = selectedDate;
        const mediaInput = overlay.querySelector<HTMLInputElement>('#activity-media')!;
        const durationInput = overlay.querySelector<HTMLInputElement>('#activity-duration')!;
        const charactersInput = overlay.querySelector<HTMLInputElement>('#activity-characters')!;
        const durationHelper = overlay.querySelector<HTMLElement>('#activity-duration-helper')!;
        const charactersHelper = overlay.querySelector<HTMLElement>('#activity-characters-helper')!;
        const durationModeIncBtn = overlay.querySelector<HTMLButtonElement>('#activity-duration-mode-incremental')!;
        const durationModeDiffBtn = overlay.querySelector<HTMLButtonElement>('#activity-duration-mode-differential')!;
        const charactersModeIncBtn = overlay.querySelector<HTMLButtonElement>('#activity-characters-mode-incremental')!;
        const charactersModeDiffBtn = overlay.querySelector<HTMLButtonElement>('#activity-characters-mode-differential')!;

        const parseInput = (value: string): number => Math.max(0, Number.parseInt(value, 10) || 0);
        const formatNumber = (value: number): string => value.toLocaleString();
        const findSelectedMedia = () =>
            mediaList.find(m => m.title.toLowerCase() === mediaInput.value.trim().toLowerCase()) || null;

        let durationMode: 'incremental' | 'differential' = 'incremental';
        let charactersMode: 'incremental' | 'differential' = 'incremental';
        let baselineDuration = 0;
        let baselineCharacters = 0;

        const setModeButtonState = () => {
            durationModeIncBtn.classList.toggle('btn-primary', durationMode === 'incremental');
            durationModeIncBtn.classList.toggle('btn-ghost', durationMode !== 'incremental');
            durationModeDiffBtn.classList.toggle('btn-primary', durationMode === 'differential');
            durationModeDiffBtn.classList.toggle('btn-ghost', durationMode !== 'differential');
            charactersModeIncBtn.classList.toggle('btn-primary', charactersMode === 'incremental');
            charactersModeIncBtn.classList.toggle('btn-ghost', charactersMode !== 'incremental');
            charactersModeDiffBtn.classList.toggle('btn-primary', charactersMode === 'differential');
            charactersModeDiffBtn.classList.toggle('btn-ghost', charactersMode !== 'differential');
        };

        const updateFieldHints = () => {
            const rawDuration = parseInput(durationInput.value);
            const rawCharacters = parseInput(charactersInput.value);
            if (durationMode === 'differential') {
                const deltaDuration = rawDuration - baselineDuration;
                durationHelper.textContent = deltaDuration < 0
                    ? `Total is ${formatNumber(Math.abs(deltaDuration))} below current (${formatNumber(baselineDuration)}).`
                    : `Current total: ${formatNumber(baselineDuration)} → Session log: ${formatNumber(deltaDuration)}.`;
            } else {
                durationHelper.textContent = `Session log: ${formatNumber(rawDuration)} mins.`;
            }

            if (charactersMode === 'differential') {
                const deltaCharacters = rawCharacters - baselineCharacters;
                charactersHelper.textContent = deltaCharacters < 0
                    ? `Total is ${formatNumber(Math.abs(deltaCharacters))} below current (${formatNumber(baselineCharacters)}).`
                    : `Current total: ${formatNumber(baselineCharacters)} → Session log: ${formatNumber(deltaCharacters)}.`;
            } else {
                charactersHelper.textContent = `Session log: ${formatNumber(rawCharacters)} chars.`;
            }
        };

        const refreshBaselines = () => {
            const selectedMedia = editLog
                ? mediaList.find(m => m.id === editLog.media_id) || findSelectedMedia()
                : findSelectedMedia();
            const totals = selectedMedia?.id ? totalsByMediaId.get(selectedMedia.id) : undefined;
            baselineDuration = totals?.duration || 0;
            baselineCharacters = totals?.characters || 0;
            updateFieldHints();
        };

        const setDurationMode = (nextMode: 'incremental' | 'differential') => {
            if (durationMode === nextMode) return;
            const currentRaw = parseInput(durationInput.value);
            if (nextMode === 'differential') {
                durationInput.value = String(baselineDuration + currentRaw);
            } else {
                durationInput.value = String(Math.max(0, currentRaw - baselineDuration));
            }
            durationMode = nextMode;
            setModeButtonState();
            updateFieldHints();
        };

        const setCharactersMode = (nextMode: 'incremental' | 'differential') => {
            if (charactersMode === nextMode) return;
            const currentRaw = parseInput(charactersInput.value);
            if (nextMode === 'differential') {
                charactersInput.value = String(baselineCharacters + currentRaw);
            } else {
                charactersInput.value = String(Math.max(0, currentRaw - baselineCharacters));
            }
            charactersMode = nextMode;
            setModeButtonState();
            updateFieldHints();
        };

        const validateDifferentialInput = async (rawDuration: number, rawCharacters: number): Promise<boolean> => {
            if (durationMode === 'differential' && rawDuration < baselineDuration) {
                await customAlert("Invalid Total", `Duration total cannot be lower than current total (${formatNumber(baselineDuration)} mins).`);
                return false;
            }
            if (charactersMode === 'differential' && rawCharacters < baselineCharacters) {
                await customAlert("Invalid Total", `Character total cannot be lower than current total (${formatNumber(baselineCharacters)} chars).`);
                return false;
            }
            return true;
        };

        const normalizeIncrementalValue = (mode: 'incremental' | 'differential', rawValue: number, baseline: number): number =>
            mode === 'differential' ? Math.max(0, rawValue - baseline) : rawValue;

        durationModeIncBtn.addEventListener('click', () => setDurationMode('incremental'));
        durationModeDiffBtn.addEventListener('click', () => setDurationMode('differential'));
        charactersModeIncBtn.addEventListener('click', () => setCharactersMode('incremental'));
        charactersModeDiffBtn.addEventListener('click', () => setCharactersMode('differential'));
        mediaInput.addEventListener('change', refreshBaselines);
        mediaInput.addEventListener('input', refreshBaselines);
        durationInput.addEventListener('input', updateFieldHints);
        charactersInput.addEventListener('input', updateFieldHints);
        setModeButtonState();
        refreshBaselines();

        if (editLog || prefillMediaTitle) {
            durationInput.focus();
        } else {
            mediaInput.focus();
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

        const resolveMediaId = async (title: string): Promise<number | null> => {
            const existingMedia = mediaList.find(m => m.title.toLowerCase() === title.toLowerCase());
            if (existingMedia?.id) {
                if (existingMedia.status === 'Archived') {
                    existingMedia.status = 'Active';
                    await updateMedia(existingMedia);
                }
                return existingMedia.id;
            }

            const typeResp = await customPrompt(`"${title}" is new! What type of media is this?`, "Reading");
            if (!typeResp) return null;
            
            return await addMedia({ 
                title, 
                media_type: typeResp, 
                status: "Active", 
                language: "Japanese", 
                description: "", 
                cover_image: "", 
                extra_data: "{}", 
                content_type: "Unknown", 
                tracking_status: "Ongoing" 
            });
        };

        overlay.querySelector('#activity-cancel')!.addEventListener('click', () => { newCleanup(); resolve(false); });
        overlay.querySelector('#add-activity-form')!.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mediaTitleRaw = mediaInput.value.trim();
            const mediaTitle = mediaTitleRaw || (editLog ? editLog.title : '');
            const rawDuration = parseInput(durationInput.value);
            const rawCharacters = parseInput(charactersInput.value);
            refreshBaselines();
            if (!await validateDifferentialInput(rawDuration, rawCharacters)) {
                return;
            }
            const duration = normalizeIncrementalValue(durationMode, rawDuration, baselineDuration);
            const characters = normalizeIncrementalValue(charactersMode, rawCharacters, baselineCharacters);
            
            // Use mobile date input if visible, otherwise use calendar date
            const mobileDateField = overlay.querySelector<HTMLElement>('#mobile-date-field')!;
            const isMobileDateVisible = globalThis.getComputedStyle(mobileDateField).display !== 'none';
            const dateToSave = isMobileDateVisible 
                ? overlay.querySelector<HTMLInputElement>('#mobile-date-input')!.value || selectedDate
                : selectedDate;
            
            if (!mediaTitle) {
                await customAlert("Required Field", "Please enter a Media Title.");
                return;
            }
            if (duration <= 0 && characters <= 0) {
                await customAlert("Input Required", "Please enter either duration or characters.");
                return;
            }

            try {
                const activityType = overlay.querySelector<HTMLSelectElement>('#activity-type')!.value;
                if (editLog) {
                    await updateLog({
                        id: editLog.id,
                        media_id: editLog.media_id,
                        duration_minutes: duration,
                        characters,
                        date: dateToSave,
                        activity_type: activityType
                    });
                } else {
                    const mediaId = await resolveMediaId(mediaTitle);
                    if (mediaId === null) return;
                    await addLog({ media_id: mediaId, duration_minutes: duration, characters, date: dateToSave, activity_type: activityType });
                }
                newCleanup();
                resolve(true);
            } catch (err) {
                Logger.error("Failed to save activity", err);
                await customAlert("Error", "Failed to save activity: " + err);
            }
        });
    });
}

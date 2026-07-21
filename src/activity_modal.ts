import { getAllMedia, addLog, updateLog, addMedia, updateMedia, ActivitySummary, Media } from './api';
import { ACTIVITY_TYPES } from './constants';
import { buildCalendar } from './calendar';
import { customPrompt, customAlert, createCancelableOverlay } from './modal_base';
import { Logger } from './logger';
import { escapeHTML } from './html';

type ActivityType = typeof ACTIVITY_TYPES[number];

const pad = (n: number) => n.toString().padStart(2, '0');
const getTodayStr = () => {
    const today = new Date();
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
};

export async function showExportCsvModal(): Promise<{mode: 'all' | 'range', start?: string, end?: string} | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null));
        
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
        buildCalendar(overlay.querySelector<HTMLElement>('#cal-start-container')!, todayStr, (d) => selectedStart = d);
        buildCalendar(overlay.querySelector<HTMLElement>('#cal-end-container')!, todayStr, (d) => selectedEnd = d);

        const modeRange = overlay.querySelector<HTMLInputElement>('input[value="range"]')!;
        const rangeInputs = overlay.querySelector<HTMLElement>('#export-range-inputs')!;
        overlay.querySelectorAll('input[name="export-mode"]').forEach(el => el.addEventListener('change', () => rangeInputs.style.display = modeRange.checked ? 'flex' : 'none'));
        
        overlay.querySelector('#export-cancel')!.addEventListener('click', dismiss);
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

export async function showLogActivityModal(prefillMediaId?: number, editLog?: ActivitySummary): Promise<boolean> {
    const mediaList = await getAllMedia();
    return new Promise((resolve) => {
        const baseHandle = createCancelableOverlay(() => resolve(false), { closeOnEscape: true });
        const { overlay } = baseHandle;
        let suggestionHideTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        const cleanup = () => {
            if (suggestionHideTimer) {
                globalThis.clearTimeout(suggestionHideTimer);
                suggestionHideTimer = null;
            }
            baseHandle.cleanup();
        };
        const dismiss = () => {
            if (suggestionHideTimer) {
                globalThis.clearTimeout(suggestionHideTimer);
                suggestionHideTimer = null;
            }
            baseHandle.dismiss();
        };
        const activeMedia = mediaList.filter(m => m.status !== 'Archived' && m.tracking_status === 'Ongoing');
        const mediaById = new Map(mediaList
            .filter((media): media is Media & { id: number } => typeof media.id === 'number')
            .map(media => [media.id, media]));
        const initialMediaId = editLog?.media_id ?? prefillMediaId;
        const initialMedia = typeof initialMediaId === 'number' ? mediaById.get(initialMediaId) : undefined;
        let selectedMediaId = initialMedia?.id ?? null;
        const escapedTitle = escapeHTML(initialMedia?.title ?? editLog?.title ?? '');

        const isActivityType = (activityType: string | undefined): activityType is ActivityType =>
            typeof activityType === 'string' && ACTIVITY_TYPES.includes(activityType as ActivityType);

        const getDefaultActivityType = (media: Media | undefined): ActivityType | undefined => {
            const defaultActivityType = media?.default_activity_type;
            return isActivityType(defaultActivityType) ? defaultActivityType : undefined;
        };

        // Determine the default activity type
        const defaultActivityType = editLog?.activity_type || getDefaultActivityType(initialMedia) || 'Reading';
            
        overlay.innerHTML = `
            <div class="modal-content" style="width: 450px;">
                <h3>${editLog ? 'Edit Activity' : 'Log Activity'}</h3>
                <form id="add-activity-form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; position: relative; z-index: 2">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="activity-media" role="combobox" aria-autocomplete="list" aria-controls="activity-media-suggestions" aria-expanded="false" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" value="${escapedTitle}" ${editLog ? 'disabled' : ''} required oninvalid="this.setCustomValidity('Media Title is required')" oninput="this.setCustomValidity('')" />
                        <div id="activity-media-variant" style="display: none; color: var(--text-secondary); font-size: 0.78rem;"></div>
                        <div id="activity-media-suggestions" role="listbox" style="display: none; margin-top: 0.35rem; max-height: 11rem; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: color-mix(in srgb, var(--bg-card) 94%, black 6%); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22); position: absolute; top: 100%; left: 0; right: 0;"></div>
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
                            <label style="font-size: 0.85rem; color: var(--text-secondary);">Duration (mins)</label>
                            <input type="number" id="activity-duration" value="${editLog?.duration_minutes || 0}" min="0" step="1" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                        </div>
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                            <label style="font-size: 0.85rem; color: var(--text-secondary);">Characters</label>
                            <input type="number" id="activity-characters" value="${editLog?.characters || 0}" min="0" step="1" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                        </div>
                    </div>
                    <div id="desktop-date-field" style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Date</label>
                        <div id="activity-cal-container"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Notes</label>
                        <textarea id="activity-notes" rows="3" placeholder="Optional notes or reminders…" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; height: 4.5rem; resize: none; overflow-y: auto; font: inherit;">${escapeHTML(editLog?.notes || '')}</textarea>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem;">
                        <button type="button" class="btn btn-ghost" id="activity-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary">${editLog ? 'Update Activity' : 'Log Activity'}</button>
                    </div>
                </form>
            </div>`;

        let selectedDate = editLog?.date || getTodayStr();
        buildCalendar(overlay.querySelector<HTMLElement>('#activity-cal-container')!, selectedDate, (d) => selectedDate = d);

        // Set default date for mobile input
        const mobileDateInput = overlay.querySelector<HTMLInputElement>('#mobile-date-input')!;
        mobileDateInput.value = selectedDate;

        const titleInput = overlay.querySelector<HTMLInputElement>('#activity-media')!;
        const suggestionList = overlay.querySelector<HTMLElement>('#activity-media-suggestions')!;
        const activityTypeSelect = overlay.querySelector<HTMLSelectElement>('#activity-type')!;
        const mediaVariantLabel = overlay.querySelector<HTMLElement>('#activity-media-variant')!;
        let suggestionMatches: Array<Media & { id: number }> = [];
        let highlightedSuggestionIndex = -1;

        const syncSelectedMediaContext = (media: Media | undefined, updateActivityType: boolean) => {
            const variant = media?.variant?.trim() || '';
            mediaVariantLabel.textContent = variant;
            mediaVariantLabel.style.display = variant ? 'block' : 'none';
            if (updateActivityType) {
                const mediaDefaultActivityType = getDefaultActivityType(media);
                if (mediaDefaultActivityType) {
                    activityTypeSelect.value = mediaDefaultActivityType;
                }
            }
        };

        const hideSuggestions = () => {
            suggestionList.style.display = 'none';
            suggestionList.innerHTML = '';
            suggestionMatches = [];
            highlightedSuggestionIndex = -1;
            titleInput.setAttribute('aria-expanded', 'false');
            titleInput.removeAttribute('aria-activedescendant');
        };

        const selectMedia = (media: Media & { id: number }) => {
            selectedMediaId = media.id;
            titleInput.value = media.title;
            syncSelectedMediaContext(media, true);
            hideSuggestions();
            titleInput.focus({ preventScroll: true });
        };

        if (!editLog) {
            const handleSuggestionPointerDown = (event: PointerEvent) => {
                const target = event.target;
                if (!(target instanceof HTMLElement) || !target.closest('.activity-media-suggestion')) {
                    return;
                }
                event.preventDefault();
            };

            const handleSuggestionClick = (event: MouseEvent) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                const button = target.closest<HTMLButtonElement>('.activity-media-suggestion');
                if (!button) {
                    return;
                }
                const mediaId = Number.parseInt(button.dataset.mediaId || '', 10);
                const media = mediaById.get(mediaId);
                if (media?.id !== undefined) {
                    selectMedia(media as Media & { id: number });
                }
            };

            const renderSuggestions = () => {
                const query = titleInput.value.trim().toLowerCase();
                const activeMatches = activeMedia
                    .filter(media => query.length === 0
                        || media.title.toLowerCase().includes(query)
                        || (media.variant || '').toLowerCase().includes(query));
                // Preserve the old ability to pick an archived/paused entry by its exact
                // title without filling the normal suggestion list with inactive media.
                const exactInactiveMatches = query.length === 0 ? [] : mediaList.filter(media =>
                    !activeMedia.includes(media) && media.title.trim().toLowerCase() === query);
                suggestionMatches = [...activeMatches, ...exactInactiveMatches]
                    .filter((media): media is Media & { id: number } => typeof media.id === 'number')
                    .slice(0, 8);
                highlightedSuggestionIndex = -1;

                if (suggestionMatches.length === 0 || document.activeElement !== titleInput) {
                    hideSuggestions();
                    return;
                }

                suggestionList.innerHTML = suggestionMatches.map((media, index) => {
                    let inactiveState = '';
                    if (media.status === 'Archived') {
                        inactiveState = 'Archived';
                    } else if (media.tracking_status !== 'Ongoing') {
                        inactiveState = media.tracking_status;
                    }
                    const inactiveStateHtml = inactiveState
                        ? `<span style="color: var(--text-secondary); font-size: 0.7rem;">${escapeHTML(inactiveState)}</span>`
                        : '';
                    return `
                    <button
                        type="button"
                        class="activity-media-suggestion"
                        id="activity-media-suggestion-${index}"
                        role="option"
                        aria-selected="false"
                        data-media-id="${media.id}"
                        data-media-title="${escapeHTML(media.title)}"
                        data-media-variant="${escapeHTML(media.variant || '')}"
                        style="display: flex; flex-direction: column; gap: 0.15rem; width: 100%; padding: 0.65rem 0.8rem; border: none; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; font: inherit;"
                    >
                        <span>${escapeHTML(media.title)}</span>
                        ${media.variant ? `<span style="color: var(--text-secondary); font-size: 0.78rem;">${escapeHTML(media.variant)}</span>` : ''}
                        ${inactiveStateHtml}
                    </button>
                `;
                }).join('');
                suggestionList.style.display = 'block';
                titleInput.setAttribute('aria-expanded', 'true');
            };

            const highlightSuggestion = (index: number) => {
                if (suggestionMatches.length === 0) return;
                highlightedSuggestionIndex = (index + suggestionMatches.length) % suggestionMatches.length;
                suggestionList.querySelectorAll<HTMLElement>('.activity-media-suggestion').forEach((option, optionIndex) => {
                    const isHighlighted = optionIndex === highlightedSuggestionIndex;
                    option.setAttribute('aria-selected', String(isHighlighted));
                    option.style.background = isHighlighted ? 'rgba(255,255,255,0.08)' : 'transparent';
                    if (isHighlighted) option.scrollIntoView?.({ block: 'nearest' });
                });
                titleInput.setAttribute('aria-activedescendant', `activity-media-suggestion-${highlightedSuggestionIndex}`);
            };

            suggestionList.addEventListener('pointerdown', handleSuggestionPointerDown);
            suggestionList.addEventListener('click', handleSuggestionClick);

            titleInput.addEventListener('focus', renderSuggestions);
            titleInput.addEventListener('input', () => {
                selectedMediaId = null;
                syncSelectedMediaContext(undefined, false);
                renderSuggestions();
            });
            titleInput.addEventListener('blur', () => {
                suggestionHideTimer = globalThis.setTimeout(() => {
                    hideSuggestions();
                }, 120);
            });
            titleInput.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    hideSuggestions();
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (suggestionList.style.display === 'none') renderSuggestions();
                    highlightSuggestion(highlightedSuggestionIndex + (event.key === 'ArrowDown' ? 1 : -1));
                    return;
                }
                if (event.key === 'Enter' && highlightedSuggestionIndex >= 0) {
                    event.preventDefault();
                    const media = suggestionMatches[highlightedSuggestionIndex];
                    if (media) selectMedia(media);
                }
            });
        }

        syncSelectedMediaContext(initialMedia, false);

        if (editLog || initialMedia) {
            overlay.querySelector<HTMLInputElement>('#activity-duration')!.focus();
        } else {
            titleInput.focus();
        }

        const createMedia = async (title: string): Promise<number | null> => {
            const typeResp = await customPrompt(`"${title}" is new! What type of media is this?`, "Reading");
            if (!typeResp) return null;
            
            return await addMedia({ 
                title, 
                default_activity_type: typeResp,
                status: "Active", 
                language: "Japanese", 
                description: "", 
                cover_image: "", 
                extra_data: "{}", 
                content_type: "Unknown", 
                tracking_status: "Ongoing" 
            });
        };

        const resolveMediaIdForSubmission = async (mediaTitle: string): Promise<number | null> => {
            let selectedMedia = selectedMediaId === null ? undefined : mediaById.get(selectedMediaId);
            // A programmatic value change without an input event must not retain a
            // stale selection. The ID is authoritative only while its displayed title
            // still matches the selected record.
            if (selectedMedia && mediaTitle !== selectedMedia.title) {
                selectedMedia = undefined;
                selectedMediaId = null;
            }

            if (selectedMedia?.id !== undefined) {
                if (selectedMedia.status === 'Archived') {
                    await updateMedia({ ...selectedMedia, status: 'Active' });
                }
                return selectedMedia.id;
            }

            const sameTitleExists = mediaList.some(media =>
                media.title.trim().toLowerCase() === mediaTitle.toLowerCase());
            if (sameTitleExists) {
                await customAlert(
                    "Select Media",
                    "Choose the intended media entry from the suggestions. Titles can have multiple variants."
                );
                titleInput.focus();
                titleInput.dispatchEvent(new Event('focus'));
                return null;
            }

            return createMedia(mediaTitle);
        };

        overlay.querySelector('#activity-cancel')!.addEventListener('click', dismiss);
        overlay.querySelector('#add-activity-form')!.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mediaTitleRaw = overlay.querySelector<HTMLInputElement>('#activity-media')!.value.trim();
            const mediaTitle = mediaTitleRaw || (editLog ? editLog.title : '');
            const duration = Number.parseInt(overlay.querySelector<HTMLInputElement>('#activity-duration')!.value, 10) || 0;
            const characters = Number.parseInt(overlay.querySelector<HTMLInputElement>('#activity-characters')!.value, 10) || 0;
            
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
                const notes = overlay.querySelector<HTMLTextAreaElement>('#activity-notes')!.value;
                if (editLog) {
                    await updateLog({
                        id: editLog.id,
                        media_id: editLog.media_id,
                        duration_minutes: duration,
                        characters,
                        date: dateToSave,
                        activity_type: activityType,
                        notes
                    });
                } else {
                    const mediaId = await resolveMediaIdForSubmission(mediaTitle);
                    if (mediaId === null) return;
                    await addLog({ media_id: mediaId, duration_minutes: duration, characters, date: dateToSave, activity_type: activityType, notes });
                }
                cleanup();
                if (suggestionHideTimer) {
                    globalThis.clearTimeout(suggestionHideTimer);
                }
                resolve(true);
            } catch (err) {
                Logger.error("Failed to save activity", err);
                await customAlert("Error", "Failed to save activity: " + err);
            }
        });
    });
}

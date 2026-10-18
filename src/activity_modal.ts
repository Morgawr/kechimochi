import {
    getAllMedia,
    getSetting,
    addLog,
    updateLog,
    addMedia,
    updateMedia,
    ActivitySummary,
    Media,
    ActivityCsvAnalysis,
    ActivityCsvConflictResolution,
} from './api';
import { ACTIVITY_TYPES, SETTING_KEYS } from './constants';
import { buildCalendar, normalizeWeekStartDay, YEAR_BLOCK_SIZE, type DatePicker } from './calendar';
import { SHEET_LAYOUT_MEDIA_QUERY } from './popups';
import { customPrompt, customAlert, createCancelableOverlay } from './modal_base';
import { Logger } from './logger';
import { escapeHTML, escapeAttribute } from './html';
import {
    DURATION_INPUT_PLACEHOLDER,
    DURATION_INPUT_TOOLTIP,
    EPISODE_DURATION_INPUT_PLACEHOLDER,
    EPISODE_DURATION_INPUT_TOOLTIP,
    wireDurationInput,
    canonicalAnchor,
    formatLogDateRelativeTo,
    formatReducedDate,
    isContainedInBucket,
    logDateKey,
    precisionKeyLength,
    type DateAnchor,
    type DateScope,
} from './time';
import { COUNT_INPUT_PLACEHOLDER, readCount, wireDigitsOnlyInput } from './counts';
import {
    MISSING_INPUTS_ALERT_TITLE,
    describeMissingAmount,
    formatMissingInputsMessage,
    syncConfirmButton,
} from './log_entry_validation';
import { resolveEpisodeDurationMinutes, wireEpisodeStepper } from './media/episodes';
import { setEpisodeDurationOverride } from './media/media_actions';
import { FORK, MINUS, PENCIL, PLUS, renderIcon } from './icons';

type ActivityType = typeof ACTIVITY_TYPES[number];

const DATE_SCOPES: readonly DateScope[] = ['day', 'month', 'year'];

const pad = (n: number) => n.toString().padStart(2, '0');
const getTodayStr = (): DateAnchor => {
    const today = new Date();
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` as DateAnchor;
};

export async function showExportCsvModal(): Promise<{mode: 'all' | 'range', start?: string, end?: string} | null> {
    const weekStartDaySetting = await getSetting(SETTING_KEYS.WEEK_START_DAY);
    const weekStartDay = normalizeWeekStartDay(weekStartDaySetting);
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
                <div id="export-range-inputs" style="display: none; align-items: flex-start; gap: 1.5rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-elevated);">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;"><label style="font-size: 0.85rem; color: var(--text-secondary);">Start Date</label><div id="cal-start-container"></div></div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;"><label style="font-size: 0.85rem; color: var(--text-secondary);">End Date</label><div id="cal-end-container"></div></div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="export-cancel">Cancel</button>
                    <button class="btn btn-primary" id="export-confirm">Export</button>
                </div>
            </div>`;
        
        let selectedStart: string = todayStr;
        let selectedEnd: string = todayStr;
        buildCalendar(overlay.querySelector<HTMLElement>('#cal-start-container')!, todayStr, (d) => selectedStart = d, { weekStartDay });
        buildCalendar(overlay.querySelector<HTMLElement>('#cal-end-container')!, todayStr, (d) => selectedEnd = d, { weekStartDay });

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

export async function showActivityCsvConflictModal(
    analysis: ActivityCsvAnalysis,
): Promise<ActivityCsvConflictResolution[] | null> {
    const conflicts = analysis.groups.filter(group => group.existing_count > 0);
    if (conflicts.length === 0) return [];

    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null));
        const rowsHtml = conflicts.map((group, index) => {
            const content = group.content;
            const overlap = Math.min(group.existing_count, group.incoming_count);
            const durationUnit = content.duration === 1 ? 'minute' : 'minutes';
            const characterUnit = content.characters === 1 ? 'character' : 'characters';
            const metrics = [
                content.duration > 0 ? `${content.duration} ${durationUnit}` : '',
                content.characters > 0 ? `${content.characters.toLocaleString()} ${characterUnit}` : '',
            ].filter(Boolean).join(' and ');
            return `
                <div class="activity-csv-conflict" data-conflict-index="${index}" style="padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 0.5rem;">
                    <div style="font-weight: 600;">${escapeHTML(content.log_name)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        ${escapeHTML(formatReducedDate(content.date))} · ${escapeHTML(content.activity_type)} · ${escapeHTML(metrics)}
                        ${content.media_variant ? ` · Variant: ${escapeHTML(content.media_variant)}` : ''}
                    </div>
                    ${content.notes ? `<div style="font-size: 0.8rem; white-space: pre-wrap;">Notes: ${escapeHTML(content.notes)}</div>` : ''}
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        ${group.existing_count} matching ${group.existing_count === 1 ? 'activity' : 'activities'} already in the profile; ${group.incoming_count} in this CSV. Up to ${overlap} may overlap.
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.3rem; cursor: pointer;">
                            <input type="radio" name="activity-conflict-${index}" value="skip_possible_overlaps" />
                            Skip ${overlap} possible ${overlap === 1 ? 'overlap' : 'overlaps'}
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.3rem; cursor: pointer;">
                            <input type="radio" name="activity-conflict-${index}" value="import_all" />
                            Import all ${group.incoming_count} as separate ${group.incoming_count === 1 ? 'activity' : 'activities'}
                        </label>
                    </div>
                </div>`;
        }).join('');

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 720px; width: 92vw; max-height: 90vh; display: flex; flex-direction: column; gap: 1rem;">
                <h3>Possible Duplicate Activities</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;">
                    These rows exactly match existing activity content. Identical activities can still be separate occurrences, so choose how to handle every group. Existing activities will never be changed or deleted.
                </p>
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    <button type="button" class="btn btn-secondary" id="activity-conflict-skip-all">Skip all possible overlaps</button>
                    <button type="button" class="btn btn-secondary" id="activity-conflict-import-all">Import every CSV row separately</button>
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; padding-right: 0.25rem;">
                    ${rowsHtml}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn btn-ghost" id="activity-conflict-cancel">Cancel Import</button>
                    <button type="button" class="btn btn-primary" id="activity-conflict-confirm">Continue</button>
                </div>
            </div>`;

        const selectAll = (action: 'skip_possible_overlaps' | 'import_all') => {
            overlay.querySelectorAll<HTMLInputElement>(`input[value="${action}"]`).forEach(input => {
                input.checked = true;
            });
        };
        overlay.querySelector('#activity-conflict-skip-all')!.addEventListener('click', () => {
            selectAll('skip_possible_overlaps');
        });
        overlay.querySelector('#activity-conflict-import-all')!.addEventListener('click', () => {
            selectAll('import_all');
        });
        overlay.querySelector('#activity-conflict-cancel')!.addEventListener('click', dismiss);
        overlay.querySelector('#activity-conflict-confirm')!.addEventListener('click', async () => {
            const resolutions: ActivityCsvConflictResolution[] = [];
            for (let index = 0; index < conflicts.length; index += 1) {
                const selected = overlay.querySelector<HTMLInputElement>(
                    `input[name="activity-conflict-${index}"]:checked`,
                );
                if (!selected) {
                    await customAlert(
                        'Resolution Required',
                        'Choose how to handle every possible duplicate activity before continuing.',
                    );
                    return;
                }
                resolutions.push({
                    content: conflicts[index].content,
                    action: selected.value as ActivityCsvConflictResolution['action'],
                });
            }
            cleanup();
            resolve(resolutions);
        });
    });
}

export async function showLogActivityModal(prefillMediaId?: number, editLog?: ActivitySummary): Promise<boolean> {
    const [mediaList, weekStartDaySetting] = await Promise.all([
        getAllMedia(),
        getSetting(SETTING_KEYS.WEEK_START_DAY),
    ]);
    const weekStartDay = normalizeWeekStartDay(weekStartDaySetting);
    return new Promise((resolve) => {
        let hasSavedMediaChange = false;
        const baseHandle = createCancelableOverlay(() => resolve(hasSavedMediaChange), { closeOnEscape: true });
        const { overlay } = baseHandle;
        let suggestionHideTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        let closeDateModal: (() => void) | null = null;
        const cleanup = () => {
            if (suggestionHideTimer) {
                globalThis.clearTimeout(suggestionHideTimer);
                suggestionHideTimer = null;
            }
            closeDateModal?.();
            baseHandle.cleanup();
        };
        const dismiss = () => {
            if (suggestionHideTimer) {
                globalThis.clearTimeout(suggestionHideTimer);
                suggestionHideTimer = null;
            }
            closeDateModal?.();
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
        const initialScope: DateScope = editLog?.date_precision ?? 'day';
        const hasInitialNotes = Boolean(editLog?.notes?.trim());

        overlay.innerHTML = `
            <div class="modal-content activity-modal-content" style="width: 450px;">
                <div class="activity-modal-header">
                    <h3>${editLog ? 'Edit Activity' : 'Log Activity'}</h3>
                    <p id="activity-media-variant-row" class="activity-modal-variant" hidden>
                        <span class="activity-modal-variant-icon" aria-hidden="true">${renderIcon(FORK)}</span>
                        <span id="activity-media-variant" class="activity-modal-variant-text"></span>
                    </p>
                </div>
                <form id="add-activity-form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; position: relative; z-index: 2">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="activity-media" role="combobox" aria-autocomplete="list" aria-controls="activity-media-suggestions" aria-expanded="false" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" value="${escapedTitle}" ${editLog ? 'disabled' : ''} required oninvalid="this.setCustomValidity('Media Title is required')" oninput="this.setCustomValidity('')" />
                        <div id="activity-media-suggestions" role="listbox" style="display: none; margin-top: 0.35rem; max-height: 11rem; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: color-mix(in srgb, var(--bg-card) 94%, black 6%); box-shadow: 0 14px 34px color-mix(in srgb, var(--tint-dark) 22%, transparent); position: absolute; top: 100%; left: 0; right: 0;"></div>
                    </div>
                    <div class="activity-modal-columns activity-amount-columns">
                        <div class="activity-modal-field">
                            <label id="activity-duration-label" class="activity-modal-label">Duration</label>
                            <div id="activity-duration-field" class="inline-action-field">
                                <button type="button" id="activity-episode-decrement" class="inline-action-button" aria-label="Remove one episode" hidden>${renderIcon(MINUS)}</button>
                                <input type="text" id="activity-duration" class="inline-action-field-input" aria-labelledby="activity-duration-label" autocomplete="off" placeholder="${escapeAttribute(DURATION_INPUT_PLACEHOLDER)}" title="${escapeAttribute(DURATION_INPUT_TOOLTIP)}" value="${editLog ? String(editLog.duration_minutes) : ''}" />
                                <button type="button" id="activity-episode-increment" class="inline-action-button" aria-label="Add one episode" hidden>${renderIcon(PLUS)}</button>
                            </div>
                            <div class="duration-hint-row">
                                <div id="activity-duration-hint" class="duration-hint"></div>
                                <span id="activity-episode-duration-hint" class="activity-episode-duration-hint" hidden>
                                    <span aria-hidden="true">·</span>
                                    <button type="button" id="activity-episode-edit" class="activity-episode-duration-link" aria-label="Change episode duration" aria-describedby="activity-episode-duration-value" title="Change episode duration"><span><span id="activity-episode-duration-value"></span>/ep</span>${renderIcon(PENCIL)}</button>
                                </span>
                            </div>
                        </div>
                        <div class="activity-modal-field">
                            <label class="activity-modal-label">Characters</label>
                            <input type="text" id="activity-characters" inputmode="numeric" autocomplete="off" placeholder="${escapeAttribute(COUNT_INPUT_PLACEHOLDER)}" value="${editLog?.characters ? String(editLog.characters) : ''}" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%;" />
                        </div>
                    </div>
                    <div class="activity-modal-columns">
                        <div class="activity-modal-field">
                            <span id="activity-type-label" class="activity-modal-label">Activity Type</span>
                            <select id="activity-type" aria-labelledby="activity-type-label">
                                ${ACTIVITY_TYPES.map(t => `<option value="${t}" ${t === defaultActivityType ? 'selected' : ''}>${t}</option>`).join('')}
                            </select>
                        </div>
                        <div class="activity-modal-field">
                            <span id="activity-date-label" class="activity-modal-label">Date</span>
                            <button type="button" id="activity-date-trigger" class="field-trigger" aria-labelledby="activity-date-label activity-date-trigger-value" aria-expanded="false" aria-controls="activity-date-panel">
                                <span id="activity-date-trigger-value" class="field-trigger-value"></span>
                                <span class="field-trigger-chevron" aria-hidden="true"></span>
                            </button>
                        </div>
                    </div>
                    <div id="activity-date-slot" class="activity-date-slot">
                        <div id="activity-date-panel" class="activity-date-panel" hidden>
                            <div id="activity-date-picker-content" class="activity-date-picker-content"></div>
                        </div>
                    </div>
                    <div class="activity-modal-field">
                        <button type="button" id="activity-notes-toggle" class="activity-notes-toggle" aria-expanded="${hasInitialNotes}" aria-controls="activity-notes-section" ${hasInitialNotes ? 'hidden' : ''}>${renderIcon(PLUS)}<span>Add note</span></button>
                        <div id="activity-notes-section" class="activity-modal-field" ${hasInitialNotes ? '' : 'hidden'}>
                            <label id="activity-notes-label" class="activity-modal-label">Notes</label>
                            <textarea id="activity-notes" aria-labelledby="activity-notes-label" rows="3" placeholder="Optional notes or reminders…" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; height: 4.5rem; resize: none; overflow-y: auto; font: inherit;">${escapeHTML(editLog?.notes || '')}</textarea>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem;">
                        <button type="button" class="btn btn-ghost" id="activity-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="activity-submit">${editLog ? 'Update Activity' : 'Log Activity'}</button>
                    </div>
                </form>
            </div>`;

        let scope: DateScope = initialScope;
        let selectedDate: DateAnchor = editLog?.date ? (editLog.date as DateAnchor) : getTodayStr();
        let lastPick: { scope: DateScope; value: DateAnchor } | null = null;
        let activeDatePicker: DatePicker | null = null;
        let hasUserPickedADate = editLog !== undefined;

        const pickerContent = overlay.querySelector<HTMLElement>('#activity-date-picker-content')!;
        const dateSlot = overlay.querySelector<HTMLElement>('#activity-date-slot')!;
        const datePanel = overlay.querySelector<HTMLElement>('#activity-date-panel')!;
        const dateTrigger = overlay.querySelector<HTMLButtonElement>('#activity-date-trigger')!;
        const dateTriggerValue = overlay.querySelector<HTMLElement>('#activity-date-trigger-value')!;

        const handlePick = (value: DateAnchor): void => {
            selectedDate = value;
            hasUserPickedADate = true;
            lastPick = { scope, value };
            renderDateTrigger();
        };

        const isSelectionInView = (): boolean => {
            const viewAnchor = activeDatePicker?.getViewAnchor();
            if (!viewAnchor) return true;
            if (scope === 'year') {
                const blockOrigin = Number(viewAnchor.slice(0, 4));
                const selectedYear = Number(selectedDate.slice(0, 4));
                return selectedYear >= blockOrigin && selectedYear < blockOrigin + YEAR_BLOCK_SIZE;
            }
            const viewScope: DateScope = scope === 'day' ? 'month' : 'year';
            const viewKey = logDateKey({ date: viewAnchor, date_precision: viewScope });
            return isContainedInBucket({ date: selectedDate, date_precision: 'day' }, viewKey);
        };

        const renderDateTrigger = (): void => {
            dateTriggerValue.textContent = formatLogDateRelativeTo({ date: selectedDate, date_precision: scope }, getTodayStr());
        };

        // Picks the anchor a scope switch lands on.
        // The selection and the visible period are separate.
        // A value the user picked always wins.
        const deriveAnchorForScope = (targetScope: DateScope): DateAnchor => {
            const viewAnchor = activeDatePicker?.getViewAnchor();
            const base = hasUserPickedADate || isSelectionInView() || !viewAnchor
                ? selectedDate
                : viewAnchor;

            const isNarrowing = precisionKeyLength(targetScope) > precisionKeyLength(scope);
            if (!isNarrowing || hasUserPickedADate) return canonicalAnchor(base, targetScope);

            const todayStr = getTodayStr();
            const basePeriodKey = logDateKey({ date: base, date_precision: scope });
            const containsToday = isContainedInBucket({ date: todayStr, date_precision: 'day' }, basePeriodKey);
            return canonicalAnchor(containsToday ? todayStr : base, targetScope);
        };

        const mountDatePicker = (shouldFocus: boolean, viewAnchor?: DateAnchor): void => {
            const nextContent = document.createElement('div');
            nextContent.innerHTML = '<div id="activity-cal-container"></div>';
            const nextPicker = buildCalendar(
                nextContent.querySelector<HTMLElement>('#activity-cal-container')!,
                logDateKey({ date: selectedDate, date_precision: scope }),
                (picked) => handlePick(canonicalAnchor(picked, scope)),
                { scope, scopes: DATE_SCOPES, onScopeSelect: switchDateScope, weekStartDay, viewAnchor },
            );

            activeDatePicker?.destroy();
            pickerContent.replaceChildren(...nextContent.childNodes);
            activeDatePicker = nextPicker;

            renderDateTrigger();
            if (shouldFocus) activeDatePicker.focus();
        };

        function switchDateScope(nextScope: DateScope): void {
            const nextValue = lastPick?.scope === nextScope
                ? lastPick.value
                : deriveAnchorForScope(nextScope);
            const nextViewAnchor = isSelectionInView() ? nextValue : activeDatePicker?.getViewAnchor();
            scope = nextScope;
            selectedDate = nextValue;
            mountDatePicker(false, nextViewAnchor);
            activeDatePicker?.focusScopeTab();
        }

        mountDatePicker(false);

        const setDatePanelExpanded = (isExpanded: boolean): void => {
            datePanel.hidden = !isExpanded;
            dateTrigger.setAttribute('aria-expanded', String(isExpanded));
        };

        const isDateModalLayout = (): boolean => globalThis.matchMedia?.(SHEET_LAYOUT_MEDIA_QUERY).matches ?? false;

        const openDateModal = (): void => {
            const layoutQuery = globalThis.matchMedia?.(SHEET_LAYOUT_MEDIA_QUERY) ?? null;
            const dateModalHandle = createCancelableOverlay(() => {
                layoutQuery?.removeEventListener?.('change', closeOnLayoutChange);
                closeDateModal = null;
                dateSlot.appendChild(datePanel);
                setDatePanelExpanded(false);
                dateTrigger.focus();
            }, { closeOnEscape: true });
            const closeOnLayoutChange = () => dateModalHandle.dismiss();
            dateModalHandle.overlay.innerHTML = '<div class="modal-content activity-date-modal-content" role="dialog" aria-modal="true" aria-label="Date"></div>';
            dateModalHandle.overlay.querySelector('.activity-date-modal-content')!.appendChild(datePanel);
            layoutQuery?.addEventListener?.('change', closeOnLayoutChange);
            closeDateModal = () => dateModalHandle.dismiss();
            setDatePanelExpanded(true);
            activeDatePicker?.focus();
        };

        dateTrigger.addEventListener('click', () => {
            if (isDateModalLayout()) {
                openDateModal();
                return;
            }
            setDatePanelExpanded(datePanel.hidden);
        });
        dateTrigger.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || datePanel.hidden) return;
            event.preventDefault();
            dismiss();
        });

        const notesToggle = overlay.querySelector<HTMLButtonElement>('#activity-notes-toggle')!;
        const notesSection = overlay.querySelector<HTMLElement>('#activity-notes-section')!;
        notesToggle.addEventListener('click', () => {
            notesSection.hidden = false;
            notesToggle.hidden = true;
            notesToggle.setAttribute('aria-expanded', 'true');
            overlay.querySelector<HTMLTextAreaElement>('#activity-notes')!.focus();
        });

        const durationInput = overlay.querySelector<HTMLInputElement>('#activity-duration')!;
        const durationHint = overlay.querySelector<HTMLElement>('#activity-duration-hint')!;
        const submitButton = overlay.querySelector<HTMLButtonElement>('#activity-submit')!;
        const charactersInput = overlay.querySelector<HTMLInputElement>('#activity-characters')!;
        const titleInput = overlay.querySelector<HTMLInputElement>('#activity-media')!;
        const listMissingInputs = (): string[] => {
            const missingInputs: string[] = [];
            if (!titleInput.value.trim() && !editLog) missingInputs.push('a media title');
            const missingAmount = describeMissingAmount(getDurationMinutes(), readCount(charactersInput));
            if (missingAmount) missingInputs.push(missingAmount);
            return missingInputs;
        };
        const syncSubmitButton = () => syncConfirmButton(submitButton, listMissingInputs());
        const getEpisodeContextMedia = (): (Media & { id: number }) | undefined => {
            if (editLog) return mediaById.get(editLog.media_id);
            const media = selectedMediaId === null ? undefined : mediaById.get(selectedMediaId);
            return media?.title === titleInput.value.trim() ? media : undefined;
        };
        const getEpisodeDurationMinutes = () => resolveEpisodeDurationMinutes(getEpisodeContextMedia());
        const { getDurationMinutes, refresh: refreshDurationHint } = wireDurationInput(
            durationInput,
            durationHint,
            syncSubmitButton,
            { getEpisodeDurationMinutes },
        );
        const episodeEditButton = overlay.querySelector<HTMLButtonElement>('#activity-episode-edit')!;
        const episodeStepper = wireEpisodeStepper({
            durationField: overlay.querySelector<HTMLElement>('#activity-duration-field')!,
            decrementButton: overlay.querySelector<HTMLButtonElement>('#activity-episode-decrement')!,
            incrementButton: overlay.querySelector<HTMLButtonElement>('#activity-episode-increment')!,
            episodeDurationHint: overlay.querySelector<HTMLElement>('#activity-episode-duration-hint')!,
            episodeDurationLabel: overlay.querySelector<HTMLElement>('#activity-episode-duration-value')!,
        }, durationInput, getEpisodeDurationMinutes);
        const refreshEpisodeContext = () => {
            const isEpisodic = getEpisodeDurationMinutes() !== null;
            durationInput.placeholder = isEpisodic ? EPISODE_DURATION_INPUT_PLACEHOLDER : DURATION_INPUT_PLACEHOLDER;
            durationInput.title = isEpisodic ? EPISODE_DURATION_INPUT_TOOLTIP : DURATION_INPUT_TOOLTIP;
            refreshDurationHint();
            episodeStepper.refresh();
            syncSubmitButton();
        };
        episodeEditButton.addEventListener('click', async () => {
            const media = getEpisodeContextMedia();
            if (!media) return;
            const outcome = await setEpisodeDurationOverride(media);
            if (outcome.committed && outcome.updatedMedia) {
                hasSavedMediaChange = true;
                mediaById.set(media.id, { ...outcome.updatedMedia, id: media.id });
                refreshEpisodeContext();
            }
            episodeEditButton.focus();
        });
        wireDigitsOnlyInput(charactersInput);
        charactersInput.addEventListener('input', syncSubmitButton);
        titleInput.addEventListener('input', syncSubmitButton);
        refreshEpisodeContext();

        const suggestionList = overlay.querySelector<HTMLElement>('#activity-media-suggestions')!;
        const activityTypeSelect = overlay.querySelector<HTMLSelectElement>('#activity-type')!;
        const mediaVariantLabel = overlay.querySelector<HTMLElement>('#activity-media-variant')!;
        const mediaVariantRow = overlay.querySelector<HTMLElement>('#activity-media-variant-row')!;
        let suggestionMatches: Array<Media & { id: number }> = [];
        let highlightedSuggestionIndex = -1;

        const syncSelectedMediaContext = (media: Media | undefined, updateActivityType: boolean) => {
            const variant = media?.variant?.trim() || '';
            mediaVariantLabel.textContent = variant;
            mediaVariantRow.title = `Variant: ${variant}`;
            mediaVariantRow.hidden = !variant;
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
            refreshEpisodeContext();
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
                    option.style.background = isHighlighted ? 'color-mix(in srgb, var(--tint-light) 8%, transparent)' : 'transparent';
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
                refreshEpisodeContext();
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
            durationInput.focus();
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
        const form = overlay.querySelector<HTMLFormElement>('#add-activity-form')!;
        // A disabled submit button blocks the browser's Enter-to-submit, so Enter would otherwise do nothing.
        form.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.defaultPrevented || !submitButton.disabled) return;
            if (!(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            void customAlert(MISSING_INPUTS_ALERT_TITLE, formatMissingInputsMessage(listMissingInputs()));
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mediaTitleRaw = overlay.querySelector<HTMLInputElement>('#activity-media')!.value.trim();
            const mediaTitle = mediaTitleRaw || (editLog ? editLog.title : '');
            const duration = getDurationMinutes();
            const characters = readCount(charactersInput);
            const dateToSave = selectedDate;
            const scopeToSave = scope;

            if (duration === null || listMissingInputs().length > 0) return;

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
                        date_precision: scopeToSave,
                        activity_type: activityType,
                        notes
                    });
                } else {
                    const mediaId = await resolveMediaIdForSubmission(mediaTitle);
                    if (mediaId === null) return;
                    await addLog({ media_id: mediaId, duration_minutes: duration, characters, date: dateToSave, date_precision: scopeToSave, activity_type: activityType, notes });
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

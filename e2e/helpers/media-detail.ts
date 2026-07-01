/**
 * Media Detail helpers.
 */
import {
    submitPrompt,
    confirmAction,
    performActivityEdit,
    getTopmostVisibleOverlay,
    waitForOverlayToDisappear,
    safeClick,
    waitForNoActiveOverlays,
    selectActivityDate
} from './common.js';
import { getSelectValue, setText, setSelect } from './form-controls.js';
import { type LibraryLayoutMode, waitForLibraryLayout, waitForLibraryDisplayed, isLayoutToggleAvailable } from './library.js';
import type { ChainablePromiseElement } from 'webdriverio';

/**
 * Clicks the "Mark as Complete" button in Media Detail.
 */
export async function clickMarkAsComplete(): Promise<void> {
    const btn = $('#btn-mark-complete');
    await btn.waitForDisplayed({ timeout: 5000 });
    await safeClick(btn);

    // Wait for the tracking status badge to update to Complete
    await browser.waitUntil(async () => {
        return (await getSelectValue('#media-tracking-status')) === 'Complete';
    }, { timeout: 3000, timeoutMsg: 'Tracking status did not update to Complete' });
}

/**
 * Gets the current tracking status from the detail view dropdown.
 */
export async function getDetailTrackingStatus(): Promise<string> {
    return (await getSelectValue('#media-tracking-status')) ?? '';
}

/**
 * Checks if the archived/active toggle is in the "Active" position.
 */
export async function isArchivedStatusActive(): Promise<boolean> {
    const selector = '#status-label';
    await $(selector).waitForExist({ timeout: 5000 });

    // Re-fetch each poll: a status toggle re-renders the label, so a held handle goes stale.
    await browser.waitUntil(async () => {
        const text = await $(selector).getText();
        return text === 'Archive' || text === 'Archived';
    }, {
        timeout: 5000,
        timeoutMsg: 'Status label did not settle on Archive or Archived'
    });

    return (await $(selector).getText()) === 'Archive';
}

/**
 * Toggles the archived/active status in the detail view.
 */
export async function toggleArchivedStatusDetail(): Promise<void> {
    const initialStatus = await isArchivedStatusActive();
    const btn = $('#btn-toggle-archive');
    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();

    // Wait for the status label to flip
    await browser.waitUntil(async () => {
        return (await isArchivedStatusActive()) !== initialStatus;
    }, { timeout: 3000, timeoutMsg: 'Archive status label did not toggle' });
}

/**
 * Leaves the Media Detail view back to the library, on any platform.
 *
 * Desktop/web show a "Back to Library" button (#btn-back-grid). Mobile hides
 * #media-back-slot, so there is no button; dispatching Escape triggers
 * MediaView's keydown handler, which exits detail the same way.
 */
async function exitMediaDetail(): Promise<void> {
    await waitForNoActiveOverlays().catch(() => {});
    const backButton = $('#btn-back-grid');
    const hasBackButton = await backButton.waitForDisplayed({ timeout: 1000 }).then(() => true).catch(() => false);
    if (hasBackButton) {
        await safeClick(backButton);
        return;
    }

    await browser.execute(() => {
        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
}

/**
 * Returns from Media Detail to the library view.
 */
export async function backToGrid(): Promise<void> {
    await exitMediaDetail();
    await waitForLibraryDisplayed();
}

/**
 * Returns from Media Detail and waits for the requested library layout where the
 * layout is selectable; on a list-only viewport (mobile) the request is moot, so
 * it just waits for the library to render.
 */
export async function backToLibrary(layout: LibraryLayoutMode): Promise<void> {
    await exitMediaDetail();
    await waitForLibraryDisplayed();
    if (await isLayoutToggleAvailable()) {
        await waitForLibraryLayout(layout);
    }
}

/**
 * Edits the description in Media Detail.
 */
export async function editDescription(newDescription: string): Promise<void> {
    await browser.waitUntil(async () => {
        const descEl = $('#media-description');
        return await descEl.isDisplayed().catch(() => false);
    }, {
        timeout: 5000,
        timeoutMsg: 'Description field never became visible'
    });

    await browser.waitUntil(async () => {
        const textarea = $('textarea');
        if (await textarea.isDisplayed().catch(() => false)) {
            return true;
        }

        const descEl = $('#media-description');
        await descEl.scrollIntoView();
        await descEl.doubleClick();
        return await textarea.isDisplayed().catch(() => false);
    }, {
        timeout: 3_000,
        interval: 150,
        timeoutMsg: 'Failed to enter description edit mode after retries'
    });

    const textarea = $('textarea');
    await textarea.waitForDisplayed({ timeout: 3000 });

    await browser.execute((value) => {
        const input = document.querySelector<HTMLTextAreaElement>('textarea.edit-input');
        if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
        }
    }, newDescription);

    await textarea.waitForDisplayed({ reverse: true, timeout: 5000 });
    const descEl = $('#media-description');
    await descEl.waitForDisplayed({ timeout: 5000 });
}

/**
 * Gets the current description from the media detail view.
 */
export async function getDescription(): Promise<string> {
    const el = $('#media-description');
    await el.waitForExist({ timeout: 5000 });

    // We wait a moment for text to settle, especially during re-renders
    let text = "";
    await browser.waitUntil(async () => {
        text = await el.getText();
        return text !== "" && text !== "No description provided. Double click here to add one.";
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Description text never appeared'
    }).catch(() => { }); // If it stays empty or placeholder, we just return current

    return await el.getText();
}

export async function isDescriptionCollapsed(): Promise<boolean> {
    const shell = $('.media-description-shell');
    await shell.waitForExist({ timeout: 5000 });
    const className = await shell.getAttribute('class');
    return (className || '').includes('is-collapsed');
}

export async function toggleDescriptionVisibility(expectedLabel: 'see more' | 'see less'): Promise<void> {
    const selector = '#media-description-toggle';
    await $(selector).waitForDisplayed({ timeout: 5000 });
    // Re-fetch each poll: expanding/collapsing re-renders the toggle, so a held handle goes stale.
    await browser.waitUntil(async () => {
        return (await $(selector).getText()).trim().toLowerCase() === expectedLabel;
    }, {
        timeout: 5000,
        timeoutMsg: `Description toggle did not show "${expectedLabel}"`
    });
    await $(selector).click();
}

/**
 * Gets the value of an extra field by its key in Media Detail.
 */
export async function getExtraField(key: string): Promise<string> {
    const selector = `.editable-extra[data-key="${key}"]`;
    await $(selector).waitForExist({ timeout: 5000 });

    // Re-fetch each poll: adding/editing a field re-renders the card, so a held handle goes stale.
    let text = "";
    await browser.waitUntil(async () => {
        text = await $(selector).getText();
        return text !== "" && text !== "-"; // "-" is our placeholder for empty
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Value for extra field "${key}" never settled`
    }).catch(() => { });

    return await $(selector).getText();
}

export async function addExtraField(key: string, value: string): Promise<void> {
    await waitForNoActiveOverlays();
    await safeClick('#btn-add-extra');

    // First prompt for key
    await submitPrompt(key);
    // Second prompt for value
    await submitPrompt(value);

    // Wait for the field to appear in the DOM
    const el = $(`.editable-extra[data-key="${key}"]`);
    await el.waitForExist({ timeout: 5000 });
}

/**
 * Edits an extra field value via double-click.
 */
export async function editExtraField(key: string, newValue: string): Promise<void> {
    const card = $(`.card[data-ekey="${key}"]`);
    await card.waitForDisplayed({ timeout: 5000 });

    const el = card.$(`.editable-extra[data-key="${key}"]`);
    await el.waitForDisplayed({ timeout: 5000 });
    await el.scrollIntoView();

    const inputSelector = `.card[data-ekey="${key}"] .edit-input`;

    // Perform double click to open edit mode with retries
    await browser.waitUntil(async () => {
        const input = $(inputSelector);
        if (await input.isExisting() && await input.isDisplayed()) return true;

        const label = $(`.card[data-ekey="${key}"] .editable-extra[data-key="${key}"]`);
        if (await label.isExisting()) {
            await label.scrollIntoView();
            await label.doubleClick();
        }

        const newInput = $(inputSelector);
        return await newInput.isExisting() && await newInput.isDisplayed();
    }, { timeout: 5000, interval: 1000, timeoutMsg: `Failed to open edit mode for ${key}` });

    const input = $(inputSelector);
    await input.waitForClickable({ timeout: 2000 });

    // Use execute to set value and blur (which triggers save)
    // This is most robust against driver-level timing issues
    await browser.execute((sel, val) => {
        const inputEl = document.querySelector(sel) as HTMLInputElement;
        if (inputEl) {
            inputEl.value = val;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            inputEl.blur();
        }
    }, inputSelector, newValue);

    // Wait for the input to disappear (indicating save/re-render)
    await input.waitForDisplayed({ reverse: true, timeout: 5000 });

    // Additional verification: ensure the label text eventually matches the new value
    const labelSelector = `.card[data-ekey="${key}"] .editable-extra[data-key="${key}"]`;
    await browser.waitUntil(async () => {
        return (await $(labelSelector).getText()) === newValue;
    }, { timeout: 5000, timeoutMsg: `Extra field "${key}" value did not update in UI to "${newValue}"` });
}

/**
 * Gets the text value of a projection badge (remaining or completion).
 */
export async function getProjectionValue(id: string): Promise<string> {
    const el = $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const strong = el.$('strong');
    return await strong.getText();
}

type MilestoneFormValues = {
    name: string;
    hours: string;
    minutes: string;
    characters?: string;
    pickDate?: boolean;
};

async function waitForMilestoneCardReady(): Promise<void> {
    const list = $('#milestone-list-container');
    await list.waitForDisplayed({ timeout: 5000 });
    await waitForNoActiveOverlays(5000);

    const addBtn = $('#btn-add-milestone');
    await addBtn.waitForDisplayed({ timeout: 5000 });
}

async function openMilestoneModal(): Promise<ChainablePromiseElement> {
    await waitForMilestoneCardReady();
    await safeClick('#btn-add-milestone');

    const overlay = await getTopmostVisibleOverlay('#milestone-name');
    const nameInput = overlay.$('#milestone-name');
    await nameInput.waitForDisplayed({ timeout: 5000 });
    return overlay;
}

async function populateMilestoneForm(overlay: ChainablePromiseElement, values: MilestoneFormValues): Promise<string | null> {
    await setText('#milestone-name', values.name);
    await setText('#milestone-hours', values.hours);
    await setText('#milestone-minutes', values.minutes);
    await setText('#milestone-characters', values.characters ?? '0');

    let selectedDate: string | null = null;
    if (typeof values.pickDate === 'boolean') {
        const recordDateCheckbox = overlay.$('#milestone-record-date');
        const checked = await recordDateCheckbox.isSelected();
        if (checked !== values.pickDate) {
            await safeClick(recordDateCheckbox);
        }
    }

    if (values.pickDate) {
        const recordDateCheckbox = overlay.$('#milestone-record-date');
        await browser.waitUntil(async () => recordDateCheckbox.isSelected(), {
            timeout: 5000,
            timeoutMsg: 'Milestone date checkbox did not become selected'
        });

        const firstDay = overlay.$('.cal-day');
        await firstDay.waitForDisplayed({ timeout: 5000 });
        selectedDate = await firstDay.getAttribute('data-date');
        await safeClick(firstDay);
    }

    return selectedDate;
}

async function waitForMilestoneActionToSettle(): Promise<void> {
    await waitForNoActiveOverlays(5000);
    await browser.waitUntil(async () => {
        const list = $('#milestone-list-container');
        const addBtn = $('#btn-add-milestone');
        const listVisible = await list.isDisplayed().catch(() => false);
        const addVisible = await addBtn.isDisplayed().catch(() => false);
        return listVisible && addVisible;
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Milestone panel did not settle after the action'
    });
}
/**
 * Adds a new milestone.
 */
export async function addMilestone(name: string, hours: string, minutes: string, characters: string = "0", pickDate: boolean = false): Promise<string | null> {
    const overlay = await openMilestoneModal();
    const selectedDate = await populateMilestoneForm(overlay, { name, hours, minutes, characters, pickDate });

    await safeClick(() => overlay.$('#milestone-confirm'));
    await waitForOverlayToDisappear(overlay, 5000);
    await waitForMilestoneActionToSettle();

    return selectedDate;
}

export async function getMilestonePrefillValues(): Promise<{ hours: string; minutes: string; characters: string; }> {
    const overlay = await openMilestoneModal();
    const hours = await overlay.$('#milestone-hours').getValue() as string;
    const minutes = await overlay.$('#milestone-minutes').getValue() as string;
    const characters = await overlay.$('#milestone-characters').getValue() as string;

    await safeClick(() => overlay.$('#milestone-cancel'));
    await waitForOverlayToDisappear(overlay, 5000);
    await waitForMilestoneActionToSettle();

    return { hours, minutes, characters };
}

export async function submitInvalidMilestone(name: string, hours: string, minutes: string, characters: string = '0'): Promise<void> {
    const overlay = await openMilestoneModal();
    await populateMilestoneForm(overlay, { name, hours, minutes, characters });
    await safeClick(() => overlay.$('#milestone-confirm'));
}

export async function deleteMilestoneByName(name: string): Promise<void> {
    await waitForMilestoneCardReady();

    const item = $(`.milestone-item[data-milestone-name="${name}"]`);
    await item.waitForDisplayed({ timeout: 5000 });
    await item.scrollIntoView();

    const deleteBtn = item.$('.delete-milestone-btn');
    await safeClick(deleteBtn);
    await confirmAction(true);

    await browser.waitUntil(async () => {
        return !(await $(`.milestone-item[data-milestone-name="${name}"]`).isExisting().catch(() => false));
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Milestone "${name}" did not disappear after deletion`
    });

    await waitForMilestoneActionToSettle();
}

export async function editMilestoneByName(name: string, values: MilestoneFormValues): Promise<void> {
    await waitForMilestoneCardReady();

    const item = $(`.milestone-item[data-milestone-name="${name}"]`);
    await item.waitForDisplayed({ timeout: 5000 });
    await item.scrollIntoView();

    const editBtn = item.$('.edit-milestone-btn');
    await safeClick(editBtn);

    const overlay = await getTopmostVisibleOverlay('#milestone-name');
    await overlay.$('#milestone-name').waitForDisplayed({ timeout: 5000 });

    await populateMilestoneForm(overlay, values);
    await safeClick(() => overlay.$('#milestone-confirm'));
    await waitForOverlayToDisappear(overlay, 5000);
    await waitForMilestoneActionToSettle();
}

/**
 * Clears all milestones for the current media.
 */
export async function clearAllMilestones(): Promise<void> {
    await waitForMilestoneCardReady();

    const clearBtn = $('#btn-clear-milestones');
    if (!(await clearBtn.isExisting().catch(() => false))) {
        return;
    }

    await safeClick(clearBtn);
    await confirmAction(true);
    await browser.waitUntil(async () => {
        const text = await getMilestoneListText();
        return text.includes('No milestones yet.');
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Milestone list did not return to the empty state after clearing'
    });
    await waitForMilestoneActionToSettle();
}

/**
 * Gets the consolidated text of the milestone list.
 */
export async function getMilestoneListText(): Promise<string> {
    const list = $('#milestone-list-container');
    await list.waitForDisplayed({ timeout: 5000 });
    return await list.getText();
}

/**
 * Logs an activity directly from the Media Detail view using the "+ New Entry" button.
 */
export async function logActivityFromDetail(expectedTitle: string, duration: string, characters: string = "0", activityType?: string): Promise<void> {
    await waitForNoActiveOverlays();
    await safeClick('#btn-new-media-entry');

    const overlay = await getTopmostVisibleOverlay('#add-activity-form', 5000);
    const modal = overlay.$('.modal-content');
    await modal.waitForDisplayed({ timeout: 5000 });

    const titleInput = overlay.$('#activity-media');
    await titleInput.waitForDisplayed({ timeout: 5000 });
    const currentValue = await titleInput.getValue();
    if (currentValue !== expectedTitle) {
        await setText('#activity-media', expectedTitle);
    }

    const durationInput = overlay.$('#activity-duration');
    await browser.waitUntil(async () => await durationInput.isFocused(), {
        timeout: 2000,
        timeoutMsg: 'Duration input should be focused when modal opens with pre-filled title'
    });
    await setText('#activity-duration', duration);

    const charInput = overlay.$('#activity-characters');
    if (await charInput.isExisting()) {
        await setText('#activity-characters', characters);
    }

    if (activityType) {
        const typeSelect = overlay.$('#activity-type');
        if (await typeSelect.isExisting()) {
            await setSelect('#activity-type', { text: activityType });
        }
    }

    // Pick today in the calendar
    await selectActivityDate();

    await safeClick(() => overlay.$('#add-activity-form button[type="submit"]'));

    // Wait for modal to disappear
    await waitForOverlayToDisappear(overlay, 5000);
    await browser.waitUntil(async () => {
        for await (const entry of $$('.media-detail-log-item')) {
            const text = await entry.getText().catch(() => '');
            if (text.includes(`${duration} Minutes`)) {
                return await entry.isDisplayed().catch(() => false);
            }
        }
        return false;
    }, {
        timeout: 5_000,
        timeoutMsg: `Activity log entry for ${duration} Minutes did not appear after creating an entry`
    });
}

/**
 * Edits the most recent log in the Media Detail view.
 */
export async function editMostRecentLogFromDetail(newDuration: string, newCharacters: string = "0"): Promise<void> {
    const logItem = $('.media-detail-log-item');
    await logItem.waitForDisplayed({ timeout: 5000 });
    const logId = await logItem.getAttribute('data-id');

    await performActivityEdit('.media-detail-log-item .edit-log-btn', newDuration, newCharacters);

    await browser.waitUntil(async () => {
        const updatedItem = $(`.media-detail-log-item[data-id="${logId}"][data-duration-minutes="${newDuration}"][data-characters="${newCharacters}"]`);
        return await updatedItem.isDisplayed().catch(() => false);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Edited activity log ${logId} did not render with ${newDuration} Minutes`
    });
}

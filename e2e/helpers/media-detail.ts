/**
 * Media Detail helpers.
 */
/// <reference types="@wdio/globals/types" />
import { submitPrompt, confirmAction } from './common.js';

/**
 * Clicks the "Mark as Complete" button in Media Detail.
 */
export async function clickMarkAsComplete(): Promise<void> {
    const btn = $('#btn-mark-complete');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();

    // Wait for the tracking status badge to update to Complete
    const trackingStatus = $('#media-tracking-status');
    await browser.waitUntil(async () => {
        return (await trackingStatus.getValue()) === 'Complete';
    }, { timeout: 3000, timeoutMsg: 'Tracking status did not update to Complete' });
}

/**
 * Gets the current tracking status from the detail view dropdown.
 */
export async function getDetailTrackingStatus(): Promise<string> {
    const select = $('#media-tracking-status');
    return (await select.getValue()) as string;
}

/**
 * Checks if the archived/active toggle is in the "Active" position.
 */
export async function isArchivedStatusActive(): Promise<boolean> {
    const label = $('#status-label');
    await label.waitForExist({ timeout: 5000 });

    // We wait until the text is either ACTIVE or ARCHIVED to avoid checking during transitions
    await browser.waitUntil(async () => {
        const text = await label.getText();
        return text === 'ACTIVE' || text === 'ARCHIVED';
    }, {
        timeout: 5000,
        timeoutMsg: 'Status label did not settle on ACTIVE or ARCHIVED'
    });

    return (await label.getText()) === 'ACTIVE';
}

/**
 * Toggles the archived/active status in the detail view.
 */
export async function toggleArchivedStatusDetail(): Promise<void> {
    const initialStatus = await isArchivedStatusActive();
    const slider = $('#status-toggle + .slider');
    await slider.waitForClickable({ timeout: 2000 });
    await slider.click();

    // Wait for the status label to flip
    await browser.waitUntil(async () => {
        return (await isArchivedStatusActive()) !== initialStatus;
    }, { timeout: 3000, timeoutMsg: 'Archive status label did not toggle' });
}

/**
 * Clicks the "Back to Grid" button in Media Detail.
 */
export async function backToGrid(): Promise<void> {
    const btn = $('#btn-back-grid');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();

    // Wait for the detail view to be gone/grid to be displayed
    const grid = $('#media-grid-container');
    await grid.waitForDisplayed({ timeout: 5000 });
}

/**
 * Clicks the back button in the media detail view.
 * @deprecated Use backToGrid instead if targeting the same element
 */
export async function clickBackButton(): Promise<void> {
    const btn = $('#btn-back-grid');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    await browser.pause(500); // Wait for transition
}

/**
 * Edits the description in Media Detail.
 */
export async function editDescription(newDescription: string): Promise<void> {
    const descEl = $('#media-description');
    await descEl.waitForDisplayed({ timeout: 5000 });
    await descEl.doubleClick();

    const textarea = $('textarea');
    await textarea.waitForDisplayed({ timeout: 5000 });
    await textarea.setValue(newDescription);

    // Blur to save
    await browser.keys(['Tab']);
    await browser.pause(500); // Wait for re-render
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

/**
 * Gets the value of an extra field by its key in Media Detail.
 */
export async function getExtraField(key: string): Promise<string> {
    const el = $(`.editable-extra[data-key="${key}"]`);
    await el.waitForExist({ timeout: 5000 });

    let text = "";
    await browser.waitUntil(async () => {
        text = await el.getText();
        return text !== "" && text !== "-"; // "-" is our placeholder for empty
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Value for extra field "${key}" never settled`
    }).catch(() => { });

    return await el.getText();
}

export async function addExtraField(key: string, value: string): Promise<void> {
    const btn = $('#btn-add-extra');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();

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
    }, { timeout: 10000, interval: 1000, timeoutMsg: `Failed to open edit mode for ${key}` });

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
    const label = $(`.card[data-ekey="${key}"] .editable-extra[data-key="${key}"]`);
    await browser.waitUntil(async () => {
        return (await label.getText()) === newValue;
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
/**
 * Adds a new milestone.
 */
export async function addMilestone(name: string, hours: string, minutes: string, pickDate: boolean = false): Promise<string | null> {
    const addBtn = $('#btn-add-milestone');
    await addBtn.waitForClickable({ timeout: 5000 });
    await addBtn.click();

    const nameInput = $('#milestone-name');
    await nameInput.waitForDisplayed({ timeout: 5000 });
    await nameInput.setValue(name);

    await $('#milestone-hours').setValue(hours);
    await $('#milestone-minutes').setValue(minutes);

    let selectedDate: string | null = null;
    if (pickDate) {
        await $('#milestone-record-date').click();
        const firstDay = $('.cal-day');
        await firstDay.waitForDisplayed({ timeout: 5000 });
        const dataset = await firstDay.getProperty('dataset') as Record<string, string>;
        selectedDate = dataset.date;
        await firstDay.click();
    }

    await $('#milestone-confirm').click();
    return selectedDate;
}

/**
 * Deletes a milestone by index.
 */
export async function deleteMilestone(index: number): Promise<void> {
    const deleteBtns = await $$('.delete-milestone-btn');
    if (deleteBtns[index]) {
        await deleteBtns[index].click();
        await confirmAction(true);
    }
}

/**
 * Clears all milestones for the current media.
 */
export async function clearAllMilestones(): Promise<void> {
    const clearBtn = $('#btn-clear-milestones');
    await clearBtn.waitForClickable({ timeout: 5000 });
    await clearBtn.click();
    await confirmAction(true);
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
export async function logActivityFromDetail(expectedTitle: string, duration: string): Promise<void> {
    const newEntryBtn = $('#btn-new-media-entry');
    await newEntryBtn.waitForDisplayed({ timeout: 5000 });
    await newEntryBtn.click();

    const modal = $('.modal-content');
    await modal.waitForDisplayed({ timeout: 5000 });

    const titleInput = $('#activity-media');
    expect(await titleInput.getValue()).toBe(expectedTitle);

    const durationInput = $('#activity-duration');
    await browser.waitUntil(async () => await durationInput.isFocused(), {
        timeout: 2000,
        timeoutMsg: 'Duration input should be focused when modal opens with pre-filled title'
    });
    await durationInput.setValue(duration);


    // Pick today in the calendar
    const todayCell = $('.cal-day.today');
    await todayCell.waitForClickable({ timeout: 2000 });
    await todayCell.click();

    const submitBtn = $('#add-activity-form button[type="submit"]');
    await submitBtn.click();

    // Wait for modal to disappear
    await modal.waitForDisplayed({ reverse: true, timeout: 5000 });
    await browser.pause(500); // Wait for re-render of logs
}


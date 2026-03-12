/**
 * Media Detail helpers.
 */
/// <reference types="@wdio/globals/types" />
import { submitPrompt, confirmAction } from './common.js';

/**
 * Clicks the "Mark as Complete" button in Media Detail.
 */
export async function clickMarkAsComplete(): Promise<void> {
    const btn = await $('#btn-mark-complete');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();
    
    // Wait for the tracking status badge to update to Complete
    const trackingStatus = await $('#media-tracking-status');
    await browser.waitUntil(async () => {
        return (await trackingStatus.getValue()) === 'Complete';
    }, { timeout: 3000, timeoutMsg: 'Tracking status did not update to Complete' });
}

/**
 * Gets the current tracking status from the detail view dropdown.
 */
export async function getDetailTrackingStatus(): Promise<string> {
    const select = await $('#media-tracking-status');
    return (await select.getValue()) as string;
}

/**
 * Checks if the archived/active toggle is in the "Active" position.
 */
export async function isArchivedStatusActive(): Promise<boolean> {
    const label = await $('#status-label');
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
    const slider = await $('#status-toggle + .slider');
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
    const btn = await $('#btn-back-grid');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    
    // Wait for the detail view to be gone/grid to be displayed
    const grid = await $('#media-grid-container');
    await grid.waitForDisplayed({ timeout: 5000 });
}

/**
 * Clicks the back button in the media detail view.
 * @deprecated Use backToGrid instead if targeting the same element
 */
export async function clickBackButton(): Promise<void> {
    const btn = await $('#btn-back-grid');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    await browser.pause(500); // Wait for transition
}

/**
 * Edits the description in Media Detail.
 */
export async function editDescription(newDescription: string): Promise<void> {
    const descEl = await $('#media-desc');
    await descEl.waitForDisplayed({ timeout: 5000 });
    await descEl.doubleClick();
    
    const textarea = await $('textarea');
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
    const el = await $('#media-desc');
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
    }).catch(() => {}); // If it stays empty or placeholder, we just return current
    
    return await el.getText();
}

/**
 * Gets the value of an extra field by its key in Media Detail.
 */
export async function getExtraField(key: string): Promise<string> {
    const el = await $(`.editable-extra[data-key="${key}"]`);
    await el.waitForExist({ timeout: 5000 });
    return await el.getText();
}

export async function addExtraField(key: string, value: string): Promise<void> {
    const btn = await $('#btn-add-extra');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    
    // First prompt for key
    await submitPrompt(key);
    // Second prompt for value
    await submitPrompt(value);
    
    await browser.pause(500); // Wait for re-render
}

/**
 * Edits an extra field value via double-click.
 */
export async function editExtraField(key: string, newValue: string): Promise<void> {
    const card = await $(`.card[data-ekey="${key}"]`);
    await card.waitForDisplayed({ timeout: 5000 });
    
    const el = await card.$(`.editable-extra[data-key="${key}"]`);
    await el.waitForDisplayed({ timeout: 5000 });
    await el.scrollIntoView();
    
    // Using double click
    await el.doubleClick();
    
    // Wait for input to appear
    const input = await card.$('input.edit-input');
    await input.waitForDisplayed({ timeout: 5000 });
    
    // Click to focus and use keys to set value
    await input.click();
    
    // Clear existing value if any (though it should be empty or InitialValue replaced)
    // We can use Ctrl+A and Backspace
    await browser.keys(['Control', 'a']);
    await browser.keys(['Backspace']);
    await browser.keys(newValue);
    
    // Verify value was set in the input before blurring
    await browser.waitUntil(async () => {
        return (await input.getValue()) === newValue;
    }, { timeout: 3000, timeoutMsg: `Failed to set value to "${newValue}" in extra field "${key}"` });
    
    // Save by pressing Enter
    await browser.keys(['Enter']);
    await browser.pause(1500); // Wait for re-render
}

/**
 * Gets the text value of a projection badge (remaining or completion).
 */
export async function getProjectionValue(id: string): Promise<string> {
    const el = await $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const strong = await el.$('strong');
    return await strong.getText();
}
/**
 * Adds a new milestone.
 */
export async function addMilestone(name: string, hours: string, minutes: string, pickDate: boolean = false): Promise<string | null> {
    const addBtn = await $('#btn-add-milestone');
    await addBtn.waitForClickable({ timeout: 5000 });
    await addBtn.click();
    
    const nameInput = await $('#milestone-name');
    await nameInput.waitForDisplayed({ timeout: 5000 });
    await nameInput.setValue(name);
    
    await (await $('#milestone-hours')).setValue(hours);
    await (await $('#milestone-minutes')).setValue(minutes);
    
    let selectedDate: string | null = null;
    if (pickDate) {
        await (await $('#milestone-record-date')).click();
        const firstDay = await $('.cal-day');
        await firstDay.waitForDisplayed({ timeout: 5000 });
        selectedDate = await firstDay.getAttribute('data-date');
        await firstDay.click();
    }
    
    await (await $('#milestone-confirm')).click();
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
    const clearBtn = await $('#btn-clear-milestones');
    await clearBtn.waitForClickable({ timeout: 5000 });
    await clearBtn.click();
    await confirmAction(true);
}

/**
 * Gets the consolidated text of the milestone list.
 */
export async function getMilestoneListText(): Promise<string> {
    const list = await $('#milestone-list-container');
    await list.waitForDisplayed({ timeout: 5000 });
    return await list.getText();
}

/**
 * Logs an activity directly from the Media Detail view using the "+ New Entry" button.
 */
export async function logActivityFromDetail(expectedTitle: string, duration: string): Promise<void> {
    const newEntryBtn = await $('#btn-new-media-entry');
    await newEntryBtn.waitForDisplayed({ timeout: 5000 });
    await newEntryBtn.click();

    const modal = await $('.modal-content');
    await modal.waitForDisplayed({ timeout: 5000 });

    const titleInput = await $('#activity-media');
    expect(await titleInput.getValue()).toBe(expectedTitle);

    const durationInput = await $('#activity-duration');
    await browser.waitUntil(async () => await durationInput.isFocused(), {
        timeout: 2000,
        timeoutMsg: 'Duration input should be focused when modal opens with pre-filled title'
    });
    await durationInput.setValue(duration);


    // Pick today in the calendar
    const todayCell = await $('.cal-day.today');
    await todayCell.waitForClickable({ timeout: 2000 });
    await todayCell.click();

    const submitBtn = await $('#add-activity-form button[type="submit"]');
    await submitBtn.click();

    // Wait for modal to disappear
    await modal.waitForDisplayed({ reverse: true, timeout: 5000 });
    await browser.pause(500); // Wait for re-render of logs
}


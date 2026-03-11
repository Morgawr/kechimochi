/**
 * Media Detail helpers.
 */
/// <reference types="@wdio/globals/types" />
import { submitPrompt } from './common.js';

/**
 * Clicks the "Mark as Complete" button in Media Detail.
 */
export async function clickMarkAsComplete(): Promise<void> {
    const initialStatus = await isArchivedStatusActive();
    const btn = await $('#btn-mark-complete');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();
    
    // Mark complete should flip the status away from ACTIVE
    if (initialStatus) {
        await browser.waitUntil(async () => {
            return (await isArchivedStatusActive()) === false;
        }, { timeout: 3000, timeoutMsg: 'Mark complete did not update status label' });
    }
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
    return await el.getText();
}

/**
 * Gets the value of an extra field by its key in Media Detail.
 */
export async function getExtraField(key: string): Promise<string> {
    const el = await $(`.editable-extra[data-key="${key}"]`);
    if (!(await el.isExisting())) return "";
    return await el.getText();
}

/**
 * Adds an extra field to the current media item.
 */
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
 * Gets the text value of a projection badge (remaining or completion).
 */
export async function getProjectionValue(id: string): Promise<string> {
    const el = await $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const strong = await el.$('strong');
    return await strong.getText();
}

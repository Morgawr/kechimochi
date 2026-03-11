/**
 * Dashboard-specific helpers.
 */
/// <reference types="@wdio/globals/types" />
import { navigateTo, verifyActiveView } from './navigation.js';

/**
 * High-level helper to log an activity from the dashboard
 */
export async function logActivity(title: string, duration: string, date?: string): Promise<void> {
    if (!(await verifyActiveView('dashboard'))) {
        await navigateTo('dashboard');
    }

    const addActivityBtn = await $('#btn-add-activity');
    await addActivityBtn.click();

    const mediaInput = await $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 5000 });
    await mediaInput.setValue(title);

    const durationInput = await $('#activity-duration');
    await durationInput.setValue(duration);

    if (date) {
        const dateEl = await $(`.cal-day[data-date="${date}"]`);
        if (await dateEl.isExisting()) {
            await dateEl.click();
        }
    }

    const submitBtn = await $('#add-activity-form button[type="submit"]');
    await submitBtn.click();
}

/**
 * Gets a numeric value from a dashboard stat element.
 */
export async function getStatValue(id: string): Promise<number> {
    const el = await $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const text = await el.getText();
    // Use regex to extract numbers including commas or decimals if any
    const match = text.match(/[\d,.]+/);
    if (!match) return 0;
    return parseFloat(match[0].replace(/,/g, ''));
}

/**
 * Deletes the most recent log in the dashboard timeline.
 */
export async function deleteMostRecentLog(): Promise<void> {
    const btn = await $('.delete-log-btn');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();
    
    // Use the robust confirm helper
    await confirmAction(true);
}

/**
 * Returns the background-color style of a heatmap cell for a given date.
 */
export async function getHeatmapCellColor(date: string): Promise<string> {
    const cell = await $(`.heatmap-cell[title^="${date}"]`);
    await cell.waitForExist({ timeout: 5000 });
    return await cell.getCSSProperty('background-color').then(p => p.value || '');
}

/**
 * Logs activity using the global (+) button in the navbar.
 */
export async function logActivityGlobal(mediaTitle: string, minutes: number): Promise<void> {
    const logBtn = await $('#btn-add-activity');
    await logBtn.waitForDisplayed({ timeout: 5000 });
    await logBtn.click();
    
    // Select media (it's an input with datalist)
    const mediaInput = await $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 5000 });
    await mediaInput.setValue(mediaTitle);
    
    // Set minutes
    const minInput = await $('#activity-duration');
    await minInput.setValue(minutes);
    
    const form = await $('#add-activity-form');
    const confirmBtn = await form.$('button[type="submit"]');
    await confirmBtn.click();
    await browser.pause(500); // Wait for re-render
}

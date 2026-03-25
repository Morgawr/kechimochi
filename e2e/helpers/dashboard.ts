/**
 * Dashboard-specific helpers.
 */
/// <reference types="@wdio/globals/types" />
import { confirmAction, performActivityEdit, safeClick } from './common.js';

/**
 * High-level helper to log an activity from the dashboard
 */
export async function logActivity(title: string, duration: string, characters: string = "0", date?: string, activityType?: string): Promise<void> {
    const addActivityBtn = $('#btn-add-activity');
    await addActivityBtn.waitForClickable({ timeout: 5000 });
    await addActivityBtn.click();

    const mediaInput = $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 10000 });
    await mediaInput.setValue(title);

    const durationInput = $('#activity-duration');
    await durationInput.waitForDisplayed({ timeout: 5000 });
    await durationInput.setValue(duration);

    const charInput = $('#activity-characters');
    if (await charInput.isExisting()) {
        await charInput.setValue(characters);
    }

    if (activityType) {
        const typeSelect = $('#activity-type');
        if (await typeSelect.isExisting()) {
            await typeSelect.selectByVisibleText(activityType);
        }
    }

    if (date) {
        const dateEl = $(`.cal-day[data-date="${date}"]`);
        if (await dateEl.isExisting()) {
            await dateEl.click();
        }
    }

    const submitBtn = $('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 5000 });
    await submitBtn.click();
}

/**
 * Gets a numeric value from a dashboard stat element.
 */
export async function getStatValue(id: string): Promise<number> {
    const el = $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const text = await el.getText();
    // Extract first number (allowing for dots and commas)
    const match = text.match(/[\d,.]+/);
    if (!match) return 0;
    const cleanedText = match[0].replaceAll(',', '');
    return Number.parseFloat(cleanedText);
}

/**
 * Deletes the most recent log in the dashboard timeline.
 */
export async function deleteMostRecentLog(): Promise<void> {
    const btn = $('.delete-log-btn');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.waitForClickable({ timeout: 2000 });
    await btn.scrollIntoView();
    await btn.click();
    
    // Use the robust confirm helper
    await confirmAction(true);
    
    // Stabilize dashboard after deletion
    await browser.pause(300);
}

/**
 * Clicks the edit button for the most recent log in the dashboard timeline and updates it.
 */
export async function editMostRecentLog(newDuration: string, newCharacters: string = "0"): Promise<void> {
    await performActivityEdit('.dashboard-activity-item .edit-log-btn', newDuration, newCharacters);
}

/**
 * Returns the background-color style of a heatmap cell for a given date.
 */
export async function getHeatmapCellColor(date: string): Promise<string> {
    const cell = $(`.heatmap-cell[title^="${date}"]`);
    await cell.waitForExist({ timeout: 5000 });
    return await cell.getCSSProperty('background-color').then(p => p.value || '');
}

export async function clickHeatmapCell(date: string): Promise<void> {
    const cell = $(`.heatmap-cell[data-date="${date}"]`);
    await cell.waitForDisplayed({ timeout: 5000 });
    await safeClick(cell);
}

export async function selectActivityChartTimeRange(days: '7' | '30' | '365'): Promise<void> {
    const select = $('#select-time-range');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', days);
    await browser.waitUntil(async () => (await select.getValue()) === days, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Expected activity chart time range to be ${days}`
    });
}

export async function getActivityChartRangeMetadata(): Promise<{
    rangeStart: string;
    rangeEnd: string;
    timeRangeDays: string;
    timeRangeOffset: string;
}> {
    const getGrid = () => $('#activity-charts-grid');
    await getGrid().waitForDisplayed({ timeout: 5000 });

    await browser.waitUntil(async () => {
        const rangeStart = await getGrid().getAttribute('data-range-start');
        return Boolean(rangeStart);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Expected activity chart range metadata to be available'
    });

    return {
        rangeStart: (await getGrid().getAttribute('data-range-start')) ?? '',
        rangeEnd: (await getGrid().getAttribute('data-range-end')) ?? '',
        timeRangeDays: (await getGrid().getAttribute('data-time-range-days')) ?? '',
        timeRangeOffset: (await getGrid().getAttribute('data-time-range-offset')) ?? ''
    };
}

/**
 * Logs activity using the global (+) button in the navbar.
 */
export async function logActivityGlobal(mediaTitle: string, minutes: number, characters: number = 0, activityType?: string): Promise<void> {
    const logBtn = $('#btn-add-activity');
    await logBtn.waitForDisplayed({ timeout: 5000 });
    await logBtn.click();
    
    // Select media (it's an input with datalist)
    const mediaInput = $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 5000 });
    await mediaInput.setValue(mediaTitle);
    
    // Set minutes
    const minInput = $('#activity-duration');
    await minInput.setValue(minutes);

    const charInput = $('#activity-characters');
    if (await charInput.isExisting()) {
        await charInput.setValue(characters);
    }

    if (activityType) {
        const typeSelect = $('#activity-type');
        if (await typeSelect.isExisting()) {
            await typeSelect.selectByVisibleText(activityType);
        }
    }
    
    const form = $('#add-activity-form');
    const confirmBtn = form.$('button[type="submit"]');
    await confirmBtn.click();
    await browser.pause(500); // Original pause to wait for re-render
}

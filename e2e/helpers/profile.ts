/**
 * Profile view helpers.
 */
/// <reference types="@wdio/globals/types" />
import { Logger } from '../../src/core/logger';
import { dismissAlert } from './common.js';

/**
 * Triggers report calculation in the Profile view.
 */
export async function calculateReport(): Promise<void> {
    const reportAlertTimeout = 3000;
    const btn = $('#profile-btn-calculate-report');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();

    const successMessage = 'Reading report card calculated successfully!';
    await browser.waitUntil(async () => {
        return await browser.execute((text) => document.body.innerText.includes(text), successMessage);
    }, {
        timeout: reportAlertTimeout,
        timeoutMsg: 'Report success notification never appeared'
    });

    Logger.info(`[E2E-TRACE] calculateReport: ${successMessage}`);
    await dismissAlert(successMessage, reportAlertTimeout);
    await browser.pause(300);
}
/**
 * Exports milestones to a CSV file.
 */
export async function exportMilestones(): Promise<void> {
    const exportBtn = $('#profile-btn-export-milestones');
    await exportBtn.waitForDisplayed({ timeout: 5000 });
    
    await browser.execute(() => {
        const el = document.getElementById('profile-btn-export-milestones');
        if (el) el.click();
    });
    
    // Wait for the custom alert (using the robust body check)
    await browser.waitUntil(async () => {
        return await browser.execute(() => document.body.innerText.includes('Successfully exported'));
    }, { timeout: 20000, timeoutMsg: 'Export success notification never appeared' });
    
    const { dismissAlert } = await import('./common.js');
    await dismissAlert();
}

/**
 * Imports milestones from a CSV file.
 */
export async function importMilestones(): Promise<void> {
    const importBtn = $('#profile-btn-import-milestones');
    await importBtn.waitForDisplayed({ timeout: 5000 });
    
    await browser.execute(() => {
        const el = document.getElementById('profile-btn-import-milestones');
        if (el) el.click();
    });
    
    // Wait for the custom alert
    await browser.waitUntil(async () => {
        return await browser.execute(() => document.body.innerText.includes('Successfully imported'));
    }, { timeout: 20000, timeoutMsg: 'Import success notification never appeared' });
    
    const { dismissAlert } = await import('./common.js');
    await dismissAlert();
}

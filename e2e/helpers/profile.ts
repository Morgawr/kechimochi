/**
 * Profile view helpers.
 */
/// <reference types="@wdio/globals/types" />
import { Logger } from '../../src/core/logger';

/**
 * Triggers report calculation in the Profile view.
 */
export async function calculateReport(): Promise<void> {
    const btn = $('#profile-btn-calculate-report');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    
    // Wait for the success alert (modal-overlay + modal-content)
    const overlay = $('.modal-overlay');
    await overlay.waitForDisplayed({ timeout: 10000 });
    
    const title = overlay.$('h3');
    expect(await title.getText()).toBe('Success');
    
    const text = overlay.$('p');
    Logger.info(`[E2E-TRACE] calculateReport: ${await text.getText()}`);
    
    // Close it
    const okBtn = overlay.$('#alert-ok');
    await okBtn.click();
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

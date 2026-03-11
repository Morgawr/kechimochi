/**
 * Import and conflict resolution helpers.
 */
/// <reference types="@wdio/globals/types" />
import { dismissAlert } from './common.js';

/**
 * Handle the media import conflict modal.
 */
export async function resolveConflicts(action: 'keep' | 'replace'): Promise<void> {
    const modal = await $('.modal-content');
    await modal.waitForDisplayed({ timeout: 5000 });
    
    const radios = await $$(`input[value="${action}"]`);
    for (const radio of radios) {
        await radio.click();
    }
    
    const confirmBtn = await $('#conflict-confirm');
    await confirmBtn.click();
    
    await $('#alert-ok').waitForDisplayed({ timeout: 10000 });
    await dismissAlert();
}

/**
 * High-level helper to trigger metadata fetching for a given URL.
 */
export async function fetchMetadata(url: string): Promise<void> {
    const btn = await $('#btn-import-meta');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    
    const input = await $('#prompt-input');
    await input.waitForDisplayed({ timeout: 5000 });
    await input.setValue(url);
    
    const confirmBtn = await $('#prompt-confirm');
    await confirmBtn.click();
    
    // Wait for the merge modal to appear
    await $('.modal-content h3').waitForExist({ timeout: 10000 });
}

/**
 * Clicks the "Merge Selected Data" button in the import modal.
 */
export async function confirmMerge(): Promise<void> {
    const btn = await $('#import-confirm');
    await btn.waitForDisplayed({ timeout: 5000 });
    await btn.click();
    await browser.pause(500);
}

/**
 * Toggles a checkbox in the import merge modal.
 */
export async function toggleImportCheckbox(field: string, checked: boolean): Promise<void> {
    const checkbox = await $(`.import-checkbox[data-field="${field}"]`);
    await checkbox.waitForExist({ timeout: 5000 });
    const isChecked = await checkbox.isSelected();
    if (isChecked !== checked) {
        // Many drivers have trouble clicking the hidden checkbox itself, so we click the parent label or just click it
        await checkbox.click();
    }
}

/**
 * Verifies that the diff for a specific field is displayed correctly in the merge modal.
 */
export async function verifyDiffDisplayed(field: string, oldText: string, newText: string): Promise<void> {
    const label = await $(`.import-checkbox[data-field="${field}"]`).parentElement();
    
    // Check for strikethrough text (old value)
    const oldSpan = await label.$('span[style*="text-decoration: line-through"]');
    await oldSpan.waitForExist({ timeout: 5000 });
    
    await browser.waitUntil(async () => {
        return (await oldSpan.getText()) === oldText;
    }, {
        timeout: 5000,
        timeoutMsg: `Expected old text "${oldText}" for field "${field}", but got "${await oldSpan.getText()}"`
    });
    
    // Check for new text
    const labelText = await label.getText();
    expect(labelText).toContain(newText);
}

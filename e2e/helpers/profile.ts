/**
 * Profile view helpers.
 */
/// <reference types="@wdio/globals/types" />
import { Logger } from '../../src/core/logger';
import { dismissAlert, setDialogMockPath } from './common.js';

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

const PROFILE_NAME_SELECTOR = '#profile-name';
const PROFILE_NAME_INPUT_SELECTOR = '#profile-root input[type="text"]';

/**
 * Opens the inline profile name editor by triggering the real double-click interaction.
 */
export async function openProfileNameEditor(): Promise<WebdriverIO.Element> {
    const existingInput = $(PROFILE_NAME_INPUT_SELECTOR);
    if (await existingInput.isExisting() && await existingInput.isDisplayed()) {
        return await existingInput;
    }

    const heading = $(PROFILE_NAME_SELECTOR);
    await heading.waitForDisplayed({ timeout: 5000 });
    await heading.scrollIntoView();

    await browser.waitUntil(async () => {
        const inlineEditor = $(PROFILE_NAME_INPUT_SELECTOR);
        if (await inlineEditor.isExisting() && await inlineEditor.isDisplayed()) return true;

        const currentHeading = $(PROFILE_NAME_SELECTOR);
        if (!await currentHeading.isExisting()) return false;

        await currentHeading.scrollIntoView();

        try {
            await currentHeading.doubleClick();
        } catch {
            // Ignore action-level failures and fall back to a DOM dblclick below.
        }

        const afterNativeDoubleClick = $(PROFILE_NAME_INPUT_SELECTOR);
        if (await afterNativeDoubleClick.isExisting() && await afterNativeDoubleClick.isDisplayed()) return true;

        await browser.execute((selector) => {
            const el = document.querySelector(selector);
            if (!el) return;

            el.dispatchEvent(new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                detail: 2,
                button: 0,
                buttons: 1,
                view: globalThis as unknown as Window
            }));
        }, PROFILE_NAME_SELECTOR);

        const afterDomDoubleClick = $(PROFILE_NAME_INPUT_SELECTOR);
        return await afterDomDoubleClick.isExisting() && await afterDomDoubleClick.isDisplayed();
    }, {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'Failed to open the profile name editor via double-click'
    });

    const input = $(PROFILE_NAME_INPUT_SELECTOR);
    await input.waitForDisplayed({ timeout: 2000 });
    return await input;
}

/**
 * Renames the current profile through the inline profile name editor.
 */
export async function renameProfile(newName: string): Promise<void> {
    const input = await openProfileNameEditor();

    await browser.execute((selector, value) => {
        const inputEl = document.querySelector(selector) as HTMLInputElement | null;
        if (!inputEl) return;

        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.blur();
    }, PROFILE_NAME_INPUT_SELECTOR, newName);

    await input.waitForDisplayed({ reverse: true, timeout: 5000 });

    const heading = $(PROFILE_NAME_SELECTOR);
    await heading.waitForDisplayed({ timeout: 5000 });
    await browser.waitUntil(async () => {
        return (await heading.getText()) === newName;
    }, {
        timeout: 5000,
        timeoutMsg: `Profile name did not update to ${newName}`
    });
}

/**
 * Opens the profile picture picker by double-clicking the hero avatar.
 */
export async function uploadProfilePicture(imagePath: string): Promise<void> {
    await setDialogMockPath(imagePath);

    const avatar = $('#profile-hero-avatar');
    await avatar.waitForDisplayed({ timeout: 5000 });
    await avatar.scrollIntoView();

    let uploadTriggered = false;
    for (let attempt = 0; attempt < 3 && !uploadTriggered; attempt++) {
        if (attempt === 0) {
            try {
                await avatar.doubleClick();
            } catch {
                // Fall back to a DOM event on the next retry if native actions are unreliable here.
            }
        } else {
            await browser.execute(() => {
                const el = document.getElementById('profile-hero-avatar');
                if (!el) return;
                el.dispatchEvent(new MouseEvent('dblclick', {
                    bubbles: true,
                    cancelable: true,
                    detail: 2,
                    button: 0,
                    buttons: 1,
                    view: globalThis as unknown as Window
                }));
            });
        }

        uploadTriggered = await browser.waitUntil(async () => {
            const alertBody = $('#alert-body');
            if (await alertBody.isDisplayed().catch(() => false)) {
                return true;
            }

            const heroImg = $('#profile-hero-avatar img');
            const heroSrc = await heroImg.getAttribute('src').catch(() => '');
            return (heroSrc ?? '').startsWith('data:image/');
        }, {
            timeout: 5000,
            interval: 250,
            timeoutMsg: 'Profile picture did not appear after double-clicking the hero avatar'
        }).catch(() => false);
    }

    const alertBody = $('#alert-body');
    const alertVisible = await alertBody.isDisplayed().catch(() => false);
    if (alertVisible) {
        const message = await alertBody.getText().catch(() => 'Profile picture upload failed.');
        await dismissAlert(undefined, 0);
        throw new Error(message);
    }

    if (!uploadTriggered) {
        throw new Error('Profile picture did not appear after double-clicking the hero avatar');
    }

    const heroImg = $('#profile-hero-avatar img');
    await heroImg.waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(async () => {
        return (await heroImg.getAttribute('src'))?.startsWith('data:image/') ?? false;
    }, {
        timeout: 10000,
        interval: 250,
        timeoutMsg: 'Profile hero avatar did not render a data URL image after upload'
    });
}

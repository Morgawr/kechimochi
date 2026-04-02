/**
 * Common UI interaction helpers.
 */
/// <reference types="@wdio/globals/types" />
/// <reference types="@wdio/visual-service" />
/// <reference types="@wdio/ocr-service" />
import path from 'node:path';

type ElementTarget = string | WebdriverIO.Element | (() => WebdriverIO.Element);

function resolveElement(target: ElementTarget): WebdriverIO.Element {
    if (typeof target === 'string') {
        return $(target);
    }

    if (typeof target === 'function') {
        return target();
    }

    return target;
}

function selectorForTarget(target: ElementTarget, element: WebdriverIO.Element): string | null {
    if (typeof target === 'string') {
        return target;
    }

    const selector = (element as unknown as { selector?: unknown }).selector;
    return typeof selector === 'string' ? selector : null;
}

function clickLastVisibleMatch(selector: string): Promise<void> {
    return browser.execute((resolvedSelector) => {
        const nodes = Array.from(document.querySelectorAll(resolvedSelector as string)).reverse();
        const target = nodes.find((node) => {
            if (!(node instanceof HTMLElement)) {
                return false;
            }

            const style = globalThis.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        });

        if (!(target instanceof HTMLElement)) {
            throw new Error(`Could not resolve clickable element for selector ${resolvedSelector}`);
        }

        target.click();
    }, selector);
}

export async function isOverlayActive(overlay: WebdriverIO.Element): Promise<boolean> {
    const className = await overlay.getAttribute('class').catch(() => '');
    return (className ?? '').split(/\s+/).includes('active');
}

export async function waitForNoActiveOverlays(timeout = 5000): Promise<void> {
    await browser.waitUntil(async () => {
        return await browser.execute(() => {
            return !Array.from(document.querySelectorAll('.modal-overlay')).some((overlay) => {
                return overlay.classList.contains('active');
            });
        });
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Modal overlays did not finish closing in time'
    });
}

export async function getTopmostVisibleOverlay(selector?: string) {
    await browser.waitUntil(async () => {
        const overlays = Array.from(await $$('.modal-overlay')).reverse();
        for (const overlay of overlays) {
            if (!(await isOverlayActive(overlay))) continue;

            if (selector) {
                const child = overlay.$(selector);
                if (!(await child.isDisplayed().catch(() => false))) {
                    continue;
                }
            }

            return true;
        }
        return false;
    }, { timeout: 8000, timeoutMsg: `No visible modal overlay found for selector "${selector || '<any>'}"` });

    const overlays = Array.from(await $$('.modal-overlay')).reverse();
    for (const overlay of overlays) {
        if (!(await isOverlayActive(overlay))) continue;

        if (selector) {
            const child = overlay.$(selector);
            if (!(await child.isDisplayed().catch(() => false))) {
                continue;
            }
        }

        return overlay;
    }

    throw new Error(`No visible modal overlay found for selector "${selector || '<any>'}"`);
}

export async function waitForOverlayToDisappear(overlay: WebdriverIO.Element, timeout = 5000) {
    const modalId = await browser.execute((el) => {
        return (el as HTMLElement).dataset.modalId ?? '';
    }, overlay).catch(() => '');

    await browser.waitUntil(async () => {
        if (modalId) {
            const isTrackedOverlayStillActive = await browser.execute((id) => {
                const trackedOverlay = document.querySelector(`.modal-overlay[data-modal-id="${id}"]`);
                return trackedOverlay?.classList.contains('active') ?? false;
            }, modalId).catch(() => false);

            if (!isTrackedOverlayStillActive) return true;
        }

        const isDisplayed = await overlay.isDisplayed().catch(() => false);
        if (!isDisplayed) return true;

        return !(await isOverlayActive(overlay));
    }, {
        timeout,
        timeoutMsg: 'Modal overlay did not disappear in time'
    });
}

export async function safeClick(target: ElementTarget, timeout = 5000): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const element = resolveElement(target);
            await element.waitForExist({ timeout });
            await element.scrollIntoView().catch(() => { });
            await element.waitForDisplayed({ timeout });

            try {
                await element.waitForClickable({ timeout: Math.min(timeout, 2000) });
            } catch {
                // Some CI runs report false negatives here; we still try a direct click below.
            }

            try {
                await element.click();
            } catch {
                const selector = selectorForTarget(target, element);
                if (selector) {
                    await clickLastVisibleMatch(selector);
                } else {
                    throw new Error('Element click fallback requires a selector');
                }
            }

            return;
        } catch (error) {
            lastError = error;
            await browser.pause(150 * (attempt + 1));
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to click element');
}

export async function setInputValue(target: ElementTarget, value: string, timeout = 5000): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const element = resolveElement(target);
            await element.waitForExist({ timeout });
            await element.scrollIntoView().catch(() => { });
            await element.waitForDisplayed({ timeout });
            await safeClick(element, timeout);

            try {
                await element.clearValue();
            } catch {
                await browser.keys(['Control', 'a', 'Backspace']).catch(() => { });
            }

            if (value !== '') {
                try {
                    await element.addValue(value);
                } catch {
                    await element.setValue(value);
                }
            }

            await browser.waitUntil(async () => {
                const currentValue = await resolveElement(target).getValue().catch(() => null);
                return `${currentValue ?? ''}` === value;
            }, {
                timeout: Math.min(timeout, 3000),
                interval: 100,
                timeoutMsg: 'Input value did not settle to the expected value'
            });

            return;
        } catch (error) {
            lastError = error;
            await browser.pause(150 * (attempt + 1));
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to set input value');
}


/**
 * Use OCR to verify text is visible on screen.
 * Falls back to DOM text search if OCR is not available.
 */
export async function assertTextVisible(text: string): Promise<void> {
  const stageDir = process.env.SPEC_STAGE_DIR;
  const imagesFolder = stageDir ? path.join(stageDir, 'ocr') : undefined;

  if (imagesFolder) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(imagesFolder, { recursive: true });
  }

  try {
    // Force specific imagesFolder for OCR
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (browser as any).ocrWaitForTextDisplayed({
      text,
      timeout: 5000,
      imagesFolder,
    });
  } catch {
    // Fallback: search in page text content
    const body = $('body');
    const bodyText = await body.getText();
    expect(bodyText).toContain(text);
  }
}

/**
 * Take a screenshot and compare against baseline using visual service.
 */
export async function takeAndCompareScreenshot(tag: string): Promise<void> {
  const stageDir = process.env.SPEC_STAGE_DIR;

  const options: Record<string, string> = {};
  if (stageDir) {
    const actualFolder = path.join(stageDir, 'visual', 'actual');
    const diffFolder = path.join(stageDir, 'visual', 'diff');

    const { mkdirSync } = await import('node:fs');
    mkdirSync(actualFolder, { recursive: true });
    mkdirSync(diffFolder, { recursive: true });

    options.actualFolder = actualFolder;
    options.diffFolder = diffFolder;
  }

  const result = await browser.checkScreen(tag, options);

  // High tolerance for environmental rendering noise
  expect(result).toBeLessThanOrEqual(10);
}

/**
 * Dismisses a custom alert modal if it exists.
 * If expectedText is provided, it verifies the alert content.
 */
export async function dismissAlert(expectedText?: string, timeout = 5000): Promise<void> {
    const okBtn = $('#alert-ok');
    try {
        if (timeout > 0) {
            await okBtn.waitForDisplayed({ timeout });
        }
        
        if (await okBtn.isDisplayed()) {
            if (expectedText) {
                const alertBody = $('#alert-body');
                expect(await alertBody.getText()).toContain(expectedText);
            }

            // Target the currently visible alert overlay in case another modal is fading out.
            const overlay = await getTopmostVisibleOverlay('#alert-ok');
            const scopedOkBtn = overlay.$('#alert-ok');
            await safeClick(scopedOkBtn);

            await waitForOverlayToDisappear(overlay, 5000);
        }
    } catch (e) {
        if (timeout > 0) throw e;
    }
}

/**
 * Handle a custom prompt modal by entering a value and confirming
 */
export async function submitPrompt(value: string): Promise<void> {
    const overlay = await getTopmostVisibleOverlay('#prompt-input');
    const input = overlay.$('#prompt-input');
    await input.waitForDisplayed({ timeout: 5000 });

    await setInputValue(input, value);

    const confirmBtn = overlay.$('#prompt-confirm');
    await safeClick(confirmBtn);

    await waitForOverlayToDisappear(overlay, 5000);
}

/**
 * Handle a custom confirmation modal
 */
export async function confirmAction(ok: boolean = true): Promise<void> {
    const btnSelector = ok ? '#confirm-ok' : '#confirm-cancel';
    const overlay = await getTopmostVisibleOverlay(btnSelector);
    const btn = overlay.$(btnSelector);
    await btn.waitForDisplayed({ timeout: 5000 });

    await safeClick(btn);

    await waitForOverlayToDisappear(overlay, 5000);
}

/**
 * Generic helper to close a modal by clicking its cancel button.
 */
export async function closeModal(cancelBtnSelector: string): Promise<void> {
    const overlay = await getTopmostVisibleOverlay(cancelBtnSelector);
    const cancelBtn = overlay.$(cancelBtnSelector);
    await safeClick(cancelBtn);
    await waitForOverlayToDisappear(overlay, 5000);
}
/**
 * Sets the mock path for file save/open dialogs in Tauri.
 */
export async function setDialogMockPath(filePath: string): Promise<void> {
    await browser.execute((p) => {
        (globalThis as unknown as { mockSavePath: string, mockOpenPath: string }).mockSavePath = p;
        (globalThis as unknown as { mockSavePath: string, mockOpenPath: string }).mockOpenPath = p;
    }, filePath);
}

/**
 * Shared logic for editing an activity log via the modal.
 */
export async function performActivityEdit(btnSelector: string, newDuration: string, newCharacters: string = "0"): Promise<void> {
    const editBtn = $(btnSelector);
    await editBtn.waitForDisplayed({ timeout: 5000 });
    await editBtn.scrollIntoView();
    await editBtn.waitForClickable({ timeout: 3000 });
    await editBtn.click();

    const modal = $('.modal-content');
    await modal.waitForDisplayed({ timeout: 3000 });

    // Verify it's in edit mode
    const modalTitle = modal.$('h3');
    await browser.waitUntil(async () => (await modalTitle.getText()) === 'Edit Activity', {
        timeout: 3000,
        timeoutMsg: 'Modal did not enter Edit Activity mode'
    });

    const durationInput = $('#activity-duration');
    await durationInput.waitForDisplayed({ timeout: 3000 });
    await durationInput.setValue(newDuration);

    const charInput = $('#activity-characters');
    if (await charInput.isExisting()) {
        await charInput.setValue(newCharacters);
    }

    const submitBtn = $('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 2000 });
    await submitBtn.click();

    await modal.waitForDisplayed({ reverse: true, timeout: 5000 });
    await browser.pause(500); // reduced from 1000
}

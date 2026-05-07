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
            throw new TypeError(`Could not resolve clickable element for selector ${resolvedSelector}`);
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
            const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
            return !overlays.some((overlay) => {
                if (!(overlay instanceof HTMLElement)) {
                    return false;
                }

                if (!overlay.classList.contains('active')) {
                    return false;
                }

                const style = globalThis.getComputedStyle(overlay);
                const rect = overlay.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            });
        });
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Modal overlays did not finish closing in time'
    });
}

export async function getTopmostVisibleOverlay(selector?: string, timeout = 8000) {
    await browser.waitUntil(async () => {
        return (await findTopmostVisibleOverlay(selector)) !== null;
    }, { timeout, timeoutMsg: `No visible modal overlay found for selector "${selector || '<any>'}"` });

    const overlay = await findTopmostVisibleOverlay(selector);
    if (overlay) {
        return overlay;
    }

    throw new Error(`No visible modal overlay found for selector "${selector || '<any>'}"`);
}

export async function findTopmostVisibleOverlay(selector?: string): Promise<WebdriverIO.Element | null> {
    const modalId = await browser.execute((targetSelector) => {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
        const isVisible = (node: Element | null): boolean => {
            if (!(node instanceof HTMLElement)) {
                return false;
            }

            const style = globalThis.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return node.classList.contains('active')
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };

        for (const overlay of overlays) {
            if (!isVisible(overlay)) {
                continue;
            }

            if (typeof targetSelector === 'string' && targetSelector.length > 0) {
                const child = overlay.querySelector(targetSelector);
                if (!(child instanceof HTMLElement)) {
                    continue;
                }
            }

            return (overlay as HTMLElement).dataset.modalId ?? null;
        }

        return null;
    }, selector ?? '');

    if (!modalId) {
        return null;
    }

    const overlay = $(`.modal-overlay[data-modal-id="${modalId}"]`);
    return await overlay.isExisting().catch(() => false) ? overlay : null;
}

export async function waitForTopmostOverlayText(selector: string, expectedText: string, timeout = 8000): Promise<void> {
    await browser.waitUntil(async () => {
        return await browser.execute((targetSelector, text) => {
            const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
            for (const overlay of overlays) {
                if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                    continue;
                }

                const style = globalThis.getComputedStyle(overlay);
                const rect = overlay.getBoundingClientRect();
                if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
                    continue;
                }

                if (!overlay.querySelector(targetSelector as string)) {
                    continue;
                }

                return overlay.textContent?.includes(text as string) ?? false;
            }

            return false;
        }, selector, expectedText);
    }, {
        timeout,
        interval: 100,
        timeoutMsg: `No visible modal overlay containing "${expectedText}" found for selector "${selector}"`,
    });
}

export async function clickTopmostOverlayChild(selector: string, timeout = 8000): Promise<void> {
    await browser.waitUntil(async () => {
        return await browser.execute((targetSelector) => {
            const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
            for (const overlay of overlays) {
                if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                    continue;
                }

                const style = globalThis.getComputedStyle(overlay);
                const rect = overlay.getBoundingClientRect();
                if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
                    continue;
                }

                return overlay.querySelector(targetSelector as string) instanceof HTMLElement;
            }

            return false;
        }, selector);
    }, {
        timeout,
        interval: 100,
        timeoutMsg: `No visible modal overlay found for selector "${selector}"`,
    });

    await browser.execute((targetSelector) => {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
        for (const overlay of overlays) {
            if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                continue;
            }

            const overlayStyle = globalThis.getComputedStyle(overlay);
            const overlayRect = overlay.getBoundingClientRect();
            if (overlayStyle.display === 'none'
                || overlayStyle.visibility === 'hidden'
                || overlayRect.width <= 0
                || overlayRect.height <= 0) {
                continue;
            }

            const target = overlay.querySelector(targetSelector as string);
            if (target instanceof HTMLElement) {
                target.scrollIntoView({ block: 'center', inline: 'center' });
                target.click();
                return;
            }
        }

        throw new Error(`No active overlay child found for selector "${targetSelector}"`);
    }, selector);
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
                    await browser.execute((el) => {
                        if (!(el instanceof HTMLElement)) {
                            throw new TypeError('Resolved click target is not an HTMLElement');
                        }

                        el.click();
                    }, element);
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

  let result = Number.POSITIVE_INFINITY;
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await waitForVisualComparisonReady().catch(() => undefined);
    result = await browser.checkScreen(tag, options);
    if (result <= 10) break;
    if (attempt < attempts - 1) {
      await browser.pause(500 * (attempt + 1));
    }
  }

  // High tolerance for environmental rendering noise
  expect(result).toBeLessThanOrEqual(10);
}

async function waitForVisualComparisonReady(timeout = 5000): Promise<void> {
  await browser.waitUntil(async () => {
    return browser.execute(() => {
      const app = document.getElementById('app');
      const hasStableShell = Boolean(
        document.querySelector('.nav-link.active')
        || document.querySelector('.dashboard-root')
        || document.querySelector('#media-view')
        || document.querySelector('#profile-view')
        || document.querySelector('#timeline-view')
      );
      const loadingOnly = document.body.textContent?.trim() === 'Loading...';

      return app?.dataset.bootState === 'ready' && hasStableShell && !loadingOnly;
    }).catch(() => false);
  }, {
    timeout,
    interval: 100,
    timeoutMsg: 'Expected app shell to be ready before visual comparison'
  });

  await browser.pause(150);
}

/**
 * Dismisses a custom alert modal if it exists.
 * If expectedText is provided, it verifies the alert content.
 */
export async function dismissAlert(expectedText?: string, timeout = 5000): Promise<void> {
    try {
        let overlay: WebdriverIO.Element | null = null;
        if (expectedText) {
            await waitForTopmostOverlayText('#alert-ok', expectedText, timeout);
            overlay = await getTopmostVisibleOverlay('#alert-ok', timeout > 0 ? timeout : 1000);
        } else if (timeout > 0) {
            overlay = await getTopmostVisibleOverlay('#alert-ok', timeout);
        } else {
            overlay = await findTopmostVisibleOverlay('#alert-ok');
            if (!overlay) {
                return;
            }
        }

        await clickTopmostOverlayChild('#alert-ok', timeout > 0 ? timeout : 1000);
        await waitForOverlayToDisappear(overlay, 5000);
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
    await clickTopmostOverlayChild(btnSelector);
    await waitForOverlayToDisappear(overlay, 5000);
}

/**
 * Generic helper to close a modal by clicking its cancel button.
 */
export async function closeModal(cancelBtnSelector: string): Promise<void> {
    const overlay = await getTopmostVisibleOverlay(cancelBtnSelector);
    await clickTopmostOverlayChild(cancelBtnSelector);
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

    const overlay = await getTopmostVisibleOverlay('#add-activity-form', 5000);
    const modal = overlay.$('.modal-content');
    await modal.waitForDisplayed({ timeout: 3000 });

    // Verify it's in edit mode
    const modalTitle = modal.$('h3');
    await browser.waitUntil(async () => (await modalTitle.getText()) === 'Edit Activity', {
        timeout: 3000,
        timeoutMsg: 'Modal did not enter Edit Activity mode'
    });

    await setInputValue(() => overlay.$('#activity-duration'), newDuration, 3000);

    const charInput = overlay.$('#activity-characters');
    if (await charInput.isExisting()) {
        await setInputValue(() => overlay.$('#activity-characters'), newCharacters, 3000);
    }

    const submitBtn = overlay.$('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 2000 });
    await safeClick(submitBtn);

    await waitForOverlayToDisappear(overlay, 5000);
    await waitForNoActiveOverlays(5000);
}

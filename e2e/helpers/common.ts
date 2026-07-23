/**
 * Common UI interaction helpers.
 */
import path from 'node:path';
import { isDesktop } from '../config/platform.js';
import { setText } from './form-controls.js';
import type { ChainablePromiseElement } from 'webdriverio';

type ElementTarget = string | ChainablePromiseElement | (() => ChainablePromiseElement);
let promptSubmissionCounter = 0;

function resolveElement(target: ElementTarget): ChainablePromiseElement {
    if (typeof target === 'string') {
        return $(target);
    }

    if (typeof target === 'function') {
        return target();
    }

    return target;
}

function selectorForTarget(target: ElementTarget, element: ChainablePromiseElement): string | null {
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

/**
 * Waits until the element matching `selector` is displayed, re-querying the
 * selector on every poll.
 *
 * Prefer this over `$(selector).waitForDisplayed()` for elements that appear
 * after an async data load. On web the view roots accumulate in the DOM and a
 * render can replace the target node, so a reference captured up-front goes
 * stale and never reports displayed. Re-fetching each tick is robust on every
 * platform (desktop renders fast enough that the stale-reference race never
 * surfaced there).
 */
export async function waitForSelectorDisplayed(selector: string, timeout = 8000): Promise<void> {
    await browser.waitUntil(async () => {
        const element = $(selector);
        return await element.isDisplayed().catch(() => false);
    }, {
        timeout,
        interval: 100,
        timeoutMsg: `element ("${selector}") still not displayed after ${timeout}ms`,
    });
}

export async function isOverlayActive(overlay: ChainablePromiseElement): Promise<boolean> {
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

export async function findTopmostVisibleOverlay(selector?: string): Promise<ChainablePromiseElement | null> {
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

export async function waitForOverlayToDisappear(overlay: ChainablePromiseElement, timeout = 5000) {
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

/**
 * Takes a screenshot and produces a non-blocking desktop visual diff.
 *
 * Desktop-only: on web/android this is a no-op until per-platform baselines are
 * curated (avoids false diffs from font/rendering differences). Screenshot
 * differences and comparison errors are diagnostic only; functional assertions
 * decide whether an E2E test passes.
 */
export async function takeAndCompareScreenshot(tag: string): Promise<void> {
  if (!isDesktop()) return;

  await waitForVisualComparisonReady().catch(() => undefined);

  const stageDir = process.env.SPEC_STAGE_DIR;
  const options: Record<string, string> = {};
  if (stageDir) {
    const { mkdirSync } = await import('node:fs');
    const actualFolder = path.join(stageDir, 'visual', 'actual');
    const diffFolder = path.join(stageDir, 'visual', 'diff');
    mkdirSync(actualFolder, { recursive: true });
    mkdirSync(diffFolder, { recursive: true });
    options.actualFolder = actualFolder;
    options.diffFolder = diffFolder;
  }

  try {
    await browser.checkScreen(tag, options);
  } catch {
    // Visual comparison is best-effort and must never block a user CUJ.
  }
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
}

/**
 * Dismisses a custom alert modal if it exists.
 * If expectedText is provided, it verifies the alert content.
 */
export async function dismissAlert(expectedText?: string, timeout = 5000): Promise<void> {
    try {
        let overlay: ChainablePromiseElement | null;
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
export async function submitPrompt(value: string, timeout = 15000): Promise<void> {
    const overlay = await getTopmostVisibleOverlay('#prompt-input');
    const input = overlay.$('#prompt-input');
    await input.waitForDisplayed({ timeout: 5000 });

    await setText('#prompt-input', value);

    // Modal IDs restart at 1 after a reload. Tag this specific overlay so a
    // newly loaded first-run modal cannot be mistaken for the prompt we just
    // submitted (notably during factory reset).
    promptSubmissionCounter += 1;
    const promptToken = `e2e-prompt-${promptSubmissionCounter}`;
    const submitted = await browser.execute((token) => {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
        const activeOverlay = overlays.find(
            (candidate) => candidate instanceof HTMLElement && candidate.classList.contains('active'),
        );

        if (!(activeOverlay instanceof HTMLElement)) {
            return false;
        }

        const form = activeOverlay.querySelector('#prompt-form');
        if (!(form instanceof HTMLFormElement)) {
            return false;
        }

        activeOverlay.dataset.e2ePromptToken = token;
        form.requestSubmit();
        return true;
    }, promptToken);

    if (!submitted) {
        throw new Error('Active prompt form disappeared before it could be submitted');
    }

    await browser.waitUntil(async () => {
        return browser.execute((token) => {
            const tracked = Array.from(document.querySelectorAll('.modal-overlay')).find(
                (candidate) => candidate instanceof HTMLElement && candidate.dataset.e2ePromptToken === token,
            );
            return !(tracked instanceof HTMLElement) || !tracked.classList.contains('active');
        }, promptToken).catch(() => true);
    }, { timeout, timeoutMsg: 'Prompt overlay did not disappear in time' });
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
 * Picks a date in the activity-log modal on any platform. Desktop shows an in-page
 * calendar (.cal-day); mobile (<750px) hides it and shows a native
 * <input type="date" id="mobile-date-input"> pre-filled with today. Pass a
 * YYYY-MM-DD date to choose one, or omit to keep the pre-filled "today".
 */
export async function selectActivityDate(date?: string): Promise<void> {
    const mobileDateFieldVisible = await $('#mobile-date-field').isDisplayed().catch(() => false);
    if (mobileDateFieldVisible) {
        if (date) {
            await setText('#mobile-date-input', date);
        }
        return;
    }
    await safeClick(date ? `.cal-day[data-date="${date}"]` : '.cal-day.today');
}

/**
 * Sets the mock path for file save/open dialogs.
 *
 * Desktop-only: injects mockSavePath / mockOpenPath into the Tauri WebView so an
 * intercepted dialog returns the given path. No-op on web/android (no dialogs).
 */
export async function setDialogMockPath(filePath: string): Promise<void> {
    if (!isDesktop()) return;

    await browser.execute((normalizedPath) => {
        (globalThis as unknown as { mockSavePath: string; mockOpenPath: string }).mockSavePath = normalizedPath;
        (globalThis as unknown as { mockSavePath: string; mockOpenPath: string }).mockOpenPath = normalizedPath;
    }, filePath);
}

/**
 * Switches Appium into the app's WEBVIEW context on Android.
 *
 * The Tauri UI is an Android WebView, but Appium starts in NATIVE_APP where
 * DOM/CSS selectors are invalid, so this must run before any DOM access.
 * Idempotent. Android-only — callers guard with isAndroid().
 */
export async function ensureAndroidWebContext(timeoutMs = 30000): Promise<void> {
    const mobile = browser as unknown as {
        getContext: () => Promise<string | null>;
        getContexts: () => Promise<string[]>;
        switchContext: (name: string) => Promise<void>;
    };

    const current = await mobile.getContext().catch(() => null);
    if (current && current.startsWith('WEBVIEW')) return;

    const startTimestamp = Date.now();
    let webContext: string | undefined;
    while (Date.now() - startTimestamp < timeoutMs) {
        const contexts = await mobile.getContexts().catch(() => [] as string[]);
        webContext = contexts.find((context) => context.startsWith('WEBVIEW'));
        if (webContext) break;
        await browser.pause(1000);
    }

    if (!webContext) {
        throw new Error(
            'No WEBVIEW context became available on Android. Is the WebView debuggable '
            + '(debug build) and chromedriver available to Appium?',
        );
    }

    await mobile.switchContext(webContext);
}

/**
 * Shared logic for editing an activity log via the modal.
 */
export async function performActivityEdit(
    btnSelector: string,
    newDuration: string,
    newCharacters: string = "0",
    newNotes?: string,
    newActivityType?: string,
): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute((selector) => {
            const button = Array.from(document.querySelectorAll(selector)).find((node) => {
                if (!(node instanceof HTMLElement)) return false;

                const style = globalThis.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            });

            if (!(button instanceof HTMLElement)) return false;

            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return true;
        }, btnSelector).catch(() => false);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Could not click a visible edit activity button matching "${btnSelector}"`,
    });

    const overlay = await getTopmostVisibleOverlay('#add-activity-form', 5000);
    const modal = overlay.$('.modal-content');
    await modal.waitForDisplayed({ timeout: 3000 });

    // Verify it's in edit mode
    const modalTitle = modal.$('h3');
    await browser.waitUntil(async () => (await modalTitle.getText()) === 'Edit Activity', {
        timeout: 3000,
        timeoutMsg: 'Modal did not enter Edit Activity mode'
    });

    await setText('#activity-duration', newDuration, 3000);

    const charInput = overlay.$('#activity-characters');
    if (await charInput.isExisting()) {
        await setText('#activity-characters', newCharacters, 3000);
    }

    if (newNotes !== undefined && await overlay.$('#activity-notes').isExisting()) {
        await setText('#activity-notes', newNotes, 3000);
    }

    if (newActivityType !== undefined && await overlay.$('#activity-type').isExisting()) {
        const { setSelect } = await import('./form-controls.js');
        await setSelect('#activity-type', { text: newActivityType }, 3000);
    }

    const submitBtn = overlay.$('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 2000 });
    await safeClick(submitBtn);

    await waitForOverlayToDisappear(overlay, 5000);
    await waitForNoActiveOverlays(5000);
}

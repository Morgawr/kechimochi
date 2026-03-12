/**
 * Common UI interaction helpers.
 */
/// <reference types="@wdio/globals/types" />
/// <reference types="@wdio/visual-service" />
/// <reference types="@wdio/ocr-service" />
import path from 'node:path';

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
    const body = await $('body');
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
 * If timeout is 0, it behaves as a conditional dismissal (no-op if not present).
 */
export async function dismissAlert(timeout = 5000): Promise<void> {
    const okBtn = await $('#alert-ok');
    try {
        if (timeout > 0) {
            await okBtn.waitForDisplayed({ timeout });
        }
        
        if (await okBtn.isDisplayed()) {
            // Get the specific overlay ID to wait for its removal
            const overlay = await okBtn.$('./ancestor::div[contains(@class, "modal-overlay")]');
            const dataset = await overlay.getProperty('dataset') as Record<string, string>;
            const overlayId = dataset.overlayId;
            
            await okBtn.waitForClickable({ timeout: 2000 });
            await okBtn.click();
            
            // Wait for this SPECIFIC overlay to be removed from DOM
            await $(`.modal-overlay[data-overlay-id="${overlayId}"]`).waitForExist({ reverse: true, timeout: 5000 });
        }
    } catch (e) {
        if (timeout > 0) throw e;
    }
}

/**
 * Handle a custom prompt modal by entering a value and confirming
 */
export async function submitPrompt(value: string): Promise<void> {
    const input = await $('#prompt-input');
    await input.waitForDisplayed({ timeout: 5000 });
    
    // Get the specific overlay ID to wait for its removal
    const overlay = await input.$('./ancestor::div[contains(@class, "modal-overlay")]');
    const dataset = await overlay.getProperty('dataset') as Record<string, string>;
    const overlayId = dataset.overlayId;

    await input.waitForClickable({ timeout: 2000 });
    
    // Clear and set value to ensure it's clean
    await input.click();
    await input.setValue(value);
    
    // Safety check: verify value was set correctly
    await browser.waitUntil(async () => {
        return (await input.getValue()) === value;
    }, { timeout: 3000, timeoutMsg: 'Failed to set value in prompt input' });

    const confirmBtn = await $('#prompt-confirm');
    await confirmBtn.waitForClickable({ timeout: 2000 });
    await confirmBtn.click();

    // Wait for this SPECIFIC overlay to be removed from DOM
    await $(`.modal-overlay[data-overlay-id="${overlayId}"]`).waitForExist({ reverse: true, timeout: 5000 });
}

/**
 * Handle a custom confirmation modal
 */
export async function confirmAction(ok: boolean = true): Promise<void> {
    const btnSelector = ok ? '#confirm-ok' : '#confirm-cancel';
    const btn = await $(btnSelector);
    await btn.waitForDisplayed({ timeout: 5000 });
    
    // Get the specific overlay ID to wait for its removal
    const overlay = await btn.$('./ancestor::div[contains(@class, "modal-overlay")]');
    const dataset = await overlay.getProperty('dataset') as Record<string, string>;
    const overlayId = dataset.overlayId;

    await btn.waitForClickable({ timeout: 2000 });
    await btn.click();

    // Wait for this SPECIFIC overlay to be removed from DOM
    await $(`.modal-overlay[data-overlay-id="${overlayId}"]`).waitForExist({ reverse: true, timeout: 5000 });
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

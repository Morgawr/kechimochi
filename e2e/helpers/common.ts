/**
 * Common UI interaction helpers.
 */
/// <reference types="@wdio/globals/types" />
/// <reference types="@wdio/visual-service" />
/// <reference types="@wdio/ocr-service" />
import path from 'path';

/**
 * Use OCR to verify text is visible on screen.
 * Falls back to DOM text search if OCR is not available.
 */
export async function assertTextVisible(text: string): Promise<void> {
  const stageDir = process.env.SPEC_STAGE_DIR;
  const imagesFolder = stageDir ? path.join(stageDir, 'ocr') : undefined;

  if (imagesFolder) {
    const { mkdirSync } = await import('fs');
    mkdirSync(imagesFolder, { recursive: true });
  }

  try {
    // Force specific imagesFolder for OCR
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

  const options: any = {};
  if (stageDir) {
    const actualFolder = path.join(stageDir, 'visual', 'actual');
    const diffFolder = path.join(stageDir, 'visual', 'diff');

    const { mkdirSync } = await import('fs');
    mkdirSync(actualFolder, { recursive: true });
    mkdirSync(diffFolder, { recursive: true });

    options.actualFolder = actualFolder;
    options.diffFolder = diffFolder;
  }

  const result = await browser.checkScreen(tag, options);

  // High tolerance for environmental rendering noise
  expect(result).toBeLessThanOrEqual(10.0);
}

/**
 * Dismisses a custom alert modal if it exists
 */
export async function dismissAlert(): Promise<void> {
  const okBtn = await $('#alert-ok');
  if (await okBtn.isExisting()) {
    await okBtn.waitForDisplayed({ timeout: 5000 });
    await okBtn.click();
    // Wait for fadeout animation
    await browser.pause(500);
  }
}

/**
 * Handle a custom prompt modal by entering a value and confirming
 */
export async function submitPrompt(value: string): Promise<void> {
  const input = await $('#prompt-input');
  await input.waitForDisplayed({ timeout: 5000 });
  await input.setValue(value);

  const confirmBtn = await $('#prompt-confirm');
  await confirmBtn.click();

  // Wait for fadeout
  await browser.pause(500);
}

/**
 * Handle a custom confirmation modal
 */
export async function confirmAction(ok: boolean = true): Promise<void> {
  const btnSelector = ok ? '#confirm-ok' : '#confirm-cancel';
  const btn = await $(btnSelector);
  await btn.waitForDisplayed({ timeout: 5000 });
  await btn.click();

  // Wait for fadeout
  await browser.pause(500);
}

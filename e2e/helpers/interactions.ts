/**
 * Reusable UI interaction helpers for CUJ specs.
 */
/// <reference types="@wdio/globals/types" />
/// <reference types="@wdio/visual-service" />
/// <reference types="@wdio/ocr-service" />
import path from 'path';

type ViewName = 'dashboard' | 'media' | 'profile';

/**
 * Navigate to a specific view by clicking the nav link.
 */
export async function navigateTo(view: ViewName): Promise<void> {
  const link = await $(`[data-view="${view}"]`);
  await link.click();
  
  // Wait for the view to actually render
  await browser.pause(500);
}

/**
 * Verify that the current view is the expected one by checking the active nav link.
 */
export async function verifyActiveView(view: ViewName): Promise<boolean> {
  const link = await $(`[data-view="${view}"]`);
  const classes = await link.getAttribute('class');
  return classes?.includes('active') ?? false;
}

/**
 * Verify the current view is not in a broken state.
 * Checks that the view container has rendered content and nav links are interactive.
 */
export async function verifyViewNotBroken(): Promise<void> {
  // Check view container has content
  const container = await $('#view-container');
  const html = await container.getHTML();
  expect(html.length).toBeGreaterThan(10);

  // Check all nav links are still displayed and clickable
  const navLinks = await $$('.nav-link');
  for (const link of navLinks) {
    expect(await link.isDisplayed()).toBe(true);
    expect(await link.isClickable()).toBe(true);
  }
}

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

/**
 * High-level helper to log an activity from the dashboard
 */
export async function logActivity(title: string, duration: string, date?: string): Promise<void> {
    if (!(await verifyActiveView('dashboard'))) {
        await navigateTo('dashboard');
    }

    const addActivityBtn = await $('#btn-add-activity');
    await addActivityBtn.click();

    const mediaInput = await $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 5000 });
    await mediaInput.setValue(title);

    const durationInput = await $('#activity-duration');
    await durationInput.setValue(duration);

    if (date) {
        const dateEl = await $(`.cal-day[data-date="${date}"]`);
        if (await dateEl.isExisting()) {
            await dateEl.click();
        }
    }

    const submitBtn = await $('#add-activity-form button[type="submit"]');
    await submitBtn.click();
}

/**
 * High-level helper to add a new media item from the Library view
 */
export async function addMedia(title: string, type: string): Promise<void> {
    if (!(await verifyActiveView('media'))) {
        await navigateTo('media');
    }

    const addBtn = await $('#btn-add-media-grid');
    await addBtn.click();

    const titleInput = await $('#add-media-title');
    await titleInput.waitForDisplayed({ timeout: 5000 });
    await titleInput.setValue(title);

    const typeSelect = await $('#add-media-type');
    await typeSelect.selectByVisibleText(type);

    const confirmBtn = await $('#add-media-confirm');
    await confirmBtn.click();
    
    // Most additions auto-navigate to detail, so we wait for either detail or grid stabilization
    await browser.pause(1000);
}

/**
 * Set the search query in the library grid.
 */
export async function setSearchQuery(query: string): Promise<void> {
    const input = await $('#grid-search-filter');
    await input.waitForDisplayed({ timeout: 5000 });
    
    // Clicking and using keys is often more reliable for triggering 'input' events in all drivers
    await input.click();
    // Select all and delete (works on Linux/Windows, for Mac it might need Command)
    await browser.keys(['Control', 'a', 'Backspace']);
    
    if (query !== '') {
        await input.addValue(query);
    }
    
    // Grid filtering is real-time, but give it a moment to finish rendering
    await browser.pause(500);
}

/**
 * Set the media type filter in the library grid.
 */
export async function setMediaTypeFilter(type: string): Promise<void> {
    const select = await $('#grid-type-select');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', type);
    await browser.pause(300);
}

/**
 * Set the tracking status filter in the library grid.
 */
export async function setTrackingStatusFilter(status: string): Promise<void> {
    const select = await $('#grid-status-select');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', status);
    await browser.pause(300);
}

/**
 * Toggle the "Hide Archived" checkbox in the library grid.
 */
export async function setHideArchived(hide: boolean): Promise<void> {
    const checkbox = await $('#grid-hide-archived');
    await checkbox.waitForExist({ timeout: 5000 });
    const isChecked = await checkbox.isSelected();
    if (isChecked !== hide) {
        // The input itself is hidden (opacity 0), so we click the slider (.slider)
        const slider = await checkbox.nextElement();
        await slider.click();
        await browser.pause(300);
    }
}

/**
 * Check if a media item with a specific title is currently visible in the grid.
 */
export async function isMediaVisible(title: string): Promise<boolean> {
    const item = await $(`.media-grid-item[data-title="${title}"]`);
    if (!(await item.isExisting())) return false;
    return await item.isDisplayed();
}

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
    
    // Wait for the success alert to appear after import
    await $('#alert-ok').waitForDisplayed({ timeout: 10000 });
    await dismissAlert();
}

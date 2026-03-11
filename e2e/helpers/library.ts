/**
 * Library (Media Grid) helpers.
 */
/// <reference types="@wdio/globals/types" />
import { navigateTo, verifyActiveView } from './navigation.js';

/**
 * High-level helper to add a new media item from the Library view
 */
export async function addMedia(title: string, type: string, contentType?: string): Promise<void> {
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

    if (contentType) {
        const contentSelect = await $('#add-media-content-type');
        await contentSelect.waitForDisplayed({ timeout: 5000 });
        await contentSelect.selectByVisibleText(contentType);
    }

    const confirmBtn = await $('#add-media-confirm');
    await confirmBtn.click();
    
    // Most additions auto-navigate to detail, so we wait for either detail or grid stabilization
    await browser.pause(1500);
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
    const grid = await $('#media-grid-container');
    await grid.waitForDisplayed({ timeout: 10000 }).catch(() => {});
    
    const item = await $(`.media-grid-item[data-title="${title}"]`);
    try {
        await item.waitForExist({ timeout: 5000 });
        return await item.isDisplayed();
    } catch {
        return false;
    }
}

/**
 * Clicks a media item in the grid by its title.
 */
export async function clickMediaItem(title: string): Promise<void> {
    const item = await $(`.media-grid-item[data-title="${title}"]`);
    try {
        await item.waitForDisplayed({ timeout: 5000 });
    } catch (e) {
        const allItems = await $$('.media-grid-item');
        const titles = [];
        for (const it of allItems) {
            titles.push(await it.getAttribute('data-title'));
        }
        console.log(`[E2E] Failed to find: "${title}". Visible in grid: [${titles.join(', ')}]`);
        throw e;
    }
    await item.click();
    await browser.pause(500);
}

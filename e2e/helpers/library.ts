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

    const addBtn = $('#btn-add-media-grid');
    await addBtn.click();

    const titleInput = $('#add-media-title');
    await titleInput.waitForDisplayed({ timeout: 5000 });
    await titleInput.setValue(title);

    const typeSelect = $('#add-media-type');
    await typeSelect.selectByVisibleText(type);

    if (contentType) {
        const contentSelect = $('#add-media-content-type');
        await contentSelect.waitForDisplayed({ timeout: 5000 });
        await contentSelect.selectByVisibleText(contentType);
    }

    const confirmBtn = $('#add-media-confirm');
    await confirmBtn.click();

    // Most additions auto-navigate to detail, so we wait for either detail or grid stabilization
    await browser.pause(1500);
}

/**
 * Set the search query in the library grid.
 */
export async function setSearchQuery(query: string): Promise<void> {
    const input = $('#grid-search-filter');
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
    const select = $('#grid-type-select');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', type);
    await browser.pause(300);
}

/**
 * Set the tracking status filter in the library grid.
 */
export async function setTrackingStatusFilter(status: string): Promise<void> {
    const select = $('#grid-status-select');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', status);
    await browser.pause(300);
}

/**
 * Toggle the "Hide Archived" checkbox in the library grid.
 */
export async function setHideArchived(hide: boolean): Promise<void> {
    const checkbox = $('#grid-hide-archived');
    await checkbox.waitForExist({ timeout: 5000 });
    const isChecked = await checkbox.isSelected();
    if (isChecked !== hide) {
        // The input itself is hidden (opacity 0), so we click the slider (.slider)
        const slider = checkbox.nextElement();
        await slider.click();
        await browser.pause(300);
    }
}

/**
 * Internal helper to find a media item and log grid state on failure.
 */
async function findMediaItemInternal(title: string, timeout = 5000) {
    const itemProxy = $(`.media-grid-item[data-title="${title}"]`);
    try {
        await itemProxy.waitForExist({ timeout });
        // Resolved element is what we return
        return itemProxy;
    } catch {
        const allItems = await $$('.media-grid-item');
        const titles = [];
        for (const it of allItems) {
            const dataset = await it.getProperty('dataset') as Record<string, string>;
            titles.push(dataset.title);
        }
        // eslint-disable-next-line no-console
        console.log(`[E2E] Media item "${title}" not found. Current grid items: [${titles.join(', ')}]`);
        return null;
    }
}

/**
 * Check if a media item with a specific title is currently visible in the grid.
 */
export async function isMediaVisible(title: string): Promise<boolean> {
    const grid = $('#media-grid-container');
    await grid.waitForDisplayed({ timeout: 10000 }).catch(() => { });

    const item = await findMediaItemInternal(title);
    return item ? await item.isDisplayed() : false;
}


/**
 * Check if a media item with a specific title is currently not visible in the grid.
 */
export async function isMediaNotVisible(title: string): Promise<boolean> {
    const grid = $('#media-grid-container');
    await grid.waitForDisplayed({ timeout: 10000 }).catch(() => { });

    const itemProxy = $(`.media-grid-item[data-title="${title}"]`);
    try {
        await itemProxy.waitForExist({ timeout: 1000 });
        return false;
    } catch {
        return true;
    }
}

/**
 * Clicks a media item in the grid by its title.
 */
export async function clickMediaItem(title: string): Promise<void> {
    const item = await findMediaItemInternal(title);
    if (!item) {
        throw new Error(`[E2E] Failed to click "${title}": not found in grid.`);
    }
    await item.waitForDisplayed({ timeout: 5000 });
    await item.click();
    await browser.pause(500);
}

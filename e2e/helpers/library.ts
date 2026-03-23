/**
 * Library (Media Grid) helpers.
 */
/// <reference types="@wdio/globals/types" />
import { Logger } from '../../src/core/logger';
import { navigateTo, verifyActiveView } from './navigation.js';

/**
 * High-level helper to add a new media item from the Library view
 */
export async function addMedia(title: string, type: string, contentType?: string): Promise<void> {
    if (!(await verifyActiveView('media'))) {
        await navigateTo('media');
    }

    const addBtn = $('#btn-add-media-grid');
    await addBtn.waitForClickable({ timeout: 5000 });
    await addBtn.click();

    const titleInput = $('#add-media-title');
    await titleInput.waitForDisplayed({ timeout: 5000 });
    await titleInput.setValue(title);

    const typeSelect = $('#add-media-type');
    await typeSelect.waitForDisplayed({ timeout: 5000 });
    await typeSelect.selectByVisibleText(type);

    if (contentType) {
        const contentSelect = $('#add-media-content-type');
        await contentSelect.waitForDisplayed({ timeout: 5000 });
        await contentSelect.selectByVisibleText(contentType);
    }

    const confirmBtn = $('#add-media-confirm');
    await confirmBtn.waitForClickable({ timeout: 5000 });
    
    const { getTopmostVisibleOverlay, waitForOverlayToDisappear } = await import('./common.js');
    const overlay = await getTopmostVisibleOverlay('#add-media-confirm');
    await confirmBtn.click();
    await waitForOverlayToDisappear(overlay);

    // Addition can either auto-open detail or return to grid depending on timing.
    // Make this deterministic for tests: if detail is not visible, open the newly added item.
    await browser.waitUntil(async () => {
        const detailHeader = $('#media-detail-header');
        const grid = $('#media-grid-container');
        return (await detailHeader.isDisplayed().catch(() => false)) || (await grid.isDisplayed().catch(() => false));
    }, {
        timeout: 8000,
        timeoutMsg: 'Neither media detail nor grid became ready after adding media'
    });

    const detailHeader = $('#media-detail-header');
    if (!(await detailHeader.isDisplayed().catch(() => false))) {
        await browser.waitUntil(async () => {
            const detailNow = $('#media-detail-header');
            if (await detailNow.isDisplayed().catch(() => false)) {
                return true;
            }
            const added = $(`.media-grid-item[data-title="${title}"]`);
            return await added.isExisting().catch(() => false);
        }, {
            timeout: 10000,
            timeoutMsg: `Added media "${title}" did not appear in detail view or grid in time`
        });

        const detailAfterWait = $('#media-detail-header');
        if (!(await detailAfterWait.isDisplayed().catch(() => false))) {
            await clickMediaItem(title);
        }

        const desc = $('#media-description');
        await desc.waitForDisplayed({ timeout: 8000 });
    }
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
}

/**
 * Wait for the library grid to have a specific number of items.
 */
export async function waitForGridCount(count: number | ((actual: number) => boolean), options: { timeout?: number, timeoutMsg?: string } = {}): Promise<void> {
    await browser.waitUntil(async () => {
        const items = $$('.media-grid-item');
        const actualCount = await items.length;
        if (typeof count === 'function') {
            return count(actualCount);
        }
        return actualCount === count;
    }, {
        timeout: options.timeout || 10000,
        timeoutMsg: options.timeoutMsg || `Grid did not reach expected item count`
    });
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
        Logger.info(`[E2E] Media item "${title}" not found. Current grid items: [${titles.join(', ')}]`);
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
    if (item) {
        await item.waitForDisplayed({ timeout: 5000 }).catch(() => { });
        return await item.isDisplayed();
    }
    return false;
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
    
    // Wait for the detail view root to be present and displayed before returning
    const detailHeader = $('#media-detail-header');
    await detailHeader.waitForDisplayed({ timeout: 8000 });
}

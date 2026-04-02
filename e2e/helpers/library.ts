/**
 * Library (Media Grid) helpers.
 */
/// <reference types="@wdio/globals/types" />
import { Logger } from '../../src/core/logger';
import { waitForNoActiveOverlays } from './common.js';
import { navigateTo, verifyActiveView } from './navigation.js';

export type LibraryLayoutMode = 'grid' | 'list';

function getLibraryContainerSelector(layout: LibraryLayoutMode): string {
    return layout === 'grid' ? '#media-grid-container' : '#media-list-container';
}

function getLibraryItemSelector(title: string, layout: LibraryLayoutMode): string {
    return layout === 'grid'
        ? `.media-grid-item[data-title="${title}"]`
        : `.media-list-item-shell[data-title="${title}"]`;
}

function getLibraryItemsSelector(layout: LibraryLayoutMode): string {
    return layout === 'grid' ? '.media-grid-item' : '.media-list-item-shell';
}

export async function getActiveLibraryLayout(): Promise<LibraryLayoutMode> {
    const list = $(getLibraryContainerSelector('list'));
    if (await list.isDisplayed().catch(() => false)) {
        return 'list';
    }

    const grid = $(getLibraryContainerSelector('grid'));
    await grid.waitForDisplayed({ timeout: 10000 }).catch(() => { });
    return 'grid';
}

export async function waitForLibraryLayout(layout: LibraryLayoutMode): Promise<void> {
    const container = $(getLibraryContainerSelector(layout));
    const inactiveContainer = $(getLibraryContainerSelector(layout === 'grid' ? 'list' : 'grid'));
    const toggle = $(`#btn-layout-${layout}`);

    await browser.waitUntil(async () => {
        const isPressed = (await toggle.getAttribute('aria-pressed').catch(() => 'false')) === 'true';
        const isVisible = await container.isDisplayed().catch(() => false);
        const inactiveVisible = await inactiveContainer.isDisplayed().catch(() => false);
        return isPressed && isVisible && !inactiveVisible;
    }, {
        timeout: 10000,
        timeoutMsg: `Library did not switch to ${layout} layout`,
    });
}

export async function setLibraryLayout(layout: LibraryLayoutMode): Promise<void> {
    if (!(await verifyActiveView('media'))) {
        await navigateTo('media');
    }

    const toggle = $(`#btn-layout-${layout}`);
    await toggle.waitForDisplayed({ timeout: 5000 });

    const isActive = (await toggle.getAttribute('aria-pressed').catch(() => 'false')) === 'true';
    if (!isActive) {
        await safeClick(toggle);
    }

    await waitForLibraryLayout(layout);
}

/**
 * High-level helper to add a new media item from the Library view
 */
export async function addMedia(title: string, type: string, contentType?: string): Promise<void> {
    if (!(await verifyActiveView('media'))) {
        await navigateTo('media');
    }

    await waitForNoActiveOverlays(5_000).catch(() => undefined);

    const addBtn = $('#btn-add-media-grid');
    await addBtn.waitForDisplayed({ timeout: 5000 });
    await safeClick(addBtn);

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
    await confirmBtn.waitForDisplayed({ timeout: 5000 });
    
    const { getTopmostVisibleOverlay, waitForOverlayToDisappear } = await import('./common.js');
    const overlay = await getTopmostVisibleOverlay('#add-media-confirm');
    await safeClick(confirmBtn);
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

async function waitForLibraryRefresh(): Promise<void> {
    await browser.pause(250);
}

async function waitForFilterPanelState(expanded: boolean): Promise<void> {
    const panel = $('#media-grid-filter-panel');
    await panel.waitForExist({ timeout: 5000 });

    await browser.waitUntil(async () => {
        const ariaHidden = await panel.getAttribute('aria-hidden');
        const height = await browser.execute((el) => {
            return Math.round((el as HTMLElement).getBoundingClientRect().height);
        }, await panel);

        if (expanded) {
            return ariaHidden === 'false' && height > 0;
        }

        return ariaHidden === 'true' && height === 0;
    }, {
        timeout: 5000,
        timeoutMsg: `Filter panel did not become ${expanded ? 'expanded' : 'collapsed'}`
    });
}

async function safeClick(element: WebdriverIO.Element): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await element.waitForExist({ timeout: 5000 });
            await element.scrollIntoView().catch(() => { });
            await element.waitForDisplayed({ timeout: 5000 });
            await element.waitForClickable({ timeout: 2000 }).catch(() => { });
            await element.click();
            return;
        } catch {
            // Fall through to the selector-based click fallback below.
        }

        try {
            const selector = (element as unknown as { selector?: unknown }).selector;
            if (typeof selector !== 'string') {
                throw new Error('Library click fallback requires a selector');
            }

            await browser.execute((resolvedSelector) => {
                const nodes = Array.from(document.querySelectorAll(resolvedSelector as string)).reverse();
                const node = nodes.find((candidate) => {
                    if (!(candidate instanceof HTMLElement)) {
                        return false;
                    }

                    const style = globalThis.getComputedStyle(candidate);
                    const rect = candidate.getBoundingClientRect();
                    return style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && rect.width > 0
                        && rect.height > 0;
                });

                if (!(node instanceof HTMLElement)) {
                    throw new Error(`Could not resolve clickable element for selector ${resolvedSelector}`);
                }
                node.click();
            }, selector);
            return;
        } catch (error) {
            lastError = error;
            await browser.pause(150 * (attempt + 1));
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to click library element');
}

export async function setFiltersExpanded(expanded: boolean): Promise<void> {
    const toggle = $('#btn-toggle-filters');
    await toggle.waitForDisplayed({ timeout: 5000 });

    const isExpanded = async () => (await toggle.getAttribute('aria-expanded')) === 'true';
    if ((await isExpanded()) === expanded) {
        await waitForFilterPanelState(expanded);
        return;
    }

    await safeClick(toggle);
    await browser.waitUntil(isExpanded, {
        timeout: 5000,
        timeoutMsg: `Filters toggle did not become ${expanded ? 'expanded' : 'collapsed'}`
    });
    await waitForFilterPanelState(expanded);
}

async function clickFilterChip(group: 'type' | 'status', value: string): Promise<void> {
    const selector = `.media-filter-chip[data-filter-group="${group}"][data-filter-value="${value}"]`;
    const chip = $(selector);
    await chip.waitForDisplayed({ timeout: 5000 });
    await safeClick(chip);
}

async function setFilterGroup(group: 'type' | 'status', values: string[]): Promise<void> {
    await setFiltersExpanded(true);

    await clickFilterChip(group, 'All');
    await waitForLibraryRefresh();

    for (const value of values) {
        await clickFilterChip(group, value);
        await waitForLibraryRefresh();
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

export async function waitForListCount(count: number | ((actual: number) => boolean), options: { timeout?: number, timeoutMsg?: string } = {}): Promise<void> {
    await waitForLibraryLayout('list');
    await browser.waitUntil(async () => {
        const items = $$('.media-list-item-shell');
        const actualCount = await items.length;
        if (typeof count === 'function') {
            return count(actualCount);
        }
        return actualCount === count;
    }, {
        timeout: options.timeout || 10000,
        timeoutMsg: options.timeoutMsg || 'List did not reach expected item count',
    });
}

/**
 * Set the media type filter in the library grid.
 */
export async function setMediaTypeFilter(type: string): Promise<void> {
    await setMediaTypeFilters(type === 'All' ? [] : [type]);
}

export async function setMediaTypeFilters(types: string[]): Promise<void> {
    await setFilterGroup('type', types);
}

/**
 * Set the tracking status filter in the library grid.
 */
export async function setTrackingStatusFilter(status: string): Promise<void> {
    await setTrackingStatusFilters(status === 'All' ? [] : [status]);
}

export async function setTrackingStatusFilters(statuses: string[]): Promise<void> {
    await setFilterGroup('status', statuses);
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
async function findMediaItemInternal(title: string, timeout = 5000, layout?: LibraryLayoutMode) {
    const activeLayout = layout ?? await getActiveLibraryLayout();
    const itemProxy = $(getLibraryItemSelector(title, activeLayout));
    try {
        await itemProxy.waitForExist({ timeout });
        // Resolved element is what we return
        return itemProxy;
    } catch {
        const allItems = await $$(getLibraryItemsSelector(activeLayout));
        const titles = [];
        for (const it of allItems) {
            const itemTitle = await it.getAttribute('data-title');
            if (itemTitle) {
                titles.push(itemTitle);
            }
        }
        Logger.info(`[E2E] Media item "${title}" not found in ${activeLayout} layout. Current items: [${titles.join(', ')}]`);
        return null;
    }
}

/**
 * Check if a media item with a specific title is currently visible in the grid.
 */
export async function isMediaVisible(title: string): Promise<boolean> {
    const activeLayout = await getActiveLibraryLayout();
    const container = $(getLibraryContainerSelector(activeLayout));
    await container.waitForDisplayed({ timeout: 10000 }).catch(() => { });

    const item = await findMediaItemInternal(title, 5000, activeLayout);
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
    const activeLayout = await getActiveLibraryLayout();
    const container = $(getLibraryContainerSelector(activeLayout));
    await container.waitForDisplayed({ timeout: 10000 }).catch(() => { });

    const itemProxy = $(getLibraryItemSelector(title, activeLayout));
    try {
        await itemProxy.waitForExist({ timeout: 1000 });
        return false;
    } catch {
        return true;
    }
}

/**
 * Clicks a media item in the active library layout by its title.
 */
export async function clickMediaItem(title: string): Promise<void> {
    await waitForNoActiveOverlays(5_000).catch(() => undefined);
    const item = await findMediaItemInternal(title);
    if (!item) {
        throw new Error(`[E2E] Failed to click "${title}": not found in the active library layout.`);
    }
    await item.waitForDisplayed({ timeout: 5000 });
    await safeClick(item);
    
    // Wait for the detail view root to be present and displayed before returning
    const detailHeader = $('#media-detail-header');
    await detailHeader.waitForDisplayed({ timeout: 8000 });
}

export async function getMediaItemText(title: string): Promise<string> {
    const item = await findMediaItemInternal(title, 10000);
    if (!item) {
        throw new Error(`[E2E] Failed to read "${title}": not found in the active library layout.`);
    }

    await item.waitForDisplayed({ timeout: 5000 });
    return await item.getText();
}

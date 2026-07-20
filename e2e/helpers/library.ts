/**
 * Library (Media Grid) helpers.
 */
import { Logger } from '../../src/logger';
import { waitForNoActiveOverlays, waitForSelectorDisplayed, safeClick as safeClickBySelector } from './common.js';
import { setText, setSelect } from './form-controls.js';
import { navigateTo, verifyActiveView } from './navigation.js';

export type LibraryLayoutMode = 'grid' | 'list';

const GRID_ITEM_SELECTOR = '.media-grid-item';
const LIST_ITEM_SELECTOR = '.media-list-item-shell';

/** Matches a media item in whichever layout is active (grid on wide viewports, list on narrow). */
export const MEDIA_ITEM_SELECTOR = `${GRID_ITEM_SELECTOR}, ${LIST_ITEM_SELECTOR}`;

function getLibraryContainerSelector(layout: LibraryLayoutMode): string {
    return layout === 'grid' ? '#media-grid-container' : '#media-list-container';
}

function getLibraryItemSelector(title: string, layout: LibraryLayoutMode): string {
    const itemSelector = layout === 'grid' ? GRID_ITEM_SELECTOR : LIST_ITEM_SELECTOR;
    return `${itemSelector}[data-title="${title}"]`;
}

function getLibraryItemsSelector(layout: LibraryLayoutMode): string {
    return layout === 'grid' ? GRID_ITEM_SELECTOR : LIST_ITEM_SELECTOR;
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

/**
 * Whether the grid/list layout toggle is reachable in the current viewport.
 *
 * The toggle shell is `display:none` below the grid breakpoint (mobile), where
 * the library is list-only. Callers use this to skip toggle interactions rather
 * than branching on platform.
 */
export async function isLayoutToggleAvailable(): Promise<boolean> {
    const shell = $('.media-layout-toggle-shell');
    return await shell.isDisplayed().catch(() => false);
}

/** Selector for media items in the active layout, optionally narrowed to a title. */
export async function getActiveMediaItemSelector(title?: string): Promise<string> {
    const itemSelector = getLibraryItemsSelector(await getActiveLibraryLayout());
    return title ? `${itemSelector}[data-title="${title}"]` : itemSelector;
}

/** Waits until the active library container is displayed (grid or list). */
export async function waitForLibraryDisplayed(timeout = 8000): Promise<void> {
    await browser.waitUntil(async () => {
        const listVisible = await $(getLibraryContainerSelector('list')).isDisplayed().catch(() => false);
        const gridVisible = await $(getLibraryContainerSelector('grid')).isDisplayed().catch(() => false);
        return listVisible || gridVisible;
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Library view did not become visible',
    });
}

/** Layout-agnostic item count: counts items in whichever layout is active. */
export async function waitForLibraryItemCount(count: number | ((actual: number) => boolean), options: { timeout?: number, timeoutMsg?: string } = {}): Promise<void> {
    const itemSelector = getLibraryItemsSelector(await getActiveLibraryLayout());
    await browser.waitUntil(async () => {
        const actualCount = await $$(itemSelector).length;
        if (typeof count === 'function') {
            return count(actualCount);
        }
        return actualCount === count;
    }, {
        timeout: options.timeout || 10000,
        timeoutMsg: options.timeoutMsg || 'Library did not reach the expected item count',
    });
}

export async function waitForLibraryLayout(layout: LibraryLayoutMode): Promise<void> {
    const containerSelector = getLibraryContainerSelector(layout);
    const inactiveSelector = getLibraryContainerSelector(layout === 'grid' ? 'list' : 'grid');
    const toggleSelector = `#btn-layout-${layout}`;

    // Re-fetch by selector each poll: web re-renders swap these nodes, staling a captured handle.
    await browser.waitUntil(async () => {
        const isPressed = (await $(toggleSelector).getAttribute('aria-pressed').catch(() => 'false')) === 'true';
        const isVisible = await $(containerSelector).isDisplayed().catch(() => false);
        const inactiveVisible = await $(inactiveSelector).isDisplayed().catch(() => false);
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

    // Below the grid breakpoint (mobile) the layout is fixed to list and the
    // toggle is hidden, so the requested layout can't be chosen via the UI. The
    // viewport dictates the layout — nothing to switch.
    if (!(await isLayoutToggleAvailable())) {
        await waitForLibraryDisplayed();
        return;
    }

    const toggleSelector = `#btn-layout-${layout}`;
    await waitForSelectorDisplayed(toggleSelector, 5000);

    const containerSelector = getLibraryContainerSelector(layout);
    const inactiveSelector = getLibraryContainerSelector(layout === 'grid' ? 'list' : 'grid');

    // Re-click by selector each poll: a slow web re-render can drop or revert a single click.
    await browser.waitUntil(async () => {
        const isPressed = (await $(toggleSelector).getAttribute('aria-pressed').catch(() => 'false')) === 'true';
        const isVisible = await $(containerSelector).isDisplayed().catch(() => false);
        const inactiveVisible = await $(inactiveSelector).isDisplayed().catch(() => false);
        if (isPressed && isVisible && !inactiveVisible) {
            return true;
        }
        if (!isPressed) {
            await safeClickBySelector(toggleSelector).catch(() => undefined);
        }
        return false;
    }, {
        timeout: 15000,
        timeoutMsg: `Library did not switch to ${layout} layout`,
    });
}

/**
 * High-level helper to add a new media item from the Library view
 */
export async function addMedia(title: string, type: string, contentType?: string, variant?: string): Promise<void> {
    if (!(await verifyActiveView('media'))) {
        await navigateTo('media');
    }

    await waitForNoActiveOverlays(5_000).catch(() => undefined);

    const addBtn = $('#btn-add-media-grid');
    await addBtn.waitForDisplayed({ timeout: 5000 });
    await safeClickBySelector('#btn-add-media-grid');

    const titleInput = $('#add-media-title');
    await titleInput.waitForDisplayed({ timeout: 5000 });
    await setText('#add-media-title', title);

    if (variant) {
        await setText('#add-media-variant', variant);
    }

    await setSelect('#add-media-type', { text: type });

    if (contentType) {
        await setSelect('#add-media-content-type', { text: contentType });
    }

    const confirmBtn = $('#add-media-confirm');
    await confirmBtn.waitForDisplayed({ timeout: 5000 });
    
    const { getTopmostVisibleOverlay, waitForOverlayToDisappear } = await import('./common.js');
    const overlay = await getTopmostVisibleOverlay('#add-media-confirm');
    await safeClickBySelector('#add-media-confirm');
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
            const added = $(`${GRID_ITEM_SELECTOR}[data-title="${title}"]`);
            return await added.isExisting().catch(() => false);
        }, {
            timeout: 10000,
            timeoutMsg: `Added media "${title}" did not appear in detail view or grid in time`
        });

        const detailAfterWait = $('#media-detail-header');
        if (!(await detailAfterWait.isDisplayed().catch(() => false))) {
            await clickMediaItem(title);
        }

        await waitForSelectorDisplayed('#media-description', 8000);
    }
}

/**
 * Set the search query in the library grid.
 */
export async function setSearchQuery(query: string): Promise<void> {
    await setText('#grid-search-filter', query);
}

async function waitForLibraryRefresh(): Promise<void> {
    await browser.execute(() => new Promise<void>((resolve) => {
        const settle = () => resolve();
        requestAnimationFrame(() => requestAnimationFrame(settle));
    }));
}

async function waitForFilterPanelState(expanded: boolean): Promise<void> {
    const panel = $('#media-grid-filter-panel');
    await panel.waitForExist({ timeout: 5000 });

    await browser.waitUntil(async () => {
        const ariaHidden = await panel.getAttribute('aria-hidden');
        const height = await browser.execute(() => {
            const el = document.getElementById('media-grid-filter-panel');
            return el ? Math.round(el.getBoundingClientRect().height) : 0;
        });

        if (expanded) {
            return ariaHidden === 'false' && height > 0;
        }

        return ariaHidden === 'true' && height === 0;
    }, {
        timeout: 5000,
        timeoutMsg: `Filter panel did not become ${expanded ? 'expanded' : 'collapsed'}`
    });
}

export async function setFiltersExpanded(expanded: boolean): Promise<void> {
    const toggle = $('#btn-toggle-filters');
    await toggle.waitForDisplayed({ timeout: 5000 });

    const isExpanded = async () => (await toggle.getAttribute('aria-expanded')) === 'true';
    if ((await isExpanded()) === expanded) {
        await waitForFilterPanelState(expanded);
        return;
    }

    await safeClickBySelector('#btn-toggle-filters');
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
    await safeClickBySelector(selector);
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

export async function waitForListCount(count: number | ((actual: number) => boolean), options: { timeout?: number, timeoutMsg?: string } = {}): Promise<void> {
    await waitForLibraryLayout('list');
    await browser.waitUntil(async () => {
        const items = $$(LIST_ITEM_SELECTOR);
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

export async function setMediaTypeFilters(types: string[]): Promise<void> {
    await setFilterGroup('type', types);
}

export async function setTrackingStatusFilters(statuses: string[]): Promise<void> {
    await setFilterGroup('status', statuses);
}

/**
 * Toggle the "Hide Archived" checkbox in the library grid.
 */
export async function setHideArchived(hide: boolean): Promise<void> {
    // First, expand the filter panel if it's not already open
    const filterToggle = $('#btn-toggle-filters');
    await filterToggle.waitForDisplayed({ timeout: 5000 });
    const isExpanded = (await filterToggle.getAttribute('aria-expanded')) === 'true';
    if (!isExpanded) {
        await filterToggle.click();
        // Wait for the panel to be visible
        const filterPanel = $('#media-grid-filter-panel');
        await filterPanel.waitForDisplayed({ timeout: 5000 });
    }

    const checkbox = $('#grid-hide-archived');
    await checkbox.waitForExist({ timeout: 5000 });
    const isChecked = await checkbox.isSelected();
    if (isChecked !== hide) {
        // The input itself is hidden (opacity 0), so we click the slider (.slider)
        const slider = checkbox.nextElement();
        await slider.click();
        await browser.waitUntil(async () => (await checkbox.isSelected()) === hide, {
            timeout: 3_000,
            timeoutMsg: `"Hide Archived" did not become ${hide ? 'checked' : 'unchecked'}`
        });
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
        const items = $$(getLibraryItemsSelector(activeLayout));
        const titles = (await items.map((item) => item.getAttribute('data-title'))).filter(Boolean);
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
    const activeLayout = await getActiveLibraryLayout();
    const item = await findMediaItemInternal(title, 5000, activeLayout);
    if (!item) {
        throw new Error(`[E2E] Failed to click "${title}": not found in the active library layout.`);
    }
    await item.waitForDisplayed({ timeout: 5000 });
    await safeClickBySelector(getLibraryItemSelector(title, activeLayout));

    // Wait for the detail view root to be present and displayed before returning.
    // Re-fetch each poll (see waitForSelectorDisplayed) so an async re-render on
    // web can't leave us waiting on a stale node.
    await waitForSelectorDisplayed('#media-detail-header', 8000);
}

export async function getMediaItemText(title: string): Promise<string> {
    const item = await findMediaItemInternal(title, 10000);
    if (!item) {
        throw new Error(`[E2E] Failed to read "${title}": not found in the active library layout.`);
    }

    await item.waitForDisplayed({ timeout: 5000 });
    return await item.getText();
}

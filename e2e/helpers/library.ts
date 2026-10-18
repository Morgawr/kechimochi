/**
 * Library (Media Grid) helpers.
 */
import { Logger } from '../../src/logger';
import {
    getTopmostVisibleOverlay,
    safeClick as safeClickBySelector,
    waitForNoActiveOverlays,
    waitForOverlayToDisappear,
    waitForSelectorDisplayed,
} from './common.js';
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

function getLibraryItemSelector(title: string, layout: LibraryLayoutMode, variant?: string): string {
    const itemSelector = layout === 'grid' ? GRID_ITEM_SELECTOR : LIST_ITEM_SELECTOR;
    const variantSelector = variant === undefined ? '' : `[data-variant="${variant}"]`;
    return `${itemSelector}[data-title="${title}"]${variantSelector}`;
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
    const shell = $('.toggle-shell');
    return await shell.isDisplayed().catch(() => false);
}

/** Selector for the library container of whichever layout is active. */
export async function getActiveLibraryContainerSelector(): Promise<string> {
    return getLibraryContainerSelector(await getActiveLibraryLayout());
}

/** Selector for media items in the active layout, optionally narrowed to a title. */
export async function getActiveMediaItemSelector(title?: string, variant?: string): Promise<string> {
    const itemSelector = getLibraryItemsSelector(await getActiveLibraryLayout());
    if (!title) return itemSelector;
    const variantSelector = variant === undefined ? '' : `[data-variant="${variant}"]`;
    return `${itemSelector}[data-title="${title}"]${variantSelector}`;
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

    // The media nav remains active while detail is open. Return to the browser
    // before looking for the grid-only Add button.
    if (await $('#media-detail-header').isDisplayed().catch(() => false)) {
        await safeClickBySelector('#btn-back-grid');
        await waitForLibraryDisplayed();
    }

    await waitForNoActiveOverlays(5_000).catch(() => undefined);

    await waitForSelectorDisplayed('#btn-add-media-grid', 5000);
    await safeClickBySelector('#btn-add-media-grid');

    // Re-query modal controls instead of holding WebDriver element handles.
    // On web, the modal can visibly mount after a render replaced the node
    // behind a captured handle, leaving that handle reporting "not displayed".
    await waitForSelectorDisplayed('#add-media-title', 5000);
    await setText('#add-media-title', title);

    if (variant) {
        await setText('#add-media-variant', variant);
    }

    await setSelect('#add-media-type', { text: type });

    if (contentType) {
        await setSelect('#add-media-content-type', { text: contentType });
    }

    await waitForSelectorDisplayed('#add-media-confirm', 5000);
    const overlay = await getTopmostVisibleOverlay('#add-media-confirm', 5000);
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
            const added = $(getLibraryItemSelector(title, 'grid', variant));
            return await added.isExisting().catch(() => false);
        }, {
            timeout: 10000,
            timeoutMsg: `Added media "${title}" did not appear in detail view or grid in time`
        });

        const detailAfterWait = $('#media-detail-header');
        if (!(await detailAfterWait.isDisplayed().catch(() => false))) {
            await clickMediaItem(title, variant);
        }

        await waitForSelectorDisplayed('#media-description', 8000);
    }
}

/**
 * Set the search query in the library grid.
 */
export async function setSearchQuery(query: string): Promise<void> {
    await setText('#grid-search-filter', query);
    await browser.waitUntil(async () => {
        const content = $('#media-library-content');
        return (await content.getAttribute('aria-busy').catch(() => 'true')) !== 'true';
    }, {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'Library search did not finish rendering in time',
    });
}

async function waitForLibraryRefresh(): Promise<void> {
    // Native WebKit may throttle requestAnimationFrame when an interaction is
    // a deliberate no-op, so an rAF-based wait can block forever. Chip renders
    // are synchronous; this short driver-side pause only yields to WebDriver.
    await browser.pause(50);
}

/**
 * Whether Filter/Sort panes render inline in the header (≥769px) rather than as a
 * centred modal (≤768px). Same breakpoint as the grid/list toggle and the item layout.
 */
async function arePanesInline(): Promise<boolean> {
    return await isLayoutToggleAvailable();
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

async function waitForFilterModalState(open: boolean): Promise<void> {
    await browser.waitUntil(async () => {
        const isTrayInModal = await $('.modal-overlay .media-pane-modal-body #media-grid-filter-tray').isExisting();
        return isTrayInModal === open;
    }, {
        timeout: 5000,
        timeoutMsg: `Filter modal did not become ${open ? 'open' : 'closed'}`,
    });
}

async function waitForFilterPaneState(expanded: boolean): Promise<void> {
    if (await arePanesInline()) {
        await waitForFilterPanelState(expanded);
    } else {
        await waitForFilterModalState(expanded);
    }
}

export async function setFiltersExpanded(expanded: boolean): Promise<void> {
    const toggle = $('#btn-toggle-filters');
    await toggle.waitForDisplayed({ timeout: 5000 });

    const isExpanded = async () => (await toggle.getAttribute('aria-expanded')) === 'true';
    if ((await isExpanded()) === expanded) {
        await waitForFilterPaneState(expanded);
        return;
    }

    await safeClickBySelector('#btn-toggle-filters');
    await browser.waitUntil(isExpanded, {
        timeout: 5000,
        timeoutMsg: `Filters toggle did not become ${expanded ? 'expanded' : 'collapsed'}`
    });
    await waitForFilterPaneState(expanded);
}

const MULTI_SELECT_PANEL_SELECTOR = '.multi-select-panel';

async function openMultiSelectPanel(triggerId: string): Promise<void> {
    await safeClickBySelector(`#${triggerId}`);
    await $(MULTI_SELECT_PANEL_SELECTOR).waitForDisplayed({ timeout: 5000 });
}

async function closeMultiSelectPanel(): Promise<void> {
    const panel = $(MULTI_SELECT_PANEL_SELECTOR);
    if (await panel.isExisting()) await browser.keys('Escape');
    await panel.waitForExist({ timeout: 5000, reverse: true });
}

async function readMultiSelectOptionStates(triggerId: string): Promise<{ value: string; isChecked: boolean }[]> {
    await openMultiSelectPanel(triggerId);
    const optionStates = await browser.execute((panelSelector) => Array.from(
        document.querySelectorAll<HTMLInputElement>(`${panelSelector} .multi-select-option input[type="checkbox"]`),
        checkbox => ({ value: checkbox.value, isChecked: checkbox.checked }),
    ), MULTI_SELECT_PANEL_SELECTOR);
    await closeMultiSelectPanel();
    return optionStates;
}

// The multiselect closes on any page scroll (including the browser clamping the scroll position
// when a toggle shortens the library), so each toggle is its own open → click → close, and nothing
// that scrolls runs while the panel is open: Escape closes it, and the fixed panel is never scrolled to.
async function setMultiSelectShownValues(triggerId: string, values: string[]): Promise<void> {
    const shouldBeShown = (value: string) => values.length === 0 || values.includes(value);
    await setFiltersExpanded(true);

    for (const { value, isChecked } of await readMultiSelectOptionStates(triggerId)) {
        if (isChecked === shouldBeShown(value)) continue;

        await openMultiSelectPanel(triggerId);
        await safeClickBySelector(
            `${MULTI_SELECT_PANEL_SELECTOR} input[type="checkbox"][value="${value}"]`,
            5000,
            { skipScrollIntoView: true },
        );
        await waitForLibraryRefresh();
        await closeMultiSelectPanel();
    }

    const mismatchedValues = (await readMultiSelectOptionStates(triggerId))
        .filter(({ value, isChecked }) => isChecked !== shouldBeShown(value))
        .map(({ value }) => value);
    if (mismatchedValues.length > 0) {
        throw new Error(`[E2E] Multiselect options not in the requested state: ${mismatchedValues.join(', ')}`);
    }
}

async function addFilterRuleToLastGroup(): Promise<number> {
    const groups = await $$('.media-filter-rule-group');
    const groupCount = await groups.length;
    if (groupCount === 0) {
        await safeClickBySelector('#btn-add-filter-rule-group');
    } else {
        const lastGroupIndex = await groups[groupCount - 1].getAttribute('data-group-index');
        await safeClickBySelector(`.media-filter-add-and[data-group-index="${lastGroupIndex}"]`);
    }

    const rows = await $$('.media-extra-filter-rule');
    const rowCount = await rows.length;
    if (rowCount === 0) {
        throw new Error('No filter rule was added');
    }
    const ruleIndexValue = await rows[rowCount - 1].getAttribute('data-rule-index');
    const ruleIndex = Number(ruleIndexValue);
    if (!Number.isInteger(ruleIndex) || ruleIndex < 0) {
        throw new Error('No filter rule was added');
    }
    return ruleIndex;
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
    await setMultiSelectShownValues('media-type-multiselect-trigger', types);
}

export async function setTrackingStatusFilters(statuses: string[]): Promise<void> {
    await setMultiSelectShownValues('media-status-multiselect-trigger', statuses);
}

export async function setBooleanTagFilters(tags: string[]): Promise<void> {
    await setFiltersExpanded(true);

    while (await $$('.media-extra-filter-rule[data-rule-kind="booleanTag"]').length > 0) {
        await safeClickBySelector(
            '.media-extra-filter-rule[data-rule-kind="booleanTag"] .media-filter-rule-remove',
        );
        await waitForLibraryRefresh();
    }

    for (const tag of tags) {
        const ruleIndex = await addFilterRuleToLastGroup();
        await setSelect(`.media-extra-filter-field[data-rule-index="${ruleIndex}"]`, { text: `#${tag}` });
        await waitForLibraryRefresh();
    }
}

export async function clearExtraFieldFilterRules(): Promise<void> {
    await setFiltersExpanded(true);

    while (await $$('.media-extra-filter-rule[data-rule-kind="extra"]').length > 0) {
        await safeClickBySelector(
            '.media-extra-filter-rule[data-rule-kind="extra"] .media-filter-rule-remove',
        );
        await waitForLibraryRefresh();
    }
}

export type LibraryFilterRuleLogic = 'and' | 'or' | 'andNot' | 'orNot';

export async function addExtraFieldFilterRule({
    fieldName,
    operator,
    value,
    logic = 'and',
}: {
    fieldName: string;
    operator: string;
    value: string;
    logic?: LibraryFilterRuleLogic;
}): Promise<number> {
    await setFiltersExpanded(true);
    const ruleIndex = await addFilterRuleToLastGroup();

    await setSelect(`.media-extra-filter-field[data-rule-index="${ruleIndex}"]`, { text: fieldName });
    await setSelect(`.media-extra-filter-operator[data-rule-index="${ruleIndex}"]`, { value: operator });
    await setLibraryFilterRuleLogic(ruleIndex, logic);
    await setText(`.media-extra-filter-value[data-rule-index="${ruleIndex}"]`, value);
    await waitForLibraryRefresh();
    return ruleIndex;
}

export async function setLibraryFilterRuleLogic(
    ruleIndex: number,
    logic: LibraryFilterRuleLogic,
): Promise<void> {
    if (ruleIndex === 0 && (logic === 'or' || logic === 'orNot')) {
        throw new Error('The first library filter rule cannot start with OR');
    }

    const negated = logic === 'andNot' || logic === 'orNot';
    await safeClickBySelector(`.media-filter-negation-option[data-rule-index="${ruleIndex}"][data-negated="${negated}"]`);
    await waitForLibraryRefresh();

    if (ruleIndex === 0) return;

    const wantsOr = logic === 'or' || logic === 'orNot';
    const isOr = await $(`.media-filter-or-divider[data-rule-index="${ruleIndex}"]`).isExisting();
    if (isOr !== wantsOr) {
        await safeClickBySelector(`.media-filter-join-toggle[data-rule-index="${ruleIndex}"]`);
        await waitForLibraryRefresh();
    }
}

/**
 * Toggle the "Hide Archived" checkbox in the library grid.
 */
export async function setHideArchived(hide: boolean): Promise<void> {
    await setFiltersExpanded(true);

    const checkbox = $('#grid-hide-archived');
    await checkbox.waitForExist({ timeout: 5000 });
    const isChecked = await checkbox.isSelected();
    if (isChecked !== hide) {
        // The input itself is hidden (opacity 0), so we click the slider (.slider)
        const slider = checkbox.nextElement();
        await slider.click();
        await browser.waitUntil(async () => (
            await $('#grid-hide-archived').isSelected().catch(() => !hide)
        ) === hide, {
            timeout: 3_000,
            timeoutMsg: `"Hide Archived" did not become ${hide ? 'checked' : 'unchecked'}`
        });
    }
}

/**
 * Internal helper to find a media item and log grid state on failure.
 */
async function findMediaItemInternal(title: string, timeout = 5000, layout?: LibraryLayoutMode, variant?: string) {
    const activeLayout = layout ?? await getActiveLibraryLayout();
    const itemProxy = $(getLibraryItemSelector(title, activeLayout, variant));
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
export async function clickMediaItem(title: string, variant?: string): Promise<void> {
    await waitForNoActiveOverlays(5_000).catch(() => undefined);
    const activeLayout = await getActiveLibraryLayout();
    const item = await findMediaItemInternal(title, 5000, activeLayout, variant);
    if (!item) {
        throw new Error(`[E2E] Failed to click "${title}": not found in the active library layout.`);
    }
    await item.waitForDisplayed({ timeout: 5000 });
    await safeClickBySelector(getLibraryItemSelector(title, activeLayout, variant));

    // Wait for the detail view root to be present and displayed before returning.
    // Re-fetch each poll (see waitForSelectorDisplayed) so an async re-render on
    // web can't leave us waiting on a stale node.
    await waitForSelectorDisplayed('#media-detail-header', 8000);
}

export async function requireFinePointer(): Promise<void> {
    const matches = await browser.execute(
        () => globalThis.matchMedia('(hover: hover) and (pointer: fine)').matches,
    );
    if (!matches) {
        throw new Error('[E2E] (hover: hover) and (pointer: fine) does not match; this platform cannot exercise the hover/context-menu features.');
    }
}

export async function getMediaItemText(title: string): Promise<string> {
    const item = await findMediaItemInternal(title, 10000);
    if (!item) {
        throw new Error(`[E2E] Failed to read "${title}": not found in the active library layout.`);
    }

    await item.waitForDisplayed({ timeout: 5000 });
    return await item.getText();
}

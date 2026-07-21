/**
 * Dashboard-specific helpers.
 */
import { clickTopmostOverlayChild, confirmAction, performActivityEdit, safeClick, getTopmostVisibleOverlay, waitForNoActiveOverlays, selectActivityDate } from './common.js';
import { setText, setSelect } from './form-controls.js';

async function waitForActivitySubmissionResult(timeout = 5000): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute(() => {
            const form = document.querySelector('#add-activity-form');
            if (!form) {
                return true;
            }

            const formOverlay = form.closest('.modal-overlay');
            if (!(formOverlay instanceof HTMLElement) || !formOverlay.classList.contains('active')) {
                return true;
            }

            return Array.from(document.querySelectorAll('.modal-overlay')).some((overlay) => {
                if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                    return false;
                }

                return overlay.querySelector('#alert-ok, #prompt-input') !== null;
            });
        });
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Activity submission did not close the form or show a validation prompt',
    });
}

export async function waitForActivityFormToDisappear(timeout = 5000): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute(() => document.querySelector('#add-activity-form') === null);
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Activity form did not disappear in time',
    });
}

async function selectExistingActivityMedia(title: string, variant?: string): Promise<void> {
    const outcome = await browser.execute((expectedTitle, expectedVariant) => {
        const exactTitleMatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.activity-media-suggestion'))
            .filter(button => button.dataset.mediaTitle === expectedTitle);
        const matches = expectedVariant === null
            ? exactTitleMatches
            : exactTitleMatches.filter(button => (button.dataset.mediaVariant || '') === expectedVariant);
        if (matches.length === 1) {
            matches[0].click();
            return 'selected';
        }
        if (matches.length > 1 || (expectedVariant === null && exactTitleMatches.length > 1)) {
            return 'ambiguous';
        }
        return 'new';
    }, title, variant ?? null);

    if (outcome === 'ambiguous') {
        throw new Error(`Activity media "${title}" is ambiguous; provide its variant.`);
    }
    if (variant !== undefined && outcome !== 'selected') {
        throw new Error(`Activity media "${title}" with variant "${variant}" was not selectable.`);
    }
}

/**
 * High-level helper to log an activity from the dashboard
 */
export async function logActivity(
    title: string,
    duration: string,
    characters: string = "0",
    date?: string,
    activityType?: string,
    notes?: string,
    mediaVariant?: string,
): Promise<void> {
    await waitForNoActiveOverlays();
    const addActivityBtn = $('#btn-add-activity');
    await addActivityBtn.waitForClickable({ timeout: 5000 });
    await addActivityBtn.click();

    const overlay = await getTopmostVisibleOverlay('#add-activity-form', 10000);

    // Dynamically fetch and wait for elements to avoid StaleElementReferenceException from UI updates
    await browser.waitUntil(async () => await overlay.$('#activity-media').isDisplayed().catch(() => false), { timeout: 10000 });
    await setText('#activity-media', title);
    await selectExistingActivityMedia(title, mediaVariant);

    await browser.waitUntil(async () => await overlay.$('#activity-duration').isDisplayed().catch(() => false), { timeout: 5000 });
    await setText('#activity-duration', duration);

    if (await overlay.$('#activity-characters').isExisting()) {
        await setText('#activity-characters', characters);
    }

    if (activityType) {
        if (await overlay.$('#activity-type').isExisting()) {
            await setSelect('#activity-type', { text: activityType });
        }
    }

    if (notes !== undefined && await overlay.$('#activity-notes').isExisting()) {
        await setText('#activity-notes', notes);
    }

    if (date) {
        await selectActivityDate(date);
    }

    const submitBtn = overlay.$('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 5000 });
    await submitBtn.click();

    // Query the DOM on every poll. Holding or recreating a WebDriver element
    // handle while the dashboard rerenders can itself race with Wry and become
    // stale. A prompt or alert is also a valid submission result for callers
    // that intentionally exercise those flows.
    await waitForActivitySubmissionResult();
}

/**
 * Gets a numeric value from a dashboard stat element.
 */
export async function getStatValue(id: string): Promise<number> {
    const el = $(`#${id}`);
    await el.waitForDisplayed({ timeout: 5000 });
    const text = await el.getText();
    // Extract first number (allowing for dots and commas)
    const match = text.match(/[\d,.]+/);
    if (!match) return 0;
    const cleanedText = match[0].replaceAll(',', '');
    return Number.parseFloat(cleanedText);
}

/**
 * Deletes the most recent log in the dashboard timeline.
 */
export async function deleteMostRecentLog(): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute(() => {
            const buttons = Array.from(document.querySelectorAll('.dashboard-activity-item .delete-log-btn, .delete-log-btn'));
            const button = buttons.find((node) => {
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

            if (!(button instanceof HTMLElement)) {
                return false;
            }

            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return true;
        });
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Could not click a visible delete log button'
    });
    
    // Use the robust confirm helper
    await confirmAction(true);
    
    // Stabilize dashboard after deletion
    await waitForHeatmapReady();
}

/**
 * Clicks the edit button for the most recent log in the dashboard timeline and updates it.
 */
export async function editMostRecentLog(
    newDuration: string,
    newCharacters: string = "0",
    newNotes?: string,
    newActivityType?: string,
): Promise<void> {
    await performActivityEdit(
        '.dashboard-activity-item .edit-log-btn',
        newDuration,
        newCharacters,
        newNotes,
        newActivityType,
    );
}

/**
 * Returns the background-color style of a heatmap cell for a given date.
 */
export async function getHeatmapCellColor(date: string): Promise<string> {
    await waitForHeatmapReady();

    const cell = $(`.heatmap-cell[title^="${date}"]`);
    await cell.waitForExist({ timeout: 5000 });
    return await cell.getCSSProperty('background-color').then(p => p.value || '');
}

export async function waitForHeatmapReady(timeout = 10000): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute(() => {
            const heatmap = document.querySelector<HTMLElement>('.heatmap');
            if (!heatmap) return false;

            const rect = heatmap.getBoundingClientRect();
            const style = getComputedStyle(heatmap);
            const calendarCells = heatmap.querySelectorAll('.heatmap-cell[title]');

            return calendarCells.length >= 365
                && rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        }).catch(() => false);
    }, {
        timeout,
        interval: 100,
        timeoutMsg: 'Expected dashboard heatmap to finish rendering'
    });
}

export async function clickHeatmapCell(date: string): Promise<void> {
    await waitForHeatmapReady();

    const cell = $(`.heatmap-cell[data-date="${date}"]`);
    await cell.waitForDisplayed({ timeout: 5000 });
    await safeClick(cell);
}

export async function selectActivityChartTimeRange(days: '0' | '7' | '30' | '365'): Promise<void> {
    await setSelect('#select-time-range', { value: days });
}

export async function getActivityChartRangeMetadata(): Promise<{
    rangeStart: string;
    rangeEnd: string;
    timeRangeDays: string;
    timeRangeOffset: string;
}> {
    const getGrid = () => $('#activity-charts-grid');
    await getGrid().waitForDisplayed({ timeout: 5000 });

    await browser.waitUntil(async () => {
        const rangeStart = await getGrid().getAttribute('data-range-start');
        return Boolean(rangeStart);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'Expected activity chart range metadata to be available'
    });

    return {
        rangeStart: (await getGrid().getAttribute('data-range-start')) ?? '',
        rangeEnd: (await getGrid().getAttribute('data-range-end')) ?? '',
        timeRangeDays: (await getGrid().getAttribute('data-time-range-days')) ?? '',
        timeRangeOffset: (await getGrid().getAttribute('data-time-range-offset')) ?? ''
    };
}

/**
 * Logs activity using the global (+) button in the navbar.
 */
export async function logActivityGlobal(mediaTitle: string, minutes: number, characters: number = 0, activityType?: string, mediaVariant?: string): Promise<void> {
    const logBtn = $('#btn-add-activity');
    await safeClick(logBtn);
    
    await setText('#activity-media', mediaTitle);
    await selectExistingActivityMedia(mediaTitle, mediaVariant);
    await setText('#activity-duration', String(minutes));
    if (await $('#activity-characters').isExisting()) {
        await setText('#activity-characters', String(characters));
    }

    if (activityType && await $('#activity-type').isExisting()) {
        await setSelect('#activity-type', { text: activityType });
    }
    
    const submitBtnSelector = '#add-activity-form button[type="submit"]';
    await getTopmostVisibleOverlay(submitBtnSelector);
    await clickTopmostOverlayChild(submitBtnSelector);
    await waitForActivitySubmissionResult();
}

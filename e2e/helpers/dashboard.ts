/**
 * Dashboard-specific helpers.
 */
/// <reference types="@wdio/globals/types" />
import { clickTopmostOverlayChild, confirmAction, performActivityEdit, safeClick } from './common.js';

/**
 * High-level helper to log an activity from the dashboard
 */
export async function logActivity(title: string, duration: string, characters: string = "0", date?: string, activityType?: string): Promise<void> {
    const addActivityBtn = $('#btn-add-activity');
    await addActivityBtn.waitForClickable({ timeout: 5000 });
    await addActivityBtn.click();

    const mediaInput = $('#activity-media');
    await mediaInput.waitForDisplayed({ timeout: 10000 });
    await mediaInput.setValue(title);

    const durationInput = $('#activity-duration');
    await durationInput.waitForDisplayed({ timeout: 5000 });
    await durationInput.setValue(duration);

    const charInput = $('#activity-characters');
    if (await charInput.isExisting()) {
        await charInput.setValue(characters);
    }

    if (activityType) {
        const typeSelect = $('#activity-type');
        if (await typeSelect.isExisting()) {
            await typeSelect.selectByVisibleText(activityType);
        }
    }

    if (date) {
        const dateEl = $(`.cal-day[data-date="${date}"]`);
        if (await dateEl.isExisting()) {
            await dateEl.click();
        }
    }

    const submitBtn = $('#add-activity-form button[type="submit"]');
    await submitBtn.waitForClickable({ timeout: 5000 });
    await submitBtn.click();
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
    await browser.pause(300);
}

/**
 * Clicks the edit button for the most recent log in the dashboard timeline and updates it.
 */
export async function editMostRecentLog(newDuration: string, newCharacters: string = "0"): Promise<void> {
    await performActivityEdit('.dashboard-activity-item .edit-log-btn', newDuration, newCharacters);
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

export async function selectActivityChartTimeRange(days: '7' | '30' | '365'): Promise<void> {
    const select = $('#select-time-range');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', days);
    await browser.waitUntil(async () => (await select.getValue()) === days, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Expected activity chart time range to be ${days}`
    });
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
export async function logActivityGlobal(mediaTitle: string, minutes: number, characters: number = 0, activityType?: string): Promise<void> {
    const logBtn = $('#btn-add-activity');
    await safeClick(logBtn);
    
    await setTopmostActivityFieldValue('#activity-media', mediaTitle);
    await setTopmostActivityFieldValue('#activity-duration', String(minutes));
    await setTopmostActivityFieldValue('#activity-characters', String(characters), false);

    if (activityType) {
        await setTopmostActivityFieldValue('#activity-type', activityType, false);
    }
    
    await clickTopmostOverlayChild('#add-activity-form button[type="submit"]');
    await browser.pause(500); // Original pause to wait for re-render
}

async function setTopmostActivityFieldValue(selector: string, value: string, required = true): Promise<void> {
    await browser.waitUntil(async () => {
        return browser.execute((targetSelector, shouldExist) => {
            if (!shouldExist) {
                return true;
            }

            return Array.from(document.querySelectorAll('.modal-overlay')).reverse().some((overlay) => {
                if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                    return false;
                }

                const style = globalThis.getComputedStyle(overlay);
                const rect = overlay.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0
                    && overlay.querySelector(targetSelector as string) !== null;
            });
        }, selector, required).catch(() => false);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Expected activity modal field ${selector} to exist`
    });

    await browser.execute((targetSelector, nextValue, shouldExist) => {
        const findActiveOverlayElement = (selector: string): Element | null => {
            const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
            for (const overlay of overlays) {
                if (!(overlay instanceof HTMLElement) || !overlay.classList.contains('active')) {
                    continue;
                }

                const style = globalThis.getComputedStyle(overlay);
                const rect = overlay.getBoundingClientRect();
                if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
                    continue;
                }

                const element = overlay.querySelector(selector);
                if (element) {
                    return element;
                }
            }

            return null;
        };
        const element = findActiveOverlayElement(targetSelector as string);
        if (!element) {
            if (shouldExist) {
                throw new Error(`Activity modal field not found: ${targetSelector}`);
            }
            return;
        }

        if (element instanceof HTMLSelectElement) {
            const requestedValue = String(nextValue);
            const option = Array.from(element.options).find(candidate => {
                return candidate.value === requestedValue || candidate.textContent?.trim() === requestedValue;
            });
            if (!option) {
                if (shouldExist) {
                    throw new Error(`Activity modal option not found: ${requestedValue}`);
                }
                return;
            }

            element.focus();
            element.value = option.value;
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            return;
        }

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.focus();
            element.value = String(nextValue);
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            return;
        }

        throw new Error(`Activity modal field is not editable: ${targetSelector}`);
    }, selector, value, required);
}

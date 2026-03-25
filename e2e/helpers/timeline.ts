/**
 * Timeline view helpers.
 */
/// <reference types="@wdio/globals/types" />
import { navigateTo, verifyActiveView } from './navigation.js';

export interface TimelineEntrySnapshot {
    kind: string;
    date: string;
    text: string;
}

export async function openTimeline(): Promise<void> {
    await navigateTo('timeline');
    expect(await verifyActiveView('timeline')).toBe(true);
    await waitForTimelineReady();
}

export async function waitForTimelineReady(): Promise<void> {
    const root = $('#timeline-root');
    await root.waitForDisplayed({ timeout: 10000 });

    await browser.waitUntil(async () => {
        const loading = await $('.timeline-loading').isDisplayed().catch(() => false);
        if (loading) {
            return false;
        }

        const entryCount = await $$('.timeline-entry').length;
        const emptyVisible = await $('.timeline-empty').isDisplayed().catch(() => false);
        return entryCount > 0 || emptyVisible;
    }, {
        timeout: 10000,
        interval: 100,
        timeoutMsg: 'Timeline view did not finish rendering in time',
    });
}

export async function setTimelineKindFilter(label: string): Promise<void> {
    const select = $('#timeline-kind-filter');
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByVisibleText(label);

    await browser.waitUntil(async () => {
        return await browser.execute(expectedLabel => {
            const element = document.getElementById('timeline-kind-filter') as HTMLSelectElement | null;
            return element?.selectedOptions[0]?.textContent?.trim() === expectedLabel;
        }, label);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Timeline kind filter did not switch to "${label}"`,
    });

    await browser.pause(250);
}

export async function searchTimeline(query: string): Promise<void> {
    const input = $('#timeline-search');
    await input.waitForDisplayed({ timeout: 5000 });

    await browser.execute(nextQuery => {
        const element = document.getElementById('timeline-search') as HTMLInputElement | null;
        if (!element) {
            return;
        }

        element.value = nextQuery;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, query);

    await browser.waitUntil(async () => {
        return await browser.execute(expectedQuery => {
            const element = document.getElementById('timeline-search') as HTMLInputElement | null;
            return element?.value === expectedQuery;
        }, query);
    }, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Timeline search input did not settle to "${query}"`,
    });

    await browser.pause(250);
}

export async function getTimelineEntrySnapshots(limit?: number): Promise<TimelineEntrySnapshot[]> {
    return await browser.execute(maxEntries => {
        return Array.from(document.querySelectorAll('.timeline-entry'))
            .slice(0, typeof maxEntries === 'number' ? maxEntries : Number.MAX_SAFE_INTEGER)
            .map(entry => ({
                kind: entry.querySelector('.timeline-kind-pill')?.textContent?.trim() ?? '',
                date: entry.querySelector('.timeline-date-pill')?.textContent?.trim() ?? '',
                text: entry.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            }));
    }, limit);
}

/**
 * Timeline view helpers.
 */
import { navigateTo, verifyActiveView } from './navigation.js';
import { setText, setSelect } from './form-controls.js';
import { waitForSelectorDisplayed } from './common.js';

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
    await waitForSelectorDisplayed('#timeline-root', 10000);

    await browser.waitUntil(async () => {
        const root = $('#timeline-root');
        if (await root.getAttribute('aria-busy').catch(() => 'true') === 'true') {
            return false;
        }
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
    await setSelect('#timeline-kind-filter', { text: label });
    await waitForTimelineReady();
}

export async function searchTimeline(query: string): Promise<void> {
    await setText('#timeline-search', query);
    await waitForTimelineReady();
}

export async function getTimelineEntrySnapshots(limit?: number): Promise<TimelineEntrySnapshot[]> {
    return await browser.execute(maxEntries => {
        return Array.from(document.querySelectorAll('.timeline-entry'))
            .slice(0, typeof maxEntries === 'number' ? maxEntries : Number.MAX_SAFE_INTEGER)
            .map(entry => ({
                kind: entry.querySelector('.timeline-kind-pill')?.textContent?.trim() ?? '',
                date: entry.querySelector('.timeline-date-pill')?.textContent?.trim() ?? '',
                text: entry.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '',
            }));
    }, limit);
}

export async function openTimelineMedia(title: string): Promise<void> {
    const link = $(`.timeline-media-link*=${title}`);
    await link.waitForDisplayed({ timeout: 5000 });
    await link.click();
    await waitForSelectorDisplayed('#media-detail-header', 8000);
}

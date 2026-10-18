/**
 * Timeline view helpers.
 */
import { navigateTo, verifyActiveView } from './navigation.js';
import { setText, setSelect } from './form-controls.js';
import { waitForSelectorDisplayed } from './common.js';
import { TIMELINE_ZOOM_LEVELS, type TimelineZoomLevel } from '../../src/timeline/timeline_zoom';

const TIMELINE_ZOOM_LEVEL_STEP_LIMIT = TIMELINE_ZOOM_LEVELS.length - 1;

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

export const TIMELINE_ROW_SELECTOR = '.timeline-entry, .timeline-compact-row, .timeline-bucket-row';

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

        const rowCount = await $$(TIMELINE_ROW_SELECTOR).length;
        const emptyVisible = await $('.timeline-empty').isDisplayed().catch(() => false);
        return rowCount > 0 || emptyVisible;
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
                date: entry.querySelector('[data-timeline-stat="date"] dd')?.textContent?.trim() ?? '',
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

export async function getTimelineZoomLevel(): Promise<TimelineZoomLevel> {
    const className = (await $('#timeline-root').getAttribute('class')) ?? '';
    const match = className.match(/is-zoom-(\S+)/);
    if (!match) {
        throw new Error(`Could not find a zoom level class on #timeline-root (class="${className}")`);
    }
    return match[1] as TimelineZoomLevel;
}

export async function setTimelineZoomLevel(level: TimelineZoomLevel): Promise<void> {
    const targetIndex = TIMELINE_ZOOM_LEVELS.indexOf(level);

    for (let step = 0; step < TIMELINE_ZOOM_LEVEL_STEP_LIMIT; step += 1) {
        const currentLevel = await getTimelineZoomLevel();
        if (currentLevel === level) return;

        const currentIndex = TIMELINE_ZOOM_LEVELS.indexOf(currentLevel);
        const buttonSelector = targetIndex > currentIndex ? '#btn-timeline-zoom-out' : '#btn-timeline-zoom-in';
        await $(buttonSelector).click();
        await waitForTimelineReady();
    }

    const finalLevel = await getTimelineZoomLevel();
    if (finalLevel !== level) {
        throw new Error(
            `Timeline zoom level did not reach "${level}" within ${TIMELINE_ZOOM_LEVEL_STEP_LIMIT} steps (stuck at "${finalLevel}")`,
        );
    }
}

export async function getTimelineRowCount(): Promise<number> {
    return await $$(TIMELINE_ROW_SELECTOR).length;
}

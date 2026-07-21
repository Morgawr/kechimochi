import { waitForAppReady } from '../../helpers/setup.js';
import {
    getTimelineEntrySnapshots,
    openTimeline,
    searchTimeline,
    setTimelineKindFilter,
    openTimelineMedia,
} from '../../helpers/timeline.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia } from '../../helpers/library.js';
import { addMilestone, logActivityFromDetail } from '../../helpers/media-detail.js';

describe('CUJ: Timeline View', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should show recent timeline entries and support status and search filters', async () => {
        await openTimeline();

        const recentEntries = await getTimelineEntrySnapshots(4);
        expect(recentEntries.length).toBeGreaterThanOrEqual(3);
        expect(recentEntries[0].kind).toBe('Milestone');
        expect(recentEntries[0].text).toContain('ペルソナ5');
        expect(recentEntries[0].text).toContain('カモシダ・パレス攻略');
        expect(recentEntries[1].kind).toBe('Milestone');
        expect(recentEntries[1].text).toContain('薬屋のひとりごと');
        expect(recentEntries[1].text).toContain('後宮の謎');
        expect(recentEntries[2].kind).toBe('Completed');
        expect(recentEntries[2].text).toContain('ある魔女が死ぬまで');

        await setTimelineKindFilter('Completed');
        const completedEntries = await getTimelineEntrySnapshots();
        expect(completedEntries.length).toBeGreaterThan(0);
        expect(completedEntries.every(entry => entry.kind === 'Completed')).toBe(true);
        expect(completedEntries.some(entry => entry.text.includes('ある魔女が死ぬまで'))).toBe(true);

        await setTimelineKindFilter('All kinds');

        await searchTimeline('ある魔女が死ぬまで');
        const titleEntries = await getTimelineEntrySnapshots();
        expect(titleEntries.length).toBeGreaterThan(0);
        expect(titleEntries.every(entry => entry.text.includes('ある魔女が死ぬまで'))).toBe(true);

        await searchTimeline('カモシダ・パレス攻略');
        const milestoneEntries = await getTimelineEntrySnapshots();
        expect(milestoneEntries.length).toBeGreaterThan(0);
        expect(milestoneEntries.every(entry => entry.kind === 'Milestone')).toBe(true);
        expect(milestoneEntries.every(entry => entry.text.includes('カモシダ・パレス攻略'))).toBe(true);
    });

    it('should show newly-created events and navigate from an event to media detail', async () => {
        const title = 'Live Timeline Journey';
        await navigateTo('media');
        await addMedia(title, 'Reading', 'Novel');
        await logActivityFromDetail(title, '12', '700', 'Reading');
        await addMilestone('Live milestone', '0', '12', '700', true);

        await openTimeline();
        await setTimelineKindFilter('All kinds');
        await searchTimeline(title);

        const liveEntries = await getTimelineEntrySnapshots();
        expect(liveEntries.some(entry => entry.kind === 'Started' && entry.text.includes(title))).toBe(true);
        expect(liveEntries.some(entry => entry.kind === 'Milestone' && entry.text.includes('Live milestone'))).toBe(true);

        await openTimelineMedia(title);
        expect(await $('#media-title').getText()).toBe(title);
        expect(await $('#media-logs-container').getText()).toContain('12 Minutes');
    });
});

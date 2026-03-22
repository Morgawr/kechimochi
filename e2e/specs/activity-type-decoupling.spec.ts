import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { clickMediaItem } from '../helpers/library.js';
import { addExtraField, logActivityFromDetail, backToGrid } from '../helpers/media-detail.js';

describe('CUJ: Activity Type Decoupling', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should allow logging any activity type on any media, regardless of media type', async () => {
        // 呪術廻戦 is a Reading/Manga media. Log a "Watching" activity on it.
        await navigateTo('media');
        expect(await verifyActiveView('media')).toBe(true);
        await clickMediaItem('呪術廻戦');

        // Log an activity with a different type from the media's default
        await logActivityFromDetail('呪術廻戦', '30', '0', 'Watching');

        // Verify the log appeared in the detail view
        const logsContainer = $('#media-logs-container');
        await logsContainer.waitForDisplayed({ timeout: 5000 });
        const logsText = await logsContainer.getText();
        expect(logsText).toContain('30');
    });

    it('should reflect the dominant activity type verb in stats', async () => {
        // 呪術廻戦 has seed logs tagged as "Reading" (from seed) plus one "Watching" log.
        // The dominant type should still be "Reading" since seed has more entries.
        const statsDiv = $('#media-first-last-stats');
        await statsDiv.waitForDisplayed({ timeout: 5000 });
        const statsText = await statsDiv.getText();

        // "Read" is the verb for Reading, which should be the dominant type
        expect(statsText).toContain('Read');
    });

    it('should not count non-Reading activities toward reading speed estimate', async () => {
        // Use ある魔女が死ぬまで (status: Complete) — for completed reading media, the reading
        // speed badge is computed directly from charCount / readingMinutes without needing a
        // profile report. This makes the test fully self-contained.
        await backToGrid();
        await clickMediaItem('ある魔女が死ぬまで');

        // Add a character count so the reading speed badge appears
        // (seed may have already added this via progress-analysis, so use editExtraField fallback)
        await addExtraField('Character count', '12000');

        // Wait for the reading speed badge to appear (partial text match)
        const speedBadge = $('span*=Est. Reading Speed:');
        await speedBadge.waitForDisplayed({ timeout: 5000 });
        // Read the char/hr value from the nested <strong> element
        const speedStrong = speedBadge.$('strong');
        const speedBefore = await speedStrong.getText();
        expect(speedBefore).toContain('char/hr');

        // Add a large Watching session — should NOT change reading speed since it
        // uses only Reading-tagged logs in the denominator
        await logActivityFromDetail('ある魔女が死ぬまで', '500', '0', 'Watching');

        // Wait for stats to re-render
        await browser.pause(500);

        // Reading speed figure should be unchanged since Watching time is excluded
        const speedAfter = await speedStrong.getText();
        expect(speedAfter).toBe(speedBefore);
    });

    it('should allow adding a Playing activity to a Watching media', async () => {
        // 葬送のフリーレン is Watching/Anime. Log a "Playing" activity.
        await backToGrid();
        await clickMediaItem('葬送のフリーレン');

        await logActivityFromDetail('葬送のフリーレン', '45', '0', 'Playing');

        const logsContainer = $('#media-logs-container');
        await logsContainer.waitForDisplayed({ timeout: 5000 });
        const logsText = await logsContainer.getText();
        expect(logsText).toContain('45');
    });

    it('should use the correct verb when dominant type changes', async () => {
        // Add several more Playing activities to 葬送のフリーレン to make Playing dominant
        await logActivityFromDetail('葬送のフリーレン', '60', '0', 'Playing');
        await logActivityFromDetail('葬送のフリーレン', '60', '0', 'Playing');
        await logActivityFromDetail('葬送のフリーレン', '60', '0', 'Playing');

        // Now Playing (4 logs) should outnumber Watching (3 seed logs)
        const statsDiv = $('#media-first-last-stats');
        await statsDiv.waitForDisplayed({ timeout: 5000 });
        const statsText = await statsDiv.getText();
        expect(statsText).toContain('Played');
    });
});

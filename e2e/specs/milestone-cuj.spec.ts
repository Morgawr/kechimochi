import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import { setDialogMockPath } from '../helpers/common.js';
import { addMilestone, deleteMilestone, clearAllMilestones, getMilestoneListText } from '../helpers/media-detail.js';
import { exportMilestones, importMilestones } from '../helpers/profile.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Milestone CUJ Test', () => {
    let tempExportPath: string;
    const mediaTitle = 'Milestone CUJ Media';

    before(async () => {
        await waitForAppReady();
        const exportBaseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
        tempExportPath = path.join(exportBaseDir, `milestones_export_${Date.now()}.csv`);

        // Setup initial state
        await addMedia(mediaTitle, 'Playing');
    });

    after(() => {
        if (!process.env.SPEC_STAGE_DIR && fs.existsSync(tempExportPath)) {
            fs.unlinkSync(tempExportPath);
        }
    });

    it('should record and display milestones correctly', async () => {
        const milestoneListText = await getMilestoneListText();
        expect(milestoneListText).toContain('No milestones yet.');
        expect(await $('#btn-clear-milestones').isExisting()).toBe(false);

        // Add standard milestone (121m -> 2h1min)
        await addMilestone('First Milestone', '0', '121');

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('First Milestone') && text.includes('2h1min');
        }, { timeout: 10000, timeoutMsg: 'Milestone was not correctly added or formatted' });

        expect(await $('#btn-clear-milestones').isDisplayed()).toBe(true);

        // Add dated milestone
        const selectedDate = await addMilestone('Dated Milestone', '1', '20', true);

        await browser.waitUntil(async () => {
            const items = await $$('.milestone-item');
            return items.length === 2;
        }, { timeout: 10000 });

        const datedItem = await $(`.milestone-item[title="Achieved on ${selectedDate}"]`);
        await datedItem.waitForExist({ timeout: 5000 });
        expect(await datedItem.isExisting()).toBe(true);
    });

    it('should support single and bulk deletion', async () => {
        // Delete the Dated Milestone (index 1)
        await deleteMilestone(1);

        await browser.waitUntil(async () => {
            const items = await $$('.milestone-item');
            return items.length === 1;
        }, { timeout: 10000 });

        const textAfterSingle = await getMilestoneListText();
        expect(textAfterSingle).not.toContain('Dated Milestone');
        expect(textAfterSingle).toContain('First Milestone');

        // Bulk clear
        await clearAllMilestones();

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('No milestones yet.');
        }, { timeout: 10000 });

        expect(await $('#btn-clear-milestones').isExisting()).toBe(false);
    });

    it('should support CSV export and recovery', async () => {
        // Preparation: Add a milestone to export
        await addMilestone('Recovery Milestone', '2', '30');

        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        // Export
        await setDialogMockPath(tempExportPath);
        await exportMilestones();
        expect(fs.existsSync(tempExportPath)).toBe(true);

        // Clear state before import
        await navigateTo('media');
        const gridItem = await $(`.media-grid-item[data-title="${mediaTitle}"]`);
        await gridItem.waitForDisplayed({ timeout: 15000 });
        await gridItem.click();
        await clearAllMilestones();

        // Import
        await navigateTo('profile');
        await setDialogMockPath(tempExportPath);
        await importMilestones();

        // Final verification
        await navigateTo('media');
        await browser.pause(2000);
        const finalGridItem = await $(`.media-grid-item[data-title="${mediaTitle}"]`);
        await finalGridItem.waitForDisplayed({ timeout: 15000 });
        await finalGridItem.click();

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('Recovery Milestone') && text.includes('2h30min');
        }, { timeout: 15000 });
    });
});

import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia, clickMediaItem } from '../helpers/library.js';
import { setDialogMockPath, dismissAlert, closeModal } from '../helpers/common.js';
import { addMilestone, deleteMilestone, clearAllMilestones, getMilestoneListText } from '../helpers/media-detail.js';
import { exportMilestones, importMilestones } from '../helpers/profile.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
        await addMilestone('First Milestone', '0', '121', '0');

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('First Milestone') && text.includes('2h1min');
        }, { timeout: 10000, timeoutMsg: 'Milestone was not correctly added or formatted' });

        expect(await $('#btn-clear-milestones').isDisplayed()).toBe(true);

        // Add dated milestone
        const selectedDate = await addMilestone('Dated Milestone', '1', '20', '0', true);

        await browser.waitUntil(async () => {
            const items = await $$('.milestone-item');
            return (await items.length) === 2;
        }, { timeout: 10000 });

        const datedItem = $(`.milestone-item[title="Achieved on ${selectedDate}"]`);
        await datedItem.waitForExist({ timeout: 5000 });
        expect(await datedItem.isExisting()).toBe(true);

        // Add character-only milestone
        await addMilestone('Char Milestone', '0', '0', '1000');
        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('Char Milestone') && text.includes('1,000 chars');
        }, { timeout: 10000 });

        // Verify validation for 0 duration and 0 characters
        await $('#btn-add-milestone').click();
        await $('#milestone-name').setValue('Invalid Milestone');
        await $('#milestone-hours').setValue('0');
        await $('#milestone-minutes').setValue('0');
        await $('#milestone-characters').setValue('0');
        await $('#milestone-confirm').click();

        await dismissAlert('Please enter either duration or characters.');
        await closeModal('#milestone-cancel');
    });

    it('should support single and bulk deletion', async () => {
        // Delete the Dated Milestone (index 1)
        await deleteMilestone(1);

        await browser.waitUntil(async () => {
            const items = $$('.milestone-item');
            return (await items.length) === 2;
        }, { timeout: 10000 });

        const textAfterSingle = await getMilestoneListText();
        expect(textAfterSingle).not.toContain('Dated Milestone');
        expect(textAfterSingle).toContain('First Milestone');
        expect(textAfterSingle).toContain('Char Milestone');

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
        await addMilestone('Recovery Milestone', '2', '30', '0');

        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        // Export
        await setDialogMockPath(tempExportPath);
        await exportMilestones();
        expect(fs.existsSync(tempExportPath)).toBe(true);

        // Clear state before import
        await navigateTo('media');
        await clickMediaItem(mediaTitle);
        await clearAllMilestones();

        // Import
        await navigateTo('profile');
        await setDialogMockPath(tempExportPath);
        await importMilestones();

        // Final verification
        await navigateTo('media');
        await clickMediaItem(mediaTitle);

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('Recovery Milestone') && text.includes('2h30min');
        }, { timeout: 15000 });
    });
});

import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia, clickMediaItem } from '../helpers/library.js';
import { setDialogMockPath, dismissAlert, closeModal } from '../helpers/common.js';
import { addMilestone, submitInvalidMilestone, deleteMilestoneByName, clearAllMilestones, getMilestoneListText } from '../helpers/media-detail.js';
import { exportMilestones, importMilestones } from '../helpers/profile.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Milestone CUJ Test', () => {
    let tempExportPath: string;
    const mediaTitle = 'Milestone CUJ Media';

    async function openTargetMediaDetail(): Promise<void> {
        await navigateTo('media');
        expect(await verifyActiveView('media')).toBe(true);

        const detailHeader = $('#media-detail-header');
        const detailVisible = await detailHeader.isDisplayed().catch(() => false);

        if (detailVisible) {
            const currentTitle = await $('#media-title').getText().catch(() => '');
            if (currentTitle === mediaTitle) {
                await $('#milestone-list-container').waitForDisplayed({ timeout: 5000 });
                return;
            }

            const backBtn = $('#btn-back-grid');
            if (await backBtn.isDisplayed().catch(() => false)) {
                await backBtn.click();
                await $('#media-grid-container').waitForDisplayed({ timeout: 5000 });
            }
        }

        await clickMediaItem(mediaTitle);
        await browser.waitUntil(async () => {
            return (await $('#media-title').getText().catch(() => '')) === mediaTitle;
        }, {
            timeout: 5000,
            interval: 100,
            timeoutMsg: `Media detail for "${mediaTitle}" did not open in time`
        });
        await $('#milestone-list-container').waitForDisplayed({ timeout: 5000 });
    }

    before(async () => {
        await waitForAppReady();
        const exportBaseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
        tempExportPath = path.join(exportBaseDir, `milestones_export_${Date.now()}.csv`);

        // Setup initial state
        await addMedia(mediaTitle, 'Playing');
    });

    beforeEach(async () => {
        await openTargetMediaDetail();
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
            const firstMilestone = $(`.milestone-item[data-milestone-name="First Milestone"]`);
            if (!(await firstMilestone.isExisting())) return false;
            const text = await firstMilestone.getText();
            return text.includes('2h1min');
        }, { timeout: 5000, interval: 100, timeoutMsg: 'Milestone "First Milestone" did not show expected duration' });

        expect(await $('#btn-clear-milestones').isDisplayed()).toBe(true);

        // Add dated milestone
        const selectedDate = await addMilestone('Dated Milestone', '1', '20', '0', true);

        await browser.waitUntil(async () => {
            const items = $$('.milestone-item');
            return (await items.length) === 2;
        }, { timeout: 5000, timeoutMsg: 'Expected 2 milestones after adding Dated Milestone' });

        const datedItem = $(`.milestone-item[title="Achieved on ${selectedDate}"]`);
        await datedItem.waitForExist({ timeout: 5000 });
        expect(await datedItem.isExisting()).toBe(true);

        // Add character-only milestone
        await addMilestone('Char Milestone', '0', '0', '1000');
        await browser.waitUntil(async () => {
            const charMilestone = $(`.milestone-item[data-milestone-name="Char Milestone"]`);
            if (!(await charMilestone.isExisting())) return false;
            const text = await charMilestone.getText();
            return /1,?000 chars/.test(text);
        }, { timeout: 5000, interval: 100, timeoutMsg: 'Milestone "Char Milestone" did not show expected character count' });

        // Verify validation for 0 duration and 0 characters
        await submitInvalidMilestone('Invalid Milestone', '0', '0', '0');

        await dismissAlert('Please enter either duration or characters.');
        await closeModal('#milestone-cancel');
    });

    it('should support single and bulk deletion', async () => {
        await deleteMilestoneByName('Dated Milestone');

        await browser.waitUntil(async () => {
            // Re-fetch items inside the loop to avoid stale element references
            const items = $$('.milestone-item');
            return (await items.length) === 2;
        }, { timeout: 5000, interval: 100, timeoutMsg: 'Expected 2 milestones after deleting one' });

        const textAfterSingle = await getMilestoneListText();
        expect(textAfterSingle).not.toContain('Dated Milestone');
        expect(textAfterSingle).toContain('First Milestone');
        expect(textAfterSingle).toContain('Char Milestone');

        // Bulk clear
        await clearAllMilestones();

        await browser.waitUntil(async () => {
            const text = await getMilestoneListText();
            return text.includes('No milestones yet.');
        }, { timeout: 3000, interval: 100, timeoutMsg: 'Milestones were not cleared' });

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
        }, { timeout: 15000, interval: 100 });
    });
});

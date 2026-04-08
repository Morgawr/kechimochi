import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { logActivity } from '../helpers/dashboard.js';
import { submitPrompt, dismissAlert, closeModal } from '../helpers/common.js';
import { clickMediaItem } from '../helpers/library.js';
import { backToGrid, getDetailTrackingStatus } from '../helpers/media-detail.js';

describe('CUJ: Log Daily Activity', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should verify that "Final Fantasy 7" does not exist in the media tab initially', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    const gridContainer = $('#media-grid-container');
    const text = await gridContainer.getText();
    expect(text).not.toContain('Final Fantasy 7');
  });

  it('should log a new activity for "Final Fantasy 7" with minutes and characters', async () => {
    await logActivity('Final Fantasy 7', '60', '1000', '2024-03-31');
    await submitPrompt('Playing');

    await $('#add-activity-form').waitForExist({ reverse: true, timeout: 5000 });
    await browser.pause(500);
  });

  it('should log an activity with only characters for "Final Fantasy 7"', async () => {
    await logActivity('Final Fantasy 7', '0', '500', '2024-03-30');
    
    await $('#add-activity-form').waitForExist({ reverse: true, timeout: 5000 });
    await browser.pause(500);
  });

  it('should show an alert when trying to log 0 duration and 0 characters', async () => {
    await logActivity('Final Fantasy 7', '0', '0');
    
    await dismissAlert('Please enter either duration or characters.');
    await closeModal('#activity-cancel');
  });

  it('should verify the new entries in "Recent Activity" on dashboard', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    // Verify 60min/1000chars entry
    const entry1 = $(`.dashboard-activity-item[data-activity-title="Final Fantasy 7"]`);
    await entry1.waitForExist({ timeout: 3000 });
    const text1 = await entry1.getText();
    expect(text1).toContain('60 Minutes');
    expect(text1).toMatch(/1,?000 characters/);

    // Verify 500chars entry (might same title, so we can check if there are 2)
    const entries = await $$(`.dashboard-activity-item[data-activity-title="Final Fantasy 7"]`);
    expect(await entries.length).toBe(2);
    
    // Check the specific 500 characters entry
    const listText = await $('#recent-logs-list').getText();
    expect(listText).toContain('500 characters');
  });

  it('should verify that "Final Fantasy 7" now exists in the media tab', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    const gridContainer = $('#media-grid-container');
    await gridContainer.waitForExist({ timeout: 5000 });
    
    await browser.pause(500);

    const items = $$('.media-grid-item');
    const titleTexts = await items.map(async t => {
        const dataset = await t.getProperty('dataset') as Record<string, string>;
        return dataset.title;
    });
    
    expect(titleTexts).toContain('Final Fantasy 7');

    await clickMediaItem('Final Fantasy 7');
    expect(await getDetailTrackingStatus()).toBe('Ongoing');
    await backToGrid();
  });
});

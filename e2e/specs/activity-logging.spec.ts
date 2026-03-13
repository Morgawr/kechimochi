import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { logActivity } from '../helpers/dashboard.js';
import { submitPrompt } from '../helpers/common.js';

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

  it('should log a new activity for "Final Fantasy 7"', async () => {
    await logActivity('Final Fantasy 7', '60', '2024-03-31');
    await submitPrompt('Playing');

    await $('#add-activity-form').waitForExist({ reverse: true, timeout: 5000 });
    await browser.pause(500);
  });

  it('should verify the new entry in "Recent Activity" on dashboard', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    const recentActivity = $('#recent-logs-list');
    const text = await recentActivity.getText();
    expect(text).toContain('Final Fantasy 7');
    expect(text).toContain('60 minutes');
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
  });
});

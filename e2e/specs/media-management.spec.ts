import { waitForAppReady } from '../helpers/setup.js';
import { verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import { logActivity } from '../helpers/dashboard.js';
import { addExtraField, editExtraField, getExtraField, logActivityFromDetail } from '../helpers/media-detail.js';
import { submitPrompt } from '../helpers/common.js';

describe('Media Management CUJs', () => {
  before(async () => {
    await waitForAppReady();
  });

  describe('CUJ: Add and Manage Media', () => {
    it('should add "Cyberpunk 2077" and verify it in the grid', async () => {
      await addMedia('Cyberpunk 2077', 'Playing');

      // Verify it navigates to detail view automatically
      const detailTitle = await $('#media-title');
      await browser.waitUntil(async () => {
        const text = await detailTitle.getText();
        return text === 'Cyberpunk 2077';
      }, {
        timeout: 5000,
        timeoutMsg: 'Expected media title to be Cyberpunk 2077'
      });
      expect(await detailTitle.getText()).toBe('Cyberpunk 2077');

      // Navigate back to grid to verify it's there
      const backBtn = await $('#btn-back-grid');
      await backBtn.click();

      // Verify it appears in the grid
      const gridItem = await $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
      await gridItem.waitForDisplayed({ timeout: 5000 });
      await gridItem.scrollIntoView();
      expect(await gridItem.isDisplayed()).toBe(true);
    });

    it('should update status in detail view and verify it in the grid', async () => {
      const gridItem = await $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
      await gridItem.waitForDisplayed({ timeout: 5000 });
      await gridItem.click();

      const statusSelect = await $('#media-tracking-status');
      await statusSelect.waitForExist();
      await statusSelect.selectByVisibleText('Ongoing');

      await browser.pause(500);

      const backBtn = await $('#btn-back-grid');
      await backBtn.click();

      const statusLabel = await $(`.media-grid-item[data-title="Cyberpunk 2077"] .status-ongoing`);
      expect(await statusLabel.isExisting()).toBe(true);
    });

    it('should add an extra field and edit it via double-click', async () => {
      // We are already in detail view for Cyberpunk 2077 from previous test
      // but just in case, let's make sure we are there
      const detailTitle = await $('#media-title');
      if (!(await detailTitle.isDisplayed()) || (await detailTitle.getText()) !== 'Cyberpunk 2077') {
        const gridItem = await $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
        await gridItem.waitForDisplayed({ timeout: 5000 });
        await gridItem.click();
      }

      const fieldKey = 'TestField';
      const initialValue = 'InitialValue';
      const updatedValue = 'UpdatedValue';

      await addExtraField(fieldKey, initialValue);
      expect(await getExtraField(fieldKey)).toBe(initialValue);
      await editExtraField(fieldKey, updatedValue);
      expect(await getExtraField(fieldKey)).toBe(updatedValue);
    });

    it('should log an activity from detail view and verify it in the list', async () => {
        // Still in detail view for Cyberpunk 2077
        const duration = '123';
        await logActivityFromDetail('Cyberpunk 2077', duration);

        // Verify it appears in the logs list in detail view
        const logsContainer = await $('#media-logs-container');
        await browser.waitUntil(async () => {
            const text = await logsContainer.getText();
            return text.includes(`${duration} Minutes`);
        }, { timeout: 5000, timeoutMsg: `Expected log with ${duration} minutes to appear in detail view` });
        
        expect(await logsContainer.getText()).toContain(`${duration} Minutes`);
    });
  });


  describe('CUJ: Media Exploration from Dashboard', () => {
    it('should navigate to media detail from dashboard activity link', async () => {
      // First ensure there is at least one activity. We'll add one quickly.
      await logActivity('Cyberpunk 2077', '30');
      await browser.pause(1000);

      // Now find the link on dashboard
      const mediaLink = await $('.dashboard-media-link');
      await mediaLink.waitForDisplayed({ timeout: 5000 });
      await mediaLink.scrollIntoView();
      await mediaLink.waitForClickable({ timeout: 2000 });

      const linkText = await mediaLink.getText();
      expect(linkText).toBe('Cyberpunk 2077');

      await mediaLink.click();

      // Verify it navigated to media detail
      const detailTitleEl = await $('#media-title');
      await detailTitleEl.waitForExist({ timeout: 5000 });

      await browser.waitUntil(async () => {
        const text = await detailTitleEl.getText();
        return text === 'Cyberpunk 2077';
      }, {
        timeout: 5000,
        timeoutMsg: `Expected media title on detail page to be Cyberpunk 2077, but was "${await detailTitleEl.getText()}"`
      });

      expect(await verifyActiveView('media')).toBe(true);
    });
  });
});

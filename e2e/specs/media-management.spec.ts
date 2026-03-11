import { waitForAppReady } from '../helpers/setup.js';
import { verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import { logActivity } from '../helpers/dashboard.js';

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
  });

  describe('CUJ: Media Exploration from Dashboard', () => {
    it('should navigate to media detail from dashboard activity link', async () => {
      // First ensure there is at least one activity. We'll add one quickly.
      await logActivity('Cyberpunk 2077', '30');
      await browser.pause(1000);

      // Now find the link on dashboard
      const mediaLink = await $('.dashboard-media-link');
      await mediaLink.waitForExist();
      const linkText = await mediaLink.getText();
      expect(linkText).toBe('Cyberpunk 2077');
      
      await mediaLink.click();

      // Verify it navigated to media detail
      const detailTitleEl = await $('#media-title');
      await browser.waitUntil(async () => {
          return (await detailTitleEl.getText()) === 'Cyberpunk 2077';
      }, {
          timeout: 5000,
          timeoutMsg: 'Expected media title on detail page to be Cyberpunk 2077'
      });
      
      expect(await verifyActiveView('media')).toBe(true);
    });
  });
});

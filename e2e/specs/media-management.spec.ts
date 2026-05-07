import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import { logActivity } from '../helpers/dashboard.js';
import { addExtraField, editDescription, editExtraField, getExtraField, isDescriptionCollapsed, logActivityFromDetail, editMostRecentLogFromDetail, toggleDescriptionVisibility } from '../helpers/media-detail.js';

describe('Media Management CUJs', () => {
  before(async () => {
    await waitForAppReady();
  });

  describe('CUJ: Add and Manage Media', () => {
    it('should add "Cyberpunk 2077" and verify it in the grid', async () => {
      await addMedia('Cyberpunk 2077', 'Playing');

      // Verify it navigates to detail view automatically
      const detailTitle = $('#media-title');
      await browser.waitUntil(async () => {
        const text = await detailTitle.getText();
        return text === 'Cyberpunk 2077';
      }, {
        timeout: 5000,
        timeoutMsg: 'Expected media title to be Cyberpunk 2077'
      });
      expect(await detailTitle.getText()).toBe('Cyberpunk 2077');

      // Navigate back to grid to verify it's there
      const backBtn = $('#btn-back-grid');
      await backBtn.click();

      // Verify it appears in the grid
      const gridItem = $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
      await gridItem.waitForDisplayed({ timeout: 5000 });
      await gridItem.scrollIntoView();
      expect(await gridItem.isDisplayed()).toBe(true);
    });

    it('should update status in detail view and verify it in the grid', async () => {
      const gridItem = $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
      await gridItem.waitForDisplayed({ timeout: 5000 });
      await gridItem.click();

      const statusSelect = $('#media-tracking-status');
      await statusSelect.waitForExist();
      await statusSelect.selectByVisibleText('Ongoing');

      await browser.pause(500);

      const backBtn = $('#btn-back-grid');
      await backBtn.click();

      const statusLabel = $(`.media-grid-item[data-title="Cyberpunk 2077"] .status-ongoing`);
      expect(await statusLabel.isExisting()).toBe(true);
    });

    it('should add an extra field and edit it via double-click', async () => {
      // We are already in detail view for Cyberpunk 2077 from previous test
      // but just in case, let's make sure we are there
      const detailTitle = $('#media-title');
      if (!(await detailTitle.isDisplayed()) || (await detailTitle.getText()) !== 'Cyberpunk 2077') {
        const gridItem = $(`.media-grid-item[data-title="Cyberpunk 2077"]`);
        await gridItem.waitForDisplayed({ timeout: 5000 });
        await gridItem.click();
        await $('#media-description').waitForDisplayed({ timeout: 10000 });
      }

      const fieldKey = 'TestField';
      const initialValue = 'InitialValue';
      const updatedValue = 'UpdatedValue';

      await addExtraField(fieldKey, initialValue);

      // Verification with retry/wait via helper and explicit check
      expect(await getExtraField(fieldKey)).toBe(initialValue);

      await editExtraField(fieldKey, updatedValue);

      // The helper now waits for the text to appear, but let's be extra safe
      await browser.waitUntil(async () => {
        return (await getExtraField(fieldKey)) === updatedValue;
      }, {
        timeout: 5000,
        timeoutMsg: `Expected extra field "${fieldKey}" to be updated to "${updatedValue}"`
      });

      expect(await getExtraField(fieldKey)).toBe(updatedValue);
    });

    it('should expand and collapse a long description with see more and see less', async () => {
      const longDescription = 'Cyberpunk 2077 is a futuristic RPG about mercs, megacorps, chrome, and messy choices. '.repeat(12);

      await editDescription(longDescription);

      await browser.waitUntil(async () => await isDescriptionCollapsed(), {
        timeout: 5000,
        timeoutMsg: 'Expected long description to start collapsed'
      });

      expect(await isDescriptionCollapsed()).toBe(true);

      await toggleDescriptionVisibility('see more');

      await browser.waitUntil(async () => !(await isDescriptionCollapsed()), {
        timeout: 5000,
        timeoutMsg: 'Expected description to expand after clicking see more'
      });

      expect(await isDescriptionCollapsed()).toBe(false);

      await toggleDescriptionVisibility('see less');

      await browser.waitUntil(async () => await isDescriptionCollapsed(), {
        timeout: 5000,
        timeoutMsg: 'Expected description to collapse again after clicking see less'
      });

      expect(await isDescriptionCollapsed()).toBe(true);
    });

    it('should log an activity from detail view and verify it in the list', async () => {
      // Still in detail view for Cyberpunk 2077
      const duration = '123';
      await logActivityFromDetail('Cyberpunk 2077', duration);

      // Verify it appears in the logs list in detail view - use partial text match for duration
      const logEntry = $('.media-detail-log-item*=123 Minutes');
      await logEntry.waitForExist({ timeout: 5000 });
      
      expect(await logEntry.isDisplayed()).toBe(true);
    });

    it('should edit a log from detail view and verify it updates', async () => {
      // Still in detail view for Cyberpunk 2077
      const newDuration = '150';
      await editMostRecentLogFromDetail(newDuration);

      // Verify it updates in the list
      const updatedEntry = $(`.media-detail-log-item[data-duration-minutes="${newDuration}"]`);
      await updatedEntry.waitForDisplayed({ timeout: 5000 });
      expect(await updatedEntry.isDisplayed()).toBe(true);
    });
  });


  describe('CUJ: Media Exploration from Dashboard', () => {
    it('should navigate to media detail from dashboard activity link', async () => {
      // First ensure there is at least one activity. We'll add one quickly.
      await logActivity('Cyberpunk 2077', '30');

      // Wait for the modal form to disappear before navigating
      await $('#add-activity-form').waitForExist({ reverse: true, timeout: 5000 });

      // Navigate to dashboard to see the activity links
      await navigateTo('dashboard');

      // Now find the link on dashboard
      const mediaLink = $('.dashboard-media-link');
      await mediaLink.waitForDisplayed({ timeout: 5000 });
      await mediaLink.scrollIntoView();
      await mediaLink.waitForClickable({ timeout: 2000 });

      const linkText = await mediaLink.getText();
      expect(linkText).toBe('Cyberpunk 2077');

      await mediaLink.click();

      // Re-query #media-title inside the poll loop — the view transition
      // re-renders the DOM so any reference captured before the click goes stale.
      await browser.waitUntil(async () => {
        const el = $('#media-title');
        if (!(await el.isExisting().catch(() => false))) return false;
        const text = await el.getText().catch(() => '');
        return text === 'Cyberpunk 2077';
      }, {
        timeout: 8000,
        timeoutMsg: 'Expected media title on detail page to be Cyberpunk 2077',
      });

      expect(await verifyActiveView('media')).toBe(true);
    });
  });
});

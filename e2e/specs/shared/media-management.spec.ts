import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { confirmAction, safeClick, waitForSelectorDisplayed } from '../../helpers/common.js';
import { setSelect } from '../../helpers/form-controls.js';
import { addMedia, clickMediaItem, isMediaVisible, getActiveMediaItemSelector } from '../../helpers/library.js';
import { logActivity } from '../../helpers/dashboard.js';
import {
  addExtraField,
  backToGrid,
  editDescription,
  editExtraField,
  editMostRecentLogFromDetail,
  getExtraField,
  isDescriptionCollapsed,
  logActivityFromDetail,
  toggleDescriptionVisibility,
} from '../../helpers/media-detail.js';

describe('Media Management CUJs', () => {
  before(async () => {
    await waitForAppReady();
  });

  describe('CUJ: Add and Manage Media', () => {
    it('should add "Cyberpunk 2077" and verify it in the grid', async () => {
      await addMedia('Cyberpunk 2077', 'Playing');

      const titleSelector = '#media-title';
      await browser.waitUntil(async () => {
        return (await $(titleSelector).getText()) === 'Cyberpunk 2077';
      }, {
        timeout: 5000,
        timeoutMsg: 'Expected media title to be Cyberpunk 2077'
      });
      expect(await $(titleSelector).getText()).toBe('Cyberpunk 2077');

      await backToGrid();

      expect(await isMediaVisible('Cyberpunk 2077')).toBe(true);
    });

    it('should update status in detail view and verify it in the library', async () => {
      await clickMediaItem('Cyberpunk 2077');

      const statusSelect = $('#media-tracking-status');
      await statusSelect.waitForExist();
      await setSelect('#media-tracking-status', { text: 'Ongoing' });

      await backToGrid();

      const statusLabel = $(`${await getActiveMediaItemSelector('Cyberpunk 2077')} .status-ongoing`);
      await statusLabel.waitForExist({ timeout: 5000 });
      expect(await statusLabel.isExisting()).toBe(true);
    });

    it('should add an extra field and edit it via double-click', async () => {
      const detailTitle = $('#media-title');
      if (!(await detailTitle.isDisplayed()) || (await detailTitle.getText()) !== 'Cyberpunk 2077') {
        await clickMediaItem('Cyberpunk 2077');
        await waitForSelectorDisplayed('#media-description', 10000);
      }

      const fieldKey = 'TestField';
      const initialValue = 'InitialValue';
      const updatedValue = 'UpdatedValue';

      await addExtraField(fieldKey, initialValue);

      expect(await getExtraField(fieldKey)).toBe(initialValue);

      await editExtraField(fieldKey, updatedValue);

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
      const duration = '123';
      await logActivityFromDetail('Cyberpunk 2077', duration);

      const logEntry = $('.media-detail-log-item*=123 Minutes');
      await logEntry.waitForExist({ timeout: 5000 });

      expect(await logEntry.isDisplayed()).toBe(true);
    });

    it('should edit a log from detail view and verify it updates', async () => {
      const newDuration = '150';
      await editMostRecentLogFromDetail(newDuration);

      const updatedEntry = $(`.media-detail-log-item[data-duration-minutes="${newDuration}"]`);
      await updatedEntry.waitForDisplayed({ timeout: 5000 });
      expect(await updatedEntry.isDisplayed()).toBe(true);
    });
  });

  describe('CUJ: Media Extra Fields and Metadata Management', () => {
    const targetMediaTitle = '呪術廻戦';
    const extraFieldKey = 'Test Tag';
    const extraFieldValue = 'Value 123';

    it('should navigate to the library and open a media item', async () => {
      await navigateTo('media');
      expect(await verifyActiveView('media')).toBe(true);

      // The preceding CUJ leaves the app in the media detail view. navigateTo is a
      // no-op when the media tab is already active, so explicitly return to the grid.
      if (await $('#media-detail-header').isDisplayed().catch(() => false)) {
        await backToGrid();
      }

      await clickMediaItem(targetMediaTitle);

      const titleSelector = '#media-title';
      await browser.waitUntil(async () => {
        return (await $(titleSelector).getText()) === targetMediaTitle;
      }, { timeout: 5000, timeoutMsg: 'Title did not match expected value' });
    });

    it('should add a new extra field tag with data', async () => {
      await addExtraField(extraFieldKey, extraFieldValue);
      expect(await getExtraField(extraFieldKey)).toBe(extraFieldValue);
    });

    it('should verify the tag persists after navigating away and back', async () => {
      await backToGrid();
      expect(await verifyActiveView('media')).toBe(true);

      await clickMediaItem(targetMediaTitle);

      expect(await getExtraField(extraFieldKey)).toBe(extraFieldValue);
    });

    it('should clear metadata and verify the tag is removed', async () => {
      await safeClick('#btn-clear-meta');

      await confirmAction(true);

      const extraField = $(`.editable-extra[data-key="${extraFieldKey}"]`);
      await extraField.waitForExist({ reverse: true, timeout: 5000 });
      expect(await extraField.isExisting()).toBe(false);
    });
  });

  describe('CUJ: Media Exploration from Dashboard', () => {
    it('should navigate to media detail from dashboard activity link', async () => {
      await logActivity('Cyberpunk 2077', '30');

      await navigateTo('dashboard');

      const mediaLink = $('.dashboard-media-link');
      await mediaLink.waitForDisplayed({ timeout: 5000 });
      await mediaLink.scrollIntoView();
      await mediaLink.waitForClickable({ timeout: 2000 });

      const linkText = await mediaLink.getText();
      expect(linkText).toBe('Cyberpunk 2077');

      await mediaLink.click();

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

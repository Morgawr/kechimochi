import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { submitPrompt, confirmAction, safeClick } from '../helpers/common.js';

describe('CUJ: Media Extra Fields and Metadata Management', () => {
  beforeAll(async () => {
    await waitForAppReady();
  });

  const targetMediaTitle = '呪術廻戦';
  const extraFieldKey = 'Test Tag';
  const extraFieldValue = 'Value 123';

  it('should navigate to the library and open a media item', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    await safeClick(`.media-grid-item[data-title="${targetMediaTitle}"]`);

    const detailTitle = $('#media-title');
    await browser.waitUntil(async () => {
        return (await detailTitle.getText()) === targetMediaTitle;
    }, { timeout: 5000, timeoutMsg: 'Title did not match expected value' });
  });

  it('should add a new extra field tag with data', async () => {
    await safeClick('#btn-add-extra');

    await submitPrompt(extraFieldKey);
    await submitPrompt(extraFieldValue);

    const extraField = $(`//div[@data-ekey="${extraFieldKey}"]`);
    await extraField.waitForExist({ timeout: 5000 });
    const editable = extraField.$('.editable-extra');
    
    await browser.waitUntil(async () => {
        return (await editable.getText()) === extraFieldValue;
    }, { timeout: 5000, timeoutMsg: 'Extra field value did not match after adding' });

    expect(await editable.getText()).toBe(extraFieldValue);
  });

  it('should verify the tag persists after navigating away and back', async () => {
    // Navigate back to grid
    await safeClick('#btn-back-grid');
    expect(await verifyActiveView('media')).toBe(true);

    // Re-open the same item
    await safeClick(`.media-grid-item[data-title="${targetMediaTitle}"]`);

    // Verify tag is still there
    const extraField = $(`//div[@data-ekey="${extraFieldKey}"]`);
    await extraField.waitForExist({ timeout: 5000 });
    const editable = extraField.$('.editable-extra');

    await browser.waitUntil(async () => {
        return (await editable.getText()) === extraFieldValue;
    }, { timeout: 5000, timeoutMsg: 'Extra field value did not persist' });

    expect(await editable.getText()).toBe(extraFieldValue);
  });

  it('should clear metadata and verify the tag is removed', async () => {
    await safeClick('#btn-clear-meta');

    // Handle confirmation modal
    await confirmAction(true);

    // Verify the extra field is gone
    const extraField = $(`//div[@data-ekey="${extraFieldKey}"]`);
    await extraField.waitForExist({ reverse: true, timeout: 5000 });
    expect(await extraField.isExisting()).toBe(false);
  });
});

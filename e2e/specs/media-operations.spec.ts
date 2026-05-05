import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { confirmAction, safeClick } from '../helpers/common.js';
import { addExtraField, backToGrid, getExtraField } from '../helpers/media-detail.js';
import { clickMediaItem } from '../helpers/library.js';

describe('CUJ: Media Extra Fields and Metadata Management', () => {
  before(async () => {
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

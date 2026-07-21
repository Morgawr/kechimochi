import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem, isMediaVisible, setSearchQuery } from '../../helpers/library.js';
import { backToGrid, logActivityFromDetail } from '../../helpers/media-detail.js';
import { logActivity } from '../../helpers/dashboard.js';
import { setText } from '../../helpers/form-controls.js';
import { dismissAlert } from '../../helpers/common.js';

describe('Media Variant CUJ', () => {
  const title = 'Horimiya Variant Test';

  before(async () => {
    await waitForAppReady();
  });

  it('adds and displays an optional variant', async () => {
    await navigateTo('media');
    await addMedia(title, 'Watching', 'Anime', 'TV Series');

    const variant = $('#media-variant');
    await variant.waitForDisplayed({ timeout: 5000 });
    expect(await variant.getText()).toBe('TV Series');
  });

  it('edits and searches by variant in the library', async () => {
    const variant = $('#media-variant');
    await variant.doubleClick();
    await setText('.edit-input', 'Anime Edition');
    await browser.keys('Enter');

    await browser.waitUntil(async () => (await $('#media-variant').getText()) === 'Anime Edition', {
      timeout: 5000,
      timeoutMsg: 'Expected the edited media variant to persist',
    });

    await backToGrid();
    await setSearchQuery('Anime Edition');
    expect(await isMediaVisible(title)).toBe(true);
    await setSearchQuery('');
  });

  it('shows the variant while logging from the dashboard', async () => {
    await clickMediaItem(title);
    await logActivityFromDetail(title, '12', '0', 'Watching');
    await navigateTo('dashboard');

    const recentVariant = $(`.dashboard-activity-item[data-activity-title="${title}"] .dashboard-activity-variant`);
    await recentVariant.waitForDisplayed({ timeout: 5000 });
    expect(await recentVariant.getText()).toBe('Anime Edition');

    const quickLogItem = $(`.quick-log-item[data-quick-log-title="${title}"]`);
    await quickLogItem.waitForDisplayed({ timeout: 5000 });
    const quickLogVariantText = await browser.execute((mediaTitle) => {
      return document.querySelector(`.quick-log-item[data-quick-log-title="${mediaTitle}"] .quick-log-type`)?.textContent || '';
    }, title);
    expect(quickLogVariantText).toContain('Anime Edition');
    await quickLogItem.click();

    const modalVariant = $('#activity-media-variant');
    await modalVariant.waitForDisplayed({ timeout: 5000 });
    expect(await modalVariant.getText()).toBe('Anime Edition');
    await $('#activity-cancel').click();
  });

  it('keeps activity identity isolated across media with the same title', async () => {
    const duplicateTitle = 'Horimiya Duplicate Variant Test';

    await navigateTo('media');
    await addMedia(duplicateTitle, 'Watching', 'Anime', 'Anime');
    await backToGrid();
    await addMedia(duplicateTitle, 'Reading', 'Manga', 'Manga');

    await navigateTo('dashboard');
    await logActivity(duplicateTitle, '7', '0', undefined, 'Watching', undefined, 'Anime');
    await logActivity(duplicateTitle, '13', '0', undefined, 'Reading', undefined, 'Manga');

    const activitySelector = `.dashboard-activity-item[data-activity-title="${duplicateTitle}"]`;
    await browser.waitUntil(async () => (await $$(activitySelector).length) === 2, {
      timeout: 8000,
      timeoutMsg: 'Expected one isolated activity for each same-title media variant',
    });
    const activitySnapshots = await $$(activitySelector).map(async entry => ({
      variant: await entry.$('.dashboard-activity-variant').getText(),
      text: await entry.getText(),
    }));
    expect(activitySnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ variant: 'Anime', text: expect.stringMatching(/7 Minutes[\s\S]*Watching/) }),
      expect.objectContaining({ variant: 'Manga', text: expect.stringMatching(/13 Minutes[\s\S]*Reading/) }),
    ]));

    await navigateTo('media');
    await clickMediaItem(duplicateTitle, 'Anime');
    expect(await $('#media-variant').getText()).toBe('Anime');
    expect(await $$('.media-detail-log-item').length).toBe(1);
    expect(await $('.media-detail-log-item').getAttribute('data-duration-minutes')).toBe('7');

    await $('#media-variant').doubleClick();
    await setText('.edit-input', 'Manga');
    await browser.keys('Enter');
    await dismissAlert('Another media entry already uses');
    expect(await $('#media-variant').getText()).toBe('Anime');
    expect(await $$('.media-detail-log-item').length).toBe(1);

    await backToGrid();
    await clickMediaItem(duplicateTitle, 'Manga');
    expect(await $('#media-variant').getText()).toBe('Manga');
    expect(await $$('.media-detail-log-item').length).toBe(1);
    expect(await $('.media-detail-log-item').getAttribute('data-duration-minutes')).toBe('13');
  });

  it('rejects a title collision when both media have no variant', async () => {
    const sourceTitle = 'Blank Variant Rename Source';
    const targetTitle = 'Blank Variant Rename Target';

    await navigateTo('media');
    await addMedia(sourceTitle, 'Reading', 'Novel');
    await backToGrid();
    await addMedia(targetTitle, 'Reading', 'Novel');
    await backToGrid();
    await clickMediaItem(sourceTitle, '');

    await $('#media-title').doubleClick();
    await setText('.edit-input', targetTitle);
    await browser.keys('Enter');
    await dismissAlert('Another media entry already uses');

    expect(await $('#media-title').getText()).toBe(sourceTitle);
    await backToGrid();
    expect(await $$(`.media-grid-item[data-title="${sourceTitle}"][data-variant=""]`).length).toBe(1);
    expect(await $$(`.media-grid-item[data-title="${targetTitle}"][data-variant=""]`).length).toBe(1);
  });
});

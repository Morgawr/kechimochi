import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem, isMediaVisible, setSearchQuery } from '../../helpers/library.js';
import { backToGrid, logActivityFromDetail } from '../../helpers/media-detail.js';
import { setText } from '../../helpers/form-controls.js';

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
});

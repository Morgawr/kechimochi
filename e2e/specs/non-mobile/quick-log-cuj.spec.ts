import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia } from '../../helpers/library.js';
import { logActivityFromDetail } from '../../helpers/media-detail.js';
import {
  getTopmostVisibleOverlay,
  waitForOverlayToDisappear,
  waitForSelectorDisplayed,
} from '../../helpers/common.js';
import { setText } from '../../helpers/form-controls.js';
import { MOCK_DATE } from '../../config/test-constants.js';

describe('Desktop/Web CUJ: Quick Log', () => {
  const title = 'Quick Log Core Journey';

  before(async () => {
    await waitForAppReady();
  });

  it('logs from a recent-media shortcut and navigates to that media', async () => {
    await navigateTo('media');
    await addMedia(title, 'Watching', 'Anime', 'Blu-ray');
    await logActivityFromDetail(title, '8', '0', 'Watching');
    await navigateTo('dashboard');

    const quickItems = $$('.quick-log-item');
    expect(await quickItems.length).toBe(6);

    const quickItem = $(`.quick-log-item[data-quick-log-title="${title}"]`);
    await quickItem.waitForDisplayed({ timeout: 5000 });
    const quickLogType = await browser.execute((mediaTitle) => {
      return document.querySelector(`.quick-log-item[data-quick-log-title="${mediaTitle}"] .quick-log-type`)?.textContent || '';
    }, title);
    expect(quickLogType).toContain('Anime · Blu-ray');
    await quickItem.click();

    const overlay = await getTopmostVisibleOverlay('#add-activity-form');
    expect(await overlay.$('#activity-media').getValue()).toBe(title);
    const modalVariant = overlay.$('#activity-media-variant');
    await modalVariant.waitForDisplayed({ timeout: 5000 });
    expect(await modalVariant.getText()).toBe('Blu-ray');
    expect(await overlay.$('#activity-type').getValue()).toBe('Watching');
    await setText('#activity-duration', '19');
    await setText('#activity-notes', 'Submitted from Quick Log');
    await overlay.$(`.cal-day[data-date="${MOCK_DATE}"]`).click();
    await overlay.$('#add-activity-form button[type="submit"]').click();
    await waitForOverlayToDisappear(overlay);

    const activitySelector = `.dashboard-activity-item[data-activity-title="${title}"]`;
    await browser.waitUntil(async () => (await $$(activitySelector).length) === 2, {
      timeout: 5000,
      timeoutMsg: 'Quick Log submission did not refresh Recent Activity',
    });
    const entryTexts = await $$(activitySelector).map(entry => entry.getText());
    expect(entryTexts.some(text => text.includes('19 Minutes') && text.includes('of Watching'))).toBe(true);

    const refreshedQuickItem = $(`.quick-log-item[data-quick-log-title="${title}"]`);
    const firstQuickTitle = await browser.execute(() => {
      return document.querySelector('.quick-log-item .quick-log-title')?.textContent || '';
    });
    expect(firstQuickTitle).toBe(title);
    await refreshedQuickItem.$('.quick-log-shortcut-btn').click();
    await waitForSelectorDisplayed('#media-detail-header', 5000);
    expect(await $('#media-title').getText()).toBe(title);
    expect(await $('#media-logs-container').getText()).toContain('Submitted from Quick Log');
  });
});

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { clickMediaItem } from '../../helpers/library.js';
import { confirmAction, waitForSelectorDisplayed } from '../../helpers/common.js';

describe('Media actions during background refresh', () => {
  it('keeps a native button press intact while activity data refreshes', async () => {
    await waitForAppReady();
    await navigateTo('media');
    await clickMediaItem('ペルソナ5');
    await waitForSelectorDisplayed('#btn-media-overflow');

    await browser.execute(() => {
      document.body.dataset.mediaRefreshComplete = 'false';
      window.addEventListener('local-data-changed', () => {
        document.body.dataset.mediaRefreshComplete = 'true';
      }, { once: true });
      document.getElementById('btn-media-overflow')!.addEventListener('pointerdown', () => {
        // Use the same notification as an activity edit. The backend response
        // must finish while the native mouse button is still held down.
        document.getElementById('media-logs-container')!
          .dispatchEvent(new CustomEvent('activity-updated'));
      }, { once: true });
    });

    const pointer = { id: 'media-menu-refresh' };
    try {
      await browser.action('pointer', pointer)
        .move({ origin: await $('#btn-media-overflow') }).down().perform(true);
      await browser.waitUntil(async () => browser.execute(() => (
        document.body.dataset.mediaRefreshComplete === 'true'
      )), { timeout: 10000, timeoutMsg: 'Activity refresh did not finish during the native press' });
    } finally {
      await browser.action('pointer', pointer).up().perform();
      await browser.execute(() => { delete document.body.dataset.mediaRefreshComplete; });
    }

    await waitForSelectorDisplayed('#btn-delete-media-detail');
    await $('#btn-delete-media-detail').click();
    await confirmAction(false);
    await waitForSelectorDisplayed('#media-title');
  });
});

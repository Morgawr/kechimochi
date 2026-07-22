import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem } from '../../helpers/library.js';
import {
  addMilestone,
  backToGrid,
  logActivityFromDetail,
  uploadCoverImage,
} from '../../helpers/media-detail.js';
import { openTimeline, searchTimeline } from '../../helpers/timeline.js';

describe('CUJ: Manual Cover Management', () => {
  const title = 'Manual Cover Journey';
  const fixture = path.join(
    process.env.KECHIMOCHI_DATA_DIR || path.resolve(process.cwd(), 'e2e', 'fixtures'),
    'covers',
    'placeholder.png',
  );

  before(async () => {
    await waitForAppReady();
  });

  async function waitForDecodedImage(selector: string, failureMessage: string): Promise<void> {
    await browser.waitUntil(async () => browser.execute((imageSelector) => {
      const image = document.querySelector<HTMLImageElement>(imageSelector);
      return Boolean(image?.complete && image.naturalWidth > 0);
    }, selector), {
      timeout: 10000,
      timeoutMsg: failureMessage,
    });
  }

  it('uploads and reloads a cover across media, Quick Log, and Timeline', async () => {
    await navigateTo('media');
    await addMedia(title, 'Reading', 'Manga');
    const initialSource = await uploadCoverImage(fixture);
    expect(initialSource).not.toBe('');
    await logActivityFromDetail(title, '16', '900', 'Reading');
    await addMilestone('Covered milestone', '0', '16', '900', true);

    await backToGrid();
    const gridImage = $(`.media-grid-item[data-title="${title}"] img`);
    await gridImage.waitForDisplayed({ timeout: 10000 });

    await navigateTo('dashboard');
    const quickLogCoverSelector = `.quick-log-item[data-quick-log-title="${title}"] img`;
    await waitForDecodedImage(quickLogCoverSelector, 'Quick Log cover did not decode on the dashboard');

    // The app keeps dashboard components mounted while the library is active.
    // Replacing a cover clears the shared object-URL cache, which used to leave
    // Quick Log holding a revoked URL. Exercise the reported resize/maximize
    // navigation path before returning to the retained dashboard.
    await navigateTo('media');
    await clickMediaItem(title);
    await uploadCoverImage(fixture);
    await backToGrid();
    await browser.setWindowSize(900, 800);
    await browser.maximizeWindow();
    await navigateTo('dashboard');
    await waitForDecodedImage(
      quickLogCoverSelector,
      'Quick Log cover became a broken image after resizing the library and returning to the dashboard',
    );

    await openTimeline();
    await searchTimeline(title);
    await $('.timeline-cover-image').waitForDisplayed({ timeout: 10000 });

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('media');
    await clickMediaItem(title);
    await $('#media-cover-img').waitForDisplayed({ timeout: 10000 });
    expect(await $('#media-cover-img').getTagName()).toBe('img');
    expect(await $('#media-cover-img').getAttribute('src')).not.toBe('');
  });
});

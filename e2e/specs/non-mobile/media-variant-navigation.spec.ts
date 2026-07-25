import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import {
  addMedia,
  clickMediaItem,
  setMediaTypeFilters,
} from '../../helpers/library.js';
import { backToGrid } from '../../helpers/media-detail.js';

async function waitForDetailVariant(expectedVariant: string): Promise<void> {
  await browser.waitUntil(async () => browser.execute((variant) => {
    return document.querySelector('#media-variant')?.textContent?.trim() === variant;
  }, expectedVariant), {
    timeout: 5000,
    timeoutMsg: `Expected the ${expectedVariant} variant detail to be visible`,
  });
}

describe('Media Variant Navigation', () => {
  const title = 'Variant Navigation Test';

  before(async () => {
    await waitForAppReady();
  });

  it('links same-title variants even when the library filter hides one', async () => {
    await navigateTo('media');
    await addMedia(title, 'Watching', 'Anime', 'Anime');
    await backToGrid();
    await addMedia(title, 'Reading', 'Manga', 'Manga');
    await backToGrid();

    await setMediaTypeFilters(['Anime']);
    await clickMediaItem(title, 'Anime');

    const variantNavigation = $('.media-variant-navigation');
    await variantNavigation.waitForDisplayed({ timeout: 5000 });
    expect(await variantNavigation.getText()).toContain('Anime');
    expect(await variantNavigation.getText()).toContain('Manga');
    expect(await $('[data-media-variant="Anime"]').getAttribute('aria-current')).toBe('page');

    await $('[data-media-variant="Manga"]').click();
    await waitForDetailVariant('Manga');
    expect(await $('[data-media-variant="Manga"]').getAttribute('aria-current')).toBe('page');

    await $('[data-media-variant="Anime"]').click();
    await waitForDetailVariant('Anime');
  });
});

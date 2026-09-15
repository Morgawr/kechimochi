import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, getActiveLibraryLayout, requireFinePointer } from '../../helpers/library.js';
import { backToGrid } from '../../helpers/media-detail.js';

async function overlayBorderColor(cardSelector: string): Promise<string> {
  return browser.execute((sel) => {
    const overlay = document.querySelector(`${sel as string} .grid-item-overlay`);
    if (!overlay) return '';
    return getComputedStyle(overlay).getPropertyValue('border-top-color');
  }, cardSelector);
}

const TRANSPARENT_BORDER_COLOR = 'rgba(0, 0, 0, 0)';

async function overlayText(cardSelector: string, childSelector: string): Promise<string> {
  return browser.execute((sel, child) => {
    const node = document.querySelector(`${sel as string} .grid-item-overlay ${child as string}`);
    return node?.textContent ?? '';
  }, cardSelector, childSelector);
}

describe('Desktop/Web: Library grid hover overlay', () => {
  const suffix = Date.now();
  const plainTitle = `Hover Overlay Plain ${suffix}`;
  const variantTitle = `Hover Overlay Variant ${suffix}`;

  before(async () => {
    await waitForAppReady();
    await navigateTo('media');
    await requireFinePointer();
    await addMedia(plainTitle, 'Reading', 'Manga');
    await backToGrid();
    await addMedia(variantTitle, 'Reading', 'Manga', 'Deluxe Edition');
    await backToGrid();
  });

  it('should show the title and variant on the card', async () => {
    expect(await getActiveLibraryLayout()).toBe('grid');

    const variantSelector = `.media-grid-item[data-title="${variantTitle}"]`;
    await $(variantSelector).waitForDisplayed({ timeout: 8000 });

    expect(await overlayText(variantSelector, '.grid-item-title')).toBe(variantTitle);
    expect(await overlayText(variantSelector, '.grid-item-variant')).toBe('Deluxe Edition');
  });

  it('should omit the variant line for a media without one', async () => {
    const plainSelector = `.media-grid-item[data-title="${plainTitle}"]`;
    await $(plainSelector).waitForDisplayed({ timeout: 8000 });

    expect(await overlayText(plainSelector, '.grid-item-variant')).toBe('');
  });

  it('should fade the highlight border in on hover and out again', async () => {
    const plainSelector = `.media-grid-item[data-title="${plainTitle}"]`;
    const variantSelector = `.media-grid-item[data-title="${variantTitle}"]`;
    await $(plainSelector).waitForDisplayed({ timeout: 8000 });

    expect(await overlayBorderColor(plainSelector)).toBe(TRANSPARENT_BORDER_COLOR);

    await $(plainSelector).moveTo();
    await browser.waitUntil(async () => (await overlayBorderColor(plainSelector)) !== TRANSPARENT_BORDER_COLOR, {
      timeout: 5000,
      timeoutMsg: 'Hover highlight never faded in',
    });

    await $(variantSelector).moveTo();
    await browser.waitUntil(async () => (await overlayBorderColor(plainSelector)) === TRANSPARENT_BORDER_COLOR, {
      timeout: 5000,
      timeoutMsg: 'Hover highlight never faded out after the pointer left',
    });
  });
});

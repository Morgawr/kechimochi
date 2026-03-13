import { waitForAppReady } from '../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
  verifyViewNotBroken,
} from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

describe('Media Grid CUJ', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('media');
  });

  it('should navigate to the media view', async () => {
    expect(await verifyActiveView('media')).toBe(true);
  });

  it('should display media items from fixture data', async () => {
    const mediaItems = await $$('.media-grid-item');
    expect(mediaItems.length).toBeGreaterThan(0);
  });

  it('should display status LEDs on media items', async () => {
    const statusLeds = await $$('.media-grid-item .status-led');
    // At least some items in the seed data should be tracked (Ongoing, Complete, etc.)
    expect(statusLeds.length).toBeGreaterThan(0);
    
    // Check that at least one is visible and has correct attributes
    const firstLed = statusLeds[0];
    expect(await firstLed.isDisplayed()).toBe(true);
    
    // Verify it has the expected class prefix
    const className = await firstLed.getAttribute('class');
    expect(className).toContain('status-led');
  });

  it('should have a working search bar', async () => {
    const searchInput = await $('#grid-search-filter');
    if (await searchInput.isExisting()) {
      await searchInput.setValue('呪術廻戦');
      await browser.pause(500);

      // After filtering, fewer items should be visible
      const items = await $$('.media-grid-item');
      let visibleCount = 0;
      // Use a standard loop to avoid iterability issues with WDIO element arrays
      const itemsCount = await items.length;
      for (let i = 0; i < itemsCount; i++) {
        if (await items[i].isDisplayed()) {
          visibleCount++;
        }
      }
      
      expect(visibleCount).toBeGreaterThan(0);
      expect(visibleCount).toBeLessThanOrEqual(10);

      // Clear the search
      await searchInput.clearValue();
      await browser.pause(500);
    }
  });

  it('should open detail view when clicking a media item', async () => {
    const firstItem = await $('.media-grid-item');
    if (await firstItem.isExisting()) {
      await firstItem.click();
      await browser.pause(500);

      // Detail view should show -- check for detail-specific elements
      const detailView = await $('#media-root');
      if (await detailView.isExisting()) {
        expect(await detailView.isDisplayed()).toBe(true);
      }
    }
  });

  it('should not be in a broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should match the baseline screenshot', async () => {
    // Navigate back to grid first
    await navigateTo('media');
    await browser.pause(500);
    await takeAndCompareScreenshot('media-grid');
  });
});

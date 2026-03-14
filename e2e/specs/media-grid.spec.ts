import { waitForAppReady } from '../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
  verifyViewNotBroken,
} from '../helpers/navigation.js';
import { 
  setSearchQuery, 
  waitForGridCount, 
  clickMediaItem 
} from '../helpers/library.js';
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
    await waitForGridCount(count => count > 0, { timeoutMsg: 'Media items did not render in time' });
  });

  it('should display status LEDs on media items', async () => {
    await browser.waitUntil(async () => {
      const leds = $$('.media-grid-item .status-led');
      const count = await leds.length;
      return count > 0;
    }, { timeout: 10000, timeoutMsg: 'Status LEDs did not render in time' });

    const statusLeds = $$('.media-grid-item .status-led');
    const firstLed = statusLeds[0];
    expect(await firstLed.isDisplayed()).toBe(true);

    const className = await firstLed.getAttribute('class');
    expect(className).toContain('status-led');
  });

  it('should have a working search bar', async () => {
    // Get initial state
    const items = $$('.media-grid-item');
    const initialCount = await items.length;

    // Search for a specific title from seed.ts
    await setSearchQuery('呪術');
    await waitForGridCount(count => count > 0 && count < initialCount, { 
      timeoutMsg: 'Search filtering did not reduce item count' 
    });

    // Clear search and ensure all items come back
    await setSearchQuery('');
    await waitForGridCount(initialCount, { 
      timeoutMsg: 'Search clearing did not restore items' 
    });
  });

  it('should open detail view when clicking a media item', async () => {
    await clickMediaItem('ある魔女が死ぬまで');

    // Detail view should show -- check for detail-specific elements
    const detailView = $('#media-root');
    await detailView.waitForDisplayed({ timeout: 10000 });
    expect(await detailView.isDisplayed()).toBe(true);
    
    expect(await $('#media-detail-header').isDisplayed()).toBe(true);
  });

  it('should not be in a broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should match the baseline screenshot', async () => {
    await navigateTo('media');
    await browser.pause(500); // Wait for transition
    await takeAndCompareScreenshot('media-grid');
  });
});

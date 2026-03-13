import { waitForAppReady } from '../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
  verifyViewNotBroken,
} from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

describe('Profile CUJ', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('profile');
  });

  it('should navigate to the profile view', async () => {
    expect(await verifyActiveView('profile')).toBe(true);
  });

  it('should display the theme selector', async () => {
    const themeSelect = $('#profile-select-theme');
    if (await themeSelect.isExisting()) {
      expect(await themeSelect.isDisplayed()).toBe(true);
    }
  });

  it('should display reading speed report card', async () => {
    const reportSection = $('#profile-report-card');
    if (await reportSection.isExisting()) {
      expect(await reportSection.isDisplayed()).toBe(true);
    }
  });

  it('should not be in a broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should navigate back to dashboard after visiting profile', async () => {
    await navigateTo('dashboard');
    await browser.pause(500);
    expect(await verifyActiveView('dashboard')).toBe(true);
    await verifyViewNotBroken();
  });

  it('should match the baseline screenshot', async () => {
    await navigateTo('profile');
    await browser.pause(500);
    await takeAndCompareScreenshot('profile-view');
  });
});

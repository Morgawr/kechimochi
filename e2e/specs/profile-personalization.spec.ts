import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

describe('CUJ: User Personalization', () => {
  beforeAll(async () => {
    await waitForAppReady();
  });

  it('should change the theme to Molokai and verify visually', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const themeSelect = await $('#profile-select-theme');
    await themeSelect.waitForDisplayed({ timeout: 5000 });

    // WebView can be flaky with selectByAttribute; force value + change event.
    await browser.execute((el) => {
      const select = el as HTMLSelectElement;
      select.value = 'molokai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, themeSelect);

    await browser.waitUntil(async () => {
      const body = await $('body');
      return (await body.getAttribute('data-theme')) === 'molokai';
    }, {
      timeout: 5000,
      timeoutMsg: 'Theme did not update to molokai on body[data-theme]'
    });

    await takeAndCompareScreenshot('profile-molokai-theme');
  });
});

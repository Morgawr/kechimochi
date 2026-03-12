import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

describe('CUJ: User Personalization', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should change the theme to Molokai and verify visually', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const themeSelect = await $('#profile-select-theme');
    await themeSelect.selectByAttribute('value', 'molokai');

    const body = await $('body');
    expect((await body.getProperty('dataset') as Record<string, string>).theme).toBe('molokai');

    await takeAndCompareScreenshot('profile-molokai-theme');
  });
});

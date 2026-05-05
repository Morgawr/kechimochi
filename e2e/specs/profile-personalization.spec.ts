import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

async function waitForAnimationFrame(): Promise<void> {
  await browser.executeAsync((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
  });
}

async function waitForVisualIdle(): Promise<void> {
  await browser.executeAsync((done) => {
    let didFinish = false;
    const finish = () => {
      if (didFinish) return;
      didFinish = true;
      done(true);
    };

    const animations = document.getAnimations
      ? document.getAnimations().filter(animation => animation.playState !== 'finished')
      : [];

    if (animations.length === 0) {
      finish();
      return;
    }

    Promise.allSettled(animations.map(animation => animation.finished)).then(finish, finish);
    setTimeout(finish, 1000);
  });

  await waitForAnimationFrame();
}

async function waitForMolokaiThemeApplied(): Promise<void> {
  await browser.waitUntil(async () => {
    return await browser.execute(() => {
      const select = document.getElementById('profile-select-theme') as HTMLSelectElement | null;
      const styles = getComputedStyle(document.body);

      return document.body.dataset.theme === 'molokai'
        && select?.value === 'molokai'
        && styles.getPropertyValue('--bg-dark').trim().toLowerCase() === '#1b1d1e'
        && styles.getPropertyValue('--accent-green').trim().toLowerCase() === '#a6e22e';
    });
  }, {
    timeout: 5000,
    timeoutMsg: 'Theme UI did not fully settle to molokai'
  });

  await waitForVisualIdle();
}

describe('CUJ: User Personalization', () => {
  before(async () => {
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

    await waitForMolokaiThemeApplied();

    await takeAndCompareScreenshot('profile-molokai-theme');
  });
});

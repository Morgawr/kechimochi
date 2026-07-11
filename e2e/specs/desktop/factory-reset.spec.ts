import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { submitPrompt, waitForSelectorDisplayed } from '../../helpers/common.js';
import { setText } from '../../helpers/form-controls.js';
import { TEST_PROFILE_NAME } from '../../config/test-constants.js';
describe('Factory Reset CUJ', () => {
  before(async () => {
    // We set the profile in localStorage and THEN refresh to ensure the app picks it up
    await browser.execute((profileName: string) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('kechimochi_profile', profileName);
    }, TEST_PROFILE_NAME);
    await browser.refresh();
    await waitForAppReady();
  });

  it(`should launch app, navigate to profile, and verify current profile is ${TEST_PROFILE_NAME}`, async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileNameEl = $('#profile-name');
    await browser.waitUntil(async () => {
      return (await profileNameEl.getText()) === TEST_PROFILE_NAME;
    }, { timeout: 5000, timeoutMsg: `Profile name did not match ${TEST_PROFILE_NAME}` });
    expect(await profileNameEl.getText()).toBe(TEST_PROFILE_NAME);
  });

  it('should perform factory reset and wipe all data', async () => {
    const wipeBtn = $('#profile-btn-wipe-everything');
    await wipeBtn.scrollIntoView();
    await wipeBtn.click();

    await submitPrompt('WIPE_EVERYTHING');
    await waitForSelectorDisplayed('#initial-prompt-input', 30000);
  });

  it('should prompt for a new user name and create BESTUSER', async () => {
    await waitForSelectorDisplayed('#initial-prompt-input', 10000);
    await setText('#initial-prompt-input', 'BESTUSER');

    const startBtn = $('#initial-prompt-confirm');
    await startBtn.waitForClickable({ timeout: 5000 });
    await startBtn.click();

    // App may briefly re-render; wait until profile is switched and dashboard is active.
    await browser.waitUntil(async () => {
      return browser.execute(() => {
        const active = document.querySelector('[data-view="dashboard"]')?.classList.contains('active') ?? false;
        const dashboardReady = document.querySelector('.dashboard-root') !== null;
        const headerProfile = document.querySelector('#nav-user-name')?.textContent?.trim() ?? '';
        return active && dashboardReady && headerProfile === 'BESTUSER';
      });
    }, {
      timeout: 30000,
      timeoutMsg: 'Dashboard did not become active with BESTUSER after initial profile creation'
    });
    expect(await verifyActiveView('dashboard')).toBe(true);
  });

  it('should verify dashboard is empty', async () => {
    await navigateTo('dashboard');

    const emptyState = $('p=No activity logged yet.');
    expect(await emptyState.isDisplayed()).toBe(true);

    const bodyText = await $('body').getText();
    expect(bodyText).not.toContain(TEST_PROFILE_NAME);
  });

  it('should verify library page is empty', async () => {
    await navigateTo('media');

    expect(await $$('.media-grid-item').length).toBe(0);
  });

  it('should verify profile name is BESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileNameEl = $('#profile-name');
    await browser.waitUntil(async () => {
      return (await profileNameEl.getText()) === 'BESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Profile name did not match BESTUSER after reset' });
    expect(await profileNameEl.getText()).toBe('BESTUSER');

    const bodyText = await $('body').getText();
    expect(bodyText).not.toContain(TEST_PROFILE_NAME);
  });
});

import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
describe('Factory Reset CUJ', () => {
  before(async () => {
    // We set the profile in localStorage and THEN refresh to ensure the app picks it up
    await browser.execute(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('kechimochi_profile', 'TESTUSER');
    });
    await browser.refresh();
    await waitForAppReady();
  });

  it('should launch app, navigate to profile, and verify current profile is TESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileNameEl = $('#profile-name');
    await browser.waitUntil(async () => {
      return (await profileNameEl.getText()) === 'TESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Profile name did not match TESTUSER' });
    expect(await profileNameEl.getText()).toBe('TESTUSER');
  });

  it('should perform factory reset and wipe all data', async () => {
    const wipeBtn = $('#profile-btn-wipe-everything');
    await wipeBtn.scrollIntoView();
    await wipeBtn.click();

    const promptInput = $('#prompt-input');
    await promptInput.waitForDisplayed({ timeout: 5000 });
    await promptInput.waitForClickable({ timeout: 2000 });
    await promptInput.click();
    await promptInput.setValue('WIPE_EVERYTHING');

    const confirmBtn = $('#prompt-confirm');
    await confirmBtn.waitForClickable({ timeout: 2000 });
    await confirmBtn.click();

    const initialInput = $('#initial-prompt-input');
    await initialInput.waitForDisplayed({ timeout: 10000 });
  });

  it('should prompt for a new user name and create BESTUSER', async () => {
    const initialInput = await $('#initial-prompt-input');
    await initialInput.waitForDisplayed({ timeout: 10000 });
    await initialInput.setValue('BESTUSER');

    const startBtn = await $('#initial-prompt-confirm');
    await startBtn.waitForClickable({ timeout: 5000 });
    await startBtn.click();

    // App may briefly re-render; wait until profile is switched and dashboard is active.
    await browser.waitUntil(async () => {
      const active = await verifyActiveView('dashboard');
      const currentProfile = await browser.execute(() => localStorage.getItem('kechimochi_profile'));
      return active && currentProfile === 'BESTUSER';
    }, {
      timeout: 10000,
      timeoutMsg: 'Dashboard did not become active with BESTUSER after initial profile creation'
    });
    expect(await verifyActiveView('dashboard')).toBe(true);
  });

  it('should verify dashboard is empty', async () => {
    await navigateTo('dashboard');

    const emptyState = $('p=No activity logged yet.');
    expect(await emptyState.isDisplayed()).toBe(true);

    const bodyText = await $('body').getText();
    expect(bodyText).not.toContain('TESTUSER');
  });

  it('should verify library page is empty', async () => {
    await navigateTo('media');

    const mediaItems = await $$('.media-grid-item');
    expect(await mediaItems.length).toBe(0);
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
    expect(bodyText).not.toContain('TESTUSER');
  });
});

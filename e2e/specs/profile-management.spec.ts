import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { submitPrompt, confirmAction } from '../helpers/common.js';

describe('Profile Management CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should verify the initial profile is TESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('#profile-name');
    await browser.waitUntil(async () => {
        return (await profileHeading.getText()) === 'TESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Initial profile was not TESTUSER' });
    expect(await profileHeading.getText()).toBe('TESTUSER');
  });

  it('should navigate back to dashboard', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);
  });

  it('should add a new profile named BESTUSER', async () => {
    const addProfileBtn = await $('#btn-add-profile');
    await addProfileBtn.click();
    
    await submitPrompt('BESTUSER');

    const profileSelect = await $('#select-profile');
    await browser.waitUntil(async () => {
      const selectedProfile = await profileSelect.getValue();
      const storedProfile = await browser.execute(() => localStorage.getItem('kechimochi_profile'));
      return selectedProfile === 'BESTUSER' && storedProfile === 'BESTUSER';
    }, {
      timeout: 10000,
      timeoutMsg: 'Profile selector/storage did not switch to BESTUSER'
    });
  });

  it('should verify the new profile name in the profile tab', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('#profile-name');
    await browser.waitUntil(async () => {
        return (await profileHeading.getText()) === 'BESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Profile did not switch to BESTUSER' });
    expect(await profileHeading.getText()).toBe('BESTUSER');
  });

  it('should verify that TESTUSER is no longer displayed in the profile view', async () => {
    const container = await $('#view-container');
    await browser.waitUntil(async () => {
      const containerText = await container.getText();
      return !containerText.includes('TESTUSER');
    }, {
      timeout: 5000,
      timeoutMsg: 'Profile view still displayed TESTUSER after switching to BESTUSER'
    });

    const containerText = await container.getText();
    expect(containerText).not.toContain('TESTUSER');
  });

  it('should delete the current profile (BESTUSER)', async () => {
    const deleteProfileBtn = await $('#btn-delete-profile');
    await deleteProfileBtn.click();
    
    await confirmAction(true);
    
    await browser.pause(2000);
    await waitForAppReady();
  });

  it('should verify that the current profile is back to TESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('#profile-name');
    await browser.waitUntil(async () => {
        return (await profileHeading.getText()) === 'TESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Profile did not return to TESTUSER' });
    expect(await profileHeading.getText()).toBe('TESTUSER');
  });
});

import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { openProfileNameEditor, renameProfile } from '../helpers/profile.js';

describe('Single-User Profile Renaming CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should verify the initial profile is TESTUSER in the header', async () => {
    const headerName = await $('#nav-user-name');
    await browser.waitUntil(async () => {
      return (await headerName.getText()) === 'TESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Header profile name was not TESTUSER' });
    expect(await headerName.getText()).toBe('TESTUSER');
  });

  it('should verify the initial profile is TESTUSER in the profile tab', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileHeading = await $('#profile-name');
    await browser.waitUntil(async () => {
      return (await profileHeading.getText()) === 'TESTUSER';
    }, { timeout: 5000, timeoutMsg: 'Initial profile was not TESTUSER' });
    expect(await profileHeading.getText()).toBe('TESTUSER');
  });

  it('should rename the user profile by double-clicking the profile name', async () => {
    const profileHeading = await $('#profile-name');
    await profileHeading.waitForDisplayed({ timeout: 5000 });

    const input = await openProfileNameEditor();
    expect(await input.isDisplayed()).toBe(true);
    expect(await input.getValue()).toBe('TESTUSER');

    await renameProfile('RENAMED_PRO');

    const finalHeading = await $('#profile-name');
    expect(await finalHeading.getText()).toBe('RENAMED_PRO');
  });

  it('should verify the header reflects the new name after renaming', async () => {
    const headerName = await $('#nav-user-name');
    await browser.waitUntil(async () => {
      return (await headerName.getText()) === 'RENAMED_PRO';
    }, { timeout: 5000, timeoutMsg: 'Header did not update to RENAMED_PRO' });
    expect(await headerName.getText()).toBe('RENAMED_PRO');
  });

});

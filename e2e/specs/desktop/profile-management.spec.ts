import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { openProfileNameEditor, renameProfile, uploadProfilePicture } from '../../helpers/profile.js';
import { TEST_PROFILE_NAME } from '../../config/test-constants.js';


describe('Single-User Profile Renaming CUJ', () => {
  // Use the isolated data directory that is also accessible by the Tauri process.
  // prepareTestDir() already copies e2e/fixtures/covers/ there, so the file
  // always exists at a path both wdio (Node) and Tauri (Rust) can reach.
  const profilePictureFixture = path.join(
    process.env.KECHIMOCHI_DATA_DIR ?? path.resolve(process.cwd(), 'e2e', 'fixtures'),
    'covers',
    'profile_placeholder.png',
  );

  // The avatar fallback shows the profile name's first two letters, uppercased.
  const profileInitials = TEST_PROFILE_NAME.slice(0, 2).toUpperCase();

  before(async () => {
    await waitForAppReady();
  });

  it(`should verify the initial profile is ${TEST_PROFILE_NAME} in the header`, async () => {
    const nameHeader = $('#nav-user-name');
    await browser.waitUntil(async () => {
      const text = await nameHeader.getText();
      return text === TEST_PROFILE_NAME;
    }, { timeout: 5000, timeoutMsg: `Header profile name was not ${TEST_PROFILE_NAME}` });
    expect(await nameHeader.getText()).toBe(TEST_PROFILE_NAME);
  });

  it(`should show ${profileInitials} as the initial missing profile picture fallback in the header`, async () => {
    const headerFallback = $('#nav-user-avatar-fallback');
    await headerFallback.waitForDisplayed({ timeout: 5000 });
    expect(await headerFallback.getText()).toBe(profileInitials);
  });

  it(`should verify the initial profile is ${TEST_PROFILE_NAME} in the profile tab`, async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileHeading = $('#profile-name');
    await browser.waitUntil(async () => {
      return (await profileHeading.getText()) === TEST_PROFILE_NAME;
    }, { timeout: 5000, timeoutMsg: `Initial profile was not ${TEST_PROFILE_NAME}` });
    expect(await profileHeading.getText()).toBe(TEST_PROFILE_NAME);
  });

  it(`should show ${profileInitials} as the missing profile picture fallback in the profile view`, async () => {
    const heroFallback = $('#profile-hero-avatar .profile-avatar-fallback');
    await heroFallback.waitForDisplayed({ timeout: 5000 });
    expect(await heroFallback.getText()).toBe(profileInitials);
  });

  it('should upload a profile picture and show it in both the header and profile view', async () => {
    await uploadProfilePicture(profilePictureFixture);

    const heroImg = $('#profile-hero-avatar img');
    const navImg = $('#nav-user-avatar-image');
    const navFallback = $('#nav-user-avatar-fallback'); // Re-added for the check below

    await heroImg.waitForDisplayed({ timeout: 5000 });
    await navImg.waitForDisplayed({ timeout: 5000 });

    // Header should show data URL
    await browser.waitUntil(async () => {
      const src = await navImg.getAttribute('src');
      return (src ?? '').startsWith('data:image/');
    }, { timeout: 10000, timeoutMsg: 'Header avatar did not show data URL' });

    // Hero should show data URL
    await browser.waitUntil(async () => {
      const src = await heroImg.getAttribute('src');
      return (src ?? '').startsWith('data:image/');
    }, { timeout: 5000, timeoutMsg: 'Profile view avatar did not show data URL' });

    expect(await heroImg.isDisplayed()).toBe(true);
    expect(await navImg.isDisplayed()).toBe(true);
    expect(await navFallback.isDisplayed().catch(() => false)).toBe(false);
  });

  it('should rename the user profile by double-clicking the profile name', async () => {
    if (!(await verifyActiveView('profile'))) {
      await navigateTo('profile');
    }
    expect(await verifyActiveView('profile')).toBe(true);

    const profileHeading = $('#profile-name');
    await profileHeading.waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(async () => {
      return (await profileHeading.getText()) === TEST_PROFILE_NAME;
    }, { timeout: 10000, timeoutMsg: 'Profile heading did not stabilize before renaming' });

    const input = await openProfileNameEditor();
    expect(await input.isDisplayed()).toBe(true);
    expect(await input.getValue()).toBe(TEST_PROFILE_NAME);

    await renameProfile('RENAMED_PRO');

    const finalHeading = $('#profile-name');
    expect(await finalHeading.getText()).toBe('RENAMED_PRO');
  });

  it('should verify the header reflects the new name after renaming', async () => {
    const headerName = $('#nav-user-name');
    await browser.waitUntil(async () => {
      return (await headerName.getText()) === 'RENAMED_PRO';
    }, { timeout: 10000, timeoutMsg: 'Header did not update to RENAMED_PRO' });
    expect(await headerName.getText()).toBe('RENAMED_PRO');
  });

});

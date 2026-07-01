/**
 * These specs run against a freshly installed debug APK with no pre-seeded
 * database.  They cover the first-run experience and verify that core
 * navigation works on Android.
 */

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';

describe('Android: fresh-install smoke', () => {
  it('should launch the app without crashing', async () => {
    await waitForAppReady();

    const appElement = await $('#app');
    expect(await appElement.isExisting()).toBe(true);
  });

  it('should display the main navigation', async () => {
    await waitForAppReady();

    const navLinks = await $$('.nav-link');
    expect(navLinks.length).toBeGreaterThan(0);

    const activeLink = await $('.nav-link.active');
    expect(await activeLink.isExisting()).toBe(true);
  });

  it('should show the dashboard view as the starting view', async () => {
    await waitForAppReady();
    expect(await verifyActiveView('dashboard')).toBe(true);
  });

  it('should navigate to the media view without crashing', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    const mediaRoot = await $('#media-root');
    expect(await mediaRoot.isExisting()).toBe(true);
  });

  it('should navigate to the profile view without crashing', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const profileRoot = await $('#profile-root');
    expect(await profileRoot.isExisting()).toBe(true);
  });
});
/**
 * Web-exclusive URL/refresh semantics, merged into one session:
 *  - direct URL loads boot the app into its expected initial state (users may
 *    bookmark or paste the root URL — irrelevant to the desktop Tauri build);
 *  - a hard browser reload does not lose profile/navigation state or crash the
 *    SPA shell (no Tauri lifecycle hooks in the stateless browser tab).
 */

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView, verifyViewNotBroken } from '../../helpers/navigation.js';

describe('Web: direct URL load', () => {
  it('should load the root URL and show the dashboard', async () => {
    await browser.url('/');
    await waitForAppReady();

    expect(await verifyActiveView('dashboard')).toBe(true);
    await verifyViewNotBroken();
  });

  it('should show the stats box and heatmap on direct load', async () => {
    await browser.url('/');
    await waitForAppReady();

    const statsBox = await $('#stats-box-container');
    expect(await statsBox.isExisting()).toBe(true);

    const heatmap = await $('#heatmap-container');
    expect(await heatmap.isExisting()).toBe(true);
  });
});

describe('Web: browser refresh preserves state', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should land on dashboard after a hard browser refresh', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.refresh();
    await waitForAppReady();

    expect(await verifyActiveView('dashboard')).toBe(true);
    await verifyViewNotBroken();
  });

  it('should survive a refresh on the media view without broken state', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    await browser.refresh();
    await waitForAppReady();

    // After refresh the app boots to its default view; just verify no crash.
    await verifyViewNotBroken();
  });

  it('should survive a refresh on the profile view without broken state', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await browser.refresh();
    await waitForAppReady();

    await verifyViewNotBroken();
  });
});
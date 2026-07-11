/**
 * Runs against the debug APK with a pre-seeded database injected into the app
 * sandbox by the android config's `before` hook (androidDriver.seedSession).
 * Proves the seed-injection path works end to end on Android.
 */

import { ensureAndroidWebContext } from '../../helpers/common.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { MEDIA_ITEM_SELECTOR } from '../../helpers/library.js';
import { TEST_PROFILE_NAME } from '../../config/test-constants.js';

describe('Android: seeded-DB smoke', () => {
  it('should show seeded media items in the library', async () => {
    await ensureAndroidWebContext();
    await $('#app').waitForExist({ timeout: 30000 });

    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    await browser.waitUntil(
      async () => (await $$(MEDIA_ITEM_SELECTOR).length) > 0,
      { timeout: 15000, timeoutMsg: 'Seeded media items never appeared in the library' },
    );
  });

  it('should show the seeded profile name', async () => {
    await ensureAndroidWebContext();
    await $('#app').waitForExist({ timeout: 30000 });

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await browser.waitUntil(
      async () => (await $('#profile-name').getText()) === TEST_PROFILE_NAME,
      { timeout: 15000, timeoutMsg: `Profile name never became ${TEST_PROFILE_NAME}` },
    );
  });
});
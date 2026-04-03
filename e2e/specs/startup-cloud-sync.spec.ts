import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { isMediaVisible } from '../helpers/library.js';
import { completeFirstRunSyncImport, openCloudSyncCard, waitForSyncCardText } from '../helpers/sync.js';
import { readRemoteProfile, seedRemoteSyncProfile, waitForRemoteProfileCount } from '../helpers/sync-mock.js';

const REMOTE_PROFILE_NAME = 'REMOTEUSER';
const REMOTE_MEDIA_TITLE = 'Remote First Sync Title';
const REMOTE_DESCRIPTION = 'Imported from the fake Google Drive startup sync flow.';

describe('CUJ: Startup Cloud Sync', () => {
  let remoteProfileId = '';

  before(async () => {
    remoteProfileId = seedRemoteSyncProfile({
      profileName: REMOTE_PROFILE_NAME,
      media: [{
        title: REMOTE_MEDIA_TITLE,
        description: REMOTE_DESCRIPTION,
        mediaType: 'Reading',
        contentType: 'Novel',
      }],
      theme: 'molokai',
    });

    await waitForRemoteProfileCount(1);
    await waitForAppReady(30_000, { seedLocalProfile: false });
  });

  it('should import an existing remote profile from the first-run onboarding flow', async () => {
    const initialPrompt = $('#initial-prompt-input');
    await initialPrompt.waitForDisplayed({ timeout: 10_000 });
    expect(await $('#initial-prompt-sync').isDisplayed()).toBe(true);

    await completeFirstRunSyncImport(REMOTE_PROFILE_NAME);

    expect(await verifyActiveView('dashboard')).toBe(true);
    expect(readRemoteProfile(remoteProfileId).snapshot.profile.profile_name).toBe(REMOTE_PROFILE_NAME);

    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);
    await browser.waitUntil(async () => await isMediaVisible(REMOTE_MEDIA_TITLE), {
      timeout: 15_000,
      timeoutMsg: `Remote media "${REMOTE_MEDIA_TITLE}" was not imported during first-run sync`,
    });

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    await browser.waitUntil(async () => (await $('#profile-name').getText()) === REMOTE_PROFILE_NAME, {
      timeout: 10_000,
      timeoutMsg: `Profile heading did not become ${REMOTE_PROFILE_NAME}`,
    });

    await openCloudSyncCard();
    await waitForSyncCardText('Connected');
    await waitForSyncCardText('Sync profile');
    await waitForSyncCardText(REMOTE_PROFILE_NAME);
    await browser.waitUntil(async () => (await $('body').getAttribute('data-theme')) === 'molokai', {
      timeout: 10_000,
      timeoutMsg: 'Remote theme did not apply after first-run sync import',
    });
  });
});

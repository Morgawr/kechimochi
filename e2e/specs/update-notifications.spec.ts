import { E2E_PACKAGE_VERSION, waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import {
  clearMockUpstreamRelease,
  closeUpdateModal,
  expectAvailableUpdateModal,
  expectInstalledUpdateModal,
  mockUpstreamRelease,
  triggerManualUpdateCheck,
  waitForUpdateBanner,
} from '../helpers/update.js';

describe('CUJ: Update Notifications', () => {
  const currentVersion = E2E_PACKAGE_VERSION;
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  const nextVersion = `${major}.${minor}.${patch + 1}`;

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await clearMockUpstreamRelease();
  });

  it('should show the installed-update modal, detect a newer upstream release, and support manual update checks', async () => {
    await expectInstalledUpdateModal(currentVersion);

    await mockUpstreamRelease({
      version: nextVersion,
      body: [
        `## [${nextVersion}] - 2026-03-25`,
        '',
        '### Added',
        '- A newer release is available for download.',
      ].join('\n'),
    });

    await closeUpdateModal();
    await waitForUpdateBanner(nextVersion);

    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await triggerManualUpdateCheck();
    await expectAvailableUpdateModal(currentVersion, nextVersion);
    await closeUpdateModal();
  });
});

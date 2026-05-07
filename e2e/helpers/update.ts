/// <reference types="@wdio/globals/types" />
import {
  clickTopmostOverlayChild,
  safeClick,
  waitForNoActiveOverlays,
  waitForTopmostOverlayText,
} from './common.js';

interface MockReleaseOptions {
  version: string;
  body: string;
  url?: string;
}

const GITHUB_RELEASES_KEY = 'api.github.com/repos/Morgawr/kechimochi/releases';

export async function mockUpstreamRelease(options: MockReleaseOptions): Promise<void> {
  await browser.execute((payload) => {
    const gt = globalThis as unknown as { mockExternalJSON?: Record<string, unknown> };
    gt.mockExternalJSON ??= {};
    gt.mockExternalJSON['api.github.com/repos/Morgawr/kechimochi/releases'] = [
      {
        tag_name: `v${payload.version}`,
        prerelease: false,
        draft: false,
        body: payload.body,
        html_url: payload.url ?? 'https://github.com/Morgawr/kechimochi/releases',
        published_at: '2026-03-25T00:00:00Z',
      },
    ];
  }, options);
}

export async function clearMockUpstreamRelease(): Promise<void> {
  await browser.execute((key) => {
    const gt = globalThis as unknown as { mockExternalJSON?: Record<string, unknown> };
    if (!gt.mockExternalJSON) return;
    delete gt.mockExternalJSON[key];
    if (Object.keys(gt.mockExternalJSON).length === 0) {
      delete gt.mockExternalJSON;
    }
  }, GITHUB_RELEASES_KEY);
}

export async function expectInstalledUpdateModal(version: string): Promise<void> {
  await waitForTopmostOverlayText('#update-modal-close', `updated to ${version}`, 30000);
  await waitForTopmostOverlayText('#update-modal-close', 'latest changelog', 30000);
}

export async function closeUpdateModal(): Promise<void> {
  await clickTopmostOverlayChild('#update-modal-close');
  await waitForNoActiveOverlays(5000);
}

export async function waitForUpdateBanner(version: string): Promise<void> {
  const banner = $('#update-available-badge');
  await banner.waitForDisplayed({
    timeout: 10000,
    timeoutMsg: 'Update banner did not appear after mocking a newer upstream release',
  });
  expect(await banner.getText()).toContain(version);
}

export async function triggerManualUpdateCheck(): Promise<void> {
  const button = $('#profile-btn-check-updates');
  await button.waitForDisplayed({ timeout: 5000 });
  await safeClick(button);
}

export async function expectAvailableUpdateModal(currentVersion: string, nextVersion: string): Promise<void> {
  await waitForTopmostOverlayText('#update-modal-close', 'New update available', 30000);
  await waitForTopmostOverlayText('#update-modal-close', `${currentVersion} -> ${nextVersion}`, 30000);
  await waitForTopmostOverlayText('#update-modal-close', 'Make sure to back up your data before updating', 30000);
}

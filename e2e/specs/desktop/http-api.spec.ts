import net from 'node:net';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { confirmAction, dismissAlert, safeClick } from '../../helpers/common.js';
import { setText } from '../../helpers/form-controls.js';
import { clickMediaItem, isMediaNotVisible, isMediaVisible } from '../../helpers/library.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate an HTTP API test port')));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 1000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttpApiUp(baseUrl: string): Promise<void> {
  await browser.waitUntil(async () => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, {
    timeout: 8000,
    interval: 200,
    timeoutMsg: `HTTP API did not start at ${baseUrl}`,
  });
}

async function waitForHttpApiDown(baseUrl: string): Promise<void> {
  await browser.waitUntil(async () => {
    try {
      await fetchWithTimeout(`${baseUrl}/api/version`, {}, 500);
      return false;
    } catch {
      return true;
    }
  }, {
    timeout: 8000,
    interval: 200,
    timeoutMsg: `HTTP API was still reachable at ${baseUrl}`,
  });
}

async function openHttpApiAdvancedSettings(): Promise<void> {
  await browser.waitUntil(async () => {
    const details = $('#profile-local-api-advanced');
    return await details.isExisting().catch(() => false);
  }, {
    timeout: 10000,
    timeoutMsg: 'HTTP API advanced settings were not rendered',
  });

  const isOpen = await browser.execute(() => {
    const details = document.getElementById('profile-local-api-advanced') as HTMLDetailsElement | null;
    return details?.open ?? false;
  });
  if (!isOpen) {
    await safeClick('#profile-local-api-advanced summary');
  }
}

async function configureHttpApiPort(port: number): Promise<void> {
  await openHttpApiAdvancedSettings();
  await browser.execute(() => {
    const lan = document.getElementById('profile-local-api-lan') as HTMLInputElement | null;
    if (lan) {
      lan.checked = false;
      lan.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await setText('#profile-local-api-port', String(port));
}

async function setHttpApiSwitch(enabled: boolean): Promise<void> {
  await browser.waitUntil(async () => {
    const toggle = $('#profile-toggle-local-http-api');
    return await toggle.isExisting().catch(() => false);
  }, {
    timeout: 10000,
    timeoutMsg: 'HTTP API switch was not rendered',
  });

  await browser.execute((nextEnabled) => {
    const input = document.getElementById('profile-toggle-local-http-api') as HTMLInputElement | null;
    if (!input || input.checked === nextEnabled) return;

    input.checked = nextEnabled;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, enabled);

  await browser.waitUntil(async () => {
    const checked = await browser.execute(() => {
      const input = document.getElementById('profile-toggle-local-http-api') as HTMLInputElement | null;
      return input?.checked ?? false;
    });
    return checked === enabled;
  }, {
    timeout: 5000,
    interval: 100,
    timeoutMsg: `HTTP API switch did not settle to ${enabled ? 'on' : 'off'}`,
  });
}

async function selectFullScopeAndSave(): Promise<void> {
  await openHttpApiAdvancedSettings();
  await browser.execute(() => {
    const select = document.getElementById('profile-local-api-scope') as HTMLSelectElement | null;
    if (!select) return;

    select.value = 'full';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await safeClick('#profile-btn-save-local-http-api');
  await confirmAction(true);
  await dismissAlert('API settings saved and restarted', 10000);
}

describe('HTTP API CUJ', () => {
  let port: number;
  let baseUrl: string;

  before(async () => {
    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    await waitForAppReady();
  });

  after(async () => {
    try {
      await navigateTo('profile');
      await setHttpApiSwitch(false);
      await waitForHttpApiDown(baseUrl);
    } catch {
      // The app process is torn down after the spec; this is only best-effort cleanup.
    }
  });

  it('navigates to the profile tab', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
  });

  it('enables the local HTTP API without LAN access', async () => {
    await configureHttpApiPort(port);

    await setHttpApiSwitch(true);
    await waitForHttpApiUp(baseUrl);
  });

  it('verifies the automation-scope HTTP server answers read-only media requests', async () => {
    const mediaResponse = await fetchWithTimeout(`${baseUrl}/api/media`);
    expect(mediaResponse.status).toBe(200);
    const media = await mediaResponse.json() as Array<{ title?: string }>;
    expect(Array.isArray(media)).toBe(true);
    expect(media.length).toBeGreaterThan(0);
  });

  it('creates and deletes user data through automation endpoints and reflects it in the app', async () => {
    const title = 'HTTP API Automation Journey';
    const jsonHeaders = { 'content-type': 'application/json' };
    const mediaPayload = {
      id: null,
      uid: null,
      title,
      variant: 'API Edition',
      default_activity_type: 'Reading',
      status: 'Active',
      language: 'Japanese',
      description: 'Created through the local API',
      cover_image: '',
      extra_data: '{}',
      content_type: 'Novel',
      tracking_status: 'Ongoing',
    };
    const mediaResponse = await fetchWithTimeout(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(mediaPayload),
    });
    expect(mediaResponse.status).toBe(200);
    const mediaId = await mediaResponse.json() as number;

    const secondMediaResponse = await fetchWithTimeout(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ...mediaPayload, variant: 'Other Edition' }),
    });
    expect(secondMediaResponse.status).toBe(200);
    const secondMediaId = await secondMediaResponse.json() as number;
    const exactDuplicateResponse = await fetchWithTimeout(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(mediaPayload),
    });
    expect(exactDuplicateResponse.status).toBe(409);

    const mediaListResponse = await fetchWithTimeout(`${baseUrl}/api/media`);
    expect(mediaListResponse.status).toBe(200);
    const mediaList = await mediaListResponse.json() as Array<{
      id: number;
      uid: string;
      title: string;
      variant: string;
    }>;
    const apiEdition = mediaList.find(media => media.id === mediaId);
    const otherEdition = mediaList.find(media => media.id === secondMediaId);
    expect(apiEdition).toMatchObject({ title, variant: 'API Edition' });
    expect(otherEdition).toMatchObject({ title, variant: 'Other Edition' });
    const mediaUid = apiEdition?.uid;
    const secondMediaUid = otherEdition?.uid;
    expect(mediaUid).toBeTruthy();
    expect(secondMediaUid).toBeTruthy();

    const blankTitleCreateResponse = await fetchWithTimeout(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ...mediaPayload, title: ' \t ' }),
    });
    expect(blankTitleCreateResponse.status).toBe(400);

    const blankTitleRenameResponse = await fetchWithTimeout(`${baseUrl}/api/media/${mediaId}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ ...mediaPayload, id: mediaId, uid: mediaUid, title: ' \t ' }),
    });
    expect(blankTitleRenameResponse.status).toBe(400);
    const mediaAfterBlankRename = await (await fetchWithTimeout(`${baseUrl}/api/media`)).json() as Array<{
      id: number;
      title: string;
      variant: string;
    }>;
    expect(mediaAfterBlankRename.find(media => media.id === mediaId)).toMatchObject({
      title,
      variant: 'API Edition',
    });

    const collidingRenameResponse = await fetchWithTimeout(`${baseUrl}/api/media/${mediaId}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...mediaPayload,
        id: mediaId,
        uid: mediaUid,
        variant: 'Other Edition',
      }),
    });
    expect(collidingRenameResponse.status).toBe(409);

    const logResponse = await fetchWithTimeout(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: null,
        media_id: mediaId,
        duration_minutes: 29,
        characters: 1800,
        date: '2024-03-31',
        activity_type: 'Watching',
        notes: 'Written through API',
      }),
    });
    expect(logResponse.status).toBe(200);
    const logId = await logResponse.json() as number;

    const milestoneResponse = await fetchWithTimeout(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: null,
        media_uid: mediaUid,
        media_title: 'Ignored client display title',
        name: 'API milestone',
        duration: 29,
        characters: 1800,
        date: '2024-03-31',
      }),
    });
    expect(milestoneResponse.status).toBe(200);
    const milestoneId = await milestoneResponse.json() as number;
    const firstMilestonesResponse = await fetchWithTimeout(
      `${baseUrl}/api/media/${encodeURIComponent(mediaUid!)}/milestones`,
    );
    expect(firstMilestonesResponse.status).toBe(200);
    expect(await firstMilestonesResponse.json()).toEqual([
      expect.objectContaining({ media_uid: mediaUid, media_title: title, name: 'API milestone' }),
    ]);
    const secondMilestonesResponse = await fetchWithTimeout(
      `${baseUrl}/api/media/${encodeURIComponent(secondMediaUid!)}/milestones`,
    );
    expect(secondMilestonesResponse.status).toBe(200);
    expect(await secondMilestonesResponse.json()).toEqual([]);
    expect((await fetchWithTimeout(
      `${baseUrl}/api/milestones/media/${encodeURIComponent(title)}`,
    )).status).toBe(404);

    const settingResponse = await fetchWithTimeout(`${baseUrl}/api/settings/theme`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ value: 'molokai' }),
    });
    expect(settingResponse.status).toBe(200);

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('media');
    expect(await isMediaVisible(title)).toBe(true);
    await clickMediaItem(title, 'API Edition');
    expect(await $('#media-description').getText()).toContain('Created through the local API');
    expect(await $('#media-logs-container').getText()).toContain('29 Minutes');
    expect(await $('#media-logs-container').getText()).toContain('Written through API');
    expect(await $('#milestone-list-container').getText()).toContain('API milestone');
    expect(await $('body').getAttribute('data-theme')).toBe('molokai');

    expect((await fetchWithTimeout(`${baseUrl}/api/logs/${logId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetchWithTimeout(`${baseUrl}/api/milestones/${milestoneId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetchWithTimeout(`${baseUrl}/api/media/${mediaId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetchWithTimeout(`${baseUrl}/api/media/${secondMediaId}`, { method: 'DELETE' })).status).toBe(200);

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('media');
    expect(await isMediaNotVisible(title)).toBe(true);
  });

  it('verifies full-scope export endpoints are unavailable by default', async () => {
    const defaultFullScopeResponse = await fetchWithTimeout(`${baseUrl}/api/export/milestones`);
    expect(defaultFullScopeResponse.status).toBe(404);
  });

  it('enables full scope and keeps CSV export and validation at the human-readable boundary', async () => {
    await navigateTo('profile');
    await selectFullScopeAndSave();
    await waitForHttpApiUp(baseUrl);

    const fullScopeResponse = await fetchWithTimeout(`${baseUrl}/api/export/milestones`);
    expect(fullScopeResponse.status).toBe(200);
    expect(fullScopeResponse.headers.get('content-type') ?? '').toContain('text/csv');
    const milestoneCsv = await fullScopeResponse.text();
    expect(milestoneCsv.trimEnd().split(/\r?\n/)[0]).toBe(
      'Media Title,Name,Duration,Characters,Date,Media Variant',
    );
    expect(milestoneCsv.split(/\r?\n/, 1)[0]).not.toMatch(/\b(?:id|uid|uuid)\b/i);

    const forbiddenTitle = 'HTTP CSV Forbidden Identifier';
    const form = new FormData();
    form.append('file', new Blob([
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Activity Type,Media UID',
        `2026-07-21,${forbiddenTitle},Reading,20,Japanese,Reading,private-uid`,
      ].join('\n'),
    ], { type: 'text/csv' }), 'activities.csv');
    const invalidImport = await fetchWithTimeout(`${baseUrl}/api/import/activities`, {
      method: 'POST',
      body: form,
    }, 5_000);
    expect(invalidImport.status).toBe(400);
    expect(await invalidImport.text()).toContain("Unsupported 'Media UID' column");

    const invalidApply = await fetchWithTimeout(`${baseUrl}/api/import/media/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{
        Title: forbiddenTitle,
        'Default Activity Type': 'Reading',
        Status: 'Active',
        Language: 'Japanese',
        Description: '',
        'Content Type': 'Novel',
        'Extra Data': '{}',
        'Cover Image (Base64)': '',
        Variant: '',
        'Media UID': 'private-uid',
      }]),
    }, 5_000);
    expect(invalidApply.status).toBe(400);
    expect(await invalidApply.text()).toContain('Media UID');

    const mediaAfterRejectedImport = await (await fetchWithTimeout(`${baseUrl}/api/media`)).json() as
      Array<{ title: string }>;
    expect(mediaAfterRejectedImport.some(media => media.title === forbiddenTitle)).toBe(false);
  });

  it('disables the HTTP API', async () => {
    await setHttpApiSwitch(false);
  });

  it('verifies the HTTP server is no longer running', async () => {
    await waitForHttpApiDown(baseUrl);
  });
});

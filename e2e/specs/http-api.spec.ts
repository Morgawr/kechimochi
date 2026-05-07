import net from 'node:net';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { confirmAction, dismissAlert, safeClick, setInputValue } from '../helpers/common.js';

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
  await setInputValue('#profile-local-api-port', String(port));
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

  it('verifies full-scope export endpoints are unavailable by default', async () => {
    const defaultFullScopeResponse = await fetchWithTimeout(`${baseUrl}/api/export/milestones`);
    expect(defaultFullScopeResponse.status).toBe(404);
  });

  it('enables full scope and verifies milestone export now works after restart', async () => {
    await selectFullScopeAndSave();
    await waitForHttpApiUp(baseUrl);

    const fullScopeResponse = await fetchWithTimeout(`${baseUrl}/api/export/milestones`);
    expect(fullScopeResponse.status).toBe(200);
    expect(fullScopeResponse.headers.get('content-type') ?? '').toContain('text/csv');
    const milestoneCsv = await fullScopeResponse.text();
    expect(milestoneCsv).toContain('Media Title,Name,Duration,Characters,Date');
  });

  it('disables the HTTP API', async () => {
    await setHttpApiSwitch(false);
  });

  it('verifies the HTTP server is no longer running', async () => {
    await waitForHttpApiDown(baseUrl);
  });
});

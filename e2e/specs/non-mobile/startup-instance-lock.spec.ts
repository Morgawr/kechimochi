import { isDesktop } from '../../config/platform.js';

describe('Instance Lock Startup Warning', () => {
  const STARTUP_ERROR_TIMEOUT_MS = 10000;

  before(async () => {
    if (!isDesktop()) {
      await browser.url('/');
    }
  });

  it('shows the process holding the data-directory lock', async () => {
    const alertBody = await $('#alert-body');
    await alertBody.waitForDisplayed({ timeout: STARTUP_ERROR_TIMEOUT_MS });

    expect(await $('h1').getText()).toBe('Kechimochi is already running');
    const alertText = await alertBody.getText();
    expect(alertText).toContain(
      'Unable to obtain unique lock. Some other process is already running Kechimochi (pid=4242).',
    );
    expect(alertText).toContain('kind=e2e-lock-holder');
    expect(alertText).toContain('started_at=2026-07-21T13:42:09Z');
    expect(await $('#view-container').isExisting()).toBe(false);

    if (!isDesktop()) return;

    let sessionClosedDuringClick = false;
    try {
      await $('#alert-ok').click();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sessionClosedDuringClick = /invalid session id|session (?:deleted|terminated)/i.test(message);
      if (!sessionClosedDuringClick) throw error;
    }

    if (!sessionClosedDuringClick) {
      await browser.waitUntil(async () => {
        try {
          return (await browser.getWindowHandles()).length === 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /invalid session id|session (?:deleted|terminated)/i.test(message);
        }
      }, {
        timeout: STARTUP_ERROR_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: 'Expected the desktop app to close after acknowledging the lock warning',
      });
    }
  });
});

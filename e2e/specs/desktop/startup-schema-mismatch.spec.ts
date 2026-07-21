import { TEST_PROFILE_NAME } from '../../config/test-constants.js';

describe('Startup Error Handling', () => {
  const STARTUP_ERROR_TIMEOUT_MS = 10000;

  before(async () => {
    await browser.execute((profileName: string) => {
      localStorage.setItem('kechimochi_profile', profileName);
    }, TEST_PROFILE_NAME);
    await browser.refresh();
  });

  it('shows a blocking message instead of crashing when the database schema is newer than the app supports', async () => {
    const alertBody = await $('#alert-body');
    await alertBody.waitForDisplayed({ timeout: STARTUP_ERROR_TIMEOUT_MS });

    const alertText = await alertBody.getText();
    expect(alertText).toContain('Database schema version 999 is newer than this app supports (5)');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Unsupported database version');
    expect(await $('#view-container').isExisting()).toBe(false);

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
        timeoutMsg: 'Expected the desktop app to close after acknowledging the startup error',
      });
    }
  });
});

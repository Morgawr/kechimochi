describe('Startup Error Handling', () => {
  const STARTUP_ERROR_TIMEOUT_MS = 3000;

  it('shows a blocking message instead of crashing when the database schema is newer than the app supports', async () => {
    const alertBody = await $('#alert-body');
    await alertBody.waitForDisplayed({ timeout: STARTUP_ERROR_TIMEOUT_MS });

    const alertText = await alertBody.getText();
    expect(alertText).toContain('Database schema version 999 is newer than this app supports (2)');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Unsupported database version');
    expect(await $('#view-container').isExisting()).toBe(false);
  });
});

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { clickMediaItem } from '../../helpers/library.js';
import { addExtraField, getProjectionValue } from '../../helpers/media-detail.js';
import { logActivityGlobal } from '../../helpers/dashboard.js';

describe('CUJ: Reading Analysis (Report Card)', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('shows the reading speed panel and projects from a work\'s own sessions once one records time and characters', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    // Every seeded log records time but zero characters, so no speed is derivable yet.
    expect(await $('#dashboard-reading-speed').isExisting()).toBe(false);

    await logActivityGlobal('呪術廻戦', 30, 3000);

    const panel = $('#dashboard-reading-speed');
    await panel.waitForDisplayed({ timeout: 10000 });

    // 3,000 characters in 30 minutes is 6,000 char/hr.
    const expectedSpeedText = await browser.execute(() => (6000).toLocaleString());
    const mangaRow = $('#dashboard-reading-speed [data-content-type="Manga"]');
    await browser.waitUntil(async () => (await mangaRow.getText()).includes(expectedSpeedText), {
      timeout: 10000, timeoutMsg: `Manga reading speed row did not reach ${expectedSpeedText}`
    });

    await $('#reading-speed-toggle-time').click();
    await browser.waitUntil(async () => (await mangaRow.getText()).includes('30m'), {
      timeout: 5000, timeoutMsg: 'Manga reading speed row did not reach 30m after switching to the time tab'
    });

    await navigateTo('media');
    await clickMediaItem('呪術廻戦');
    await addExtraField('Character count', '12000');

    // The speed chip only renders from this work's own data, never from the type average.
    const speedChip = $('#est-reading-speed');
    await speedChip.waitForDisplayed({ timeout: 5000 });

    // 3,000 characters in 30 minutes is 6,000 char/hr, so 12,000 characters is 120 minutes against
    // the 75 minutes logged here (45 seeded plus the 30 above): 45 minutes left, 62.5% done.
    await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '45min', {
      timeout: 5000, timeoutMsg: 'est-remaining-time did not reach 45min'
    });
    await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '63%', {
      timeout: 5000, timeoutMsg: 'est-completion-rate did not reach 63%'
    });
  });

  it('counts Playing sessions on a visual novel toward its reading speed', async () => {
    // Bounce through another view so the library returns to the grid regardless of where the
    // previous test left off.
    await navigateTo('dashboard');
    await navigateTo('media');
    await clickMediaItem('STEINS;GATE');
    await addExtraField('Character count', '31500');

    // STEINS;GATE is Complete with 210 minutes seeded as Playing, so its speed is 31,500 characters
    // over 3.5 hours. Nothing renders at all if Playing sessions are excluded.
    const speedChip = $('#est-reading-speed');
    await speedChip.waitForDisplayed({ timeout: 5000 });
    expect(await speedChip.getText()).toContain('char/hr');
  });
});

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { clickMediaItem } from '../../helpers/library.js';
import { addExtraField, getProjectionValue } from '../../helpers/media-detail.js';
import { logActivityGlobal } from '../../helpers/dashboard.js';

describe('CUJ: Reading Analysis (Report Card)', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('shows the report card and projects from a work\'s own sessions once one records time and characters', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    // Every seeded log records time but zero characters, so no speed is derivable yet.
    expect(await $('#profile-report-card').isExisting()).toBe(false);

    // Log from another view: the report recomputes when Profile is navigated to, and navigating to
    // the view you are already on is a no-op.
    await navigateTo('dashboard');
    await logActivityGlobal('呪術廻戦', 30, 3000);

    await navigateTo('profile');
    const reportCard = $('#profile-report-card');
    await reportCard.waitForDisplayed({ timeout: 10000 });

    const contentText = await $('#profile-report-card-content').getText();
    expect(contentText).toContain('Manga');
    expect(contentText).toContain('char/hr');

    const windowNote = await $('#profile-report-window-note');
    expect(await windowNote.getText()).toMatch(/Since \d{4}-\d{2}-\d{2}|Over the last year/);

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

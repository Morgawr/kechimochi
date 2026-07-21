import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { dismissAlert } from '../../helpers/common.js';
import { clickMediaItem } from '../../helpers/library.js';
import { addExtraField, getProjectionValue, backToGrid } from '../../helpers/media-detail.js';
import { calculateReport } from '../../helpers/profile.js';
import { logActivityGlobal } from '../../helpers/dashboard.js';

describe('CUJ: Reading Analysis (Report Card)', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should calculate the reading report and verify updates', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const calculateBtn = await $('#profile-btn-calculate-report');

    await $('#profile-report-timestamp');

    await calculateBtn.click();

    await browser.waitUntil(async () => {
      try {
        const btn = await $('#profile-btn-calculate-report');
        const text = await btn.getText();
        const disabled = await btn.getProperty('disabled');
        return text === 'Calculating...' || disabled === 'true';
      } catch {
        return false;
      }
    }, { timeout: 2000, interval: 100 }).catch(() => {});

    await browser.waitUntil(async () => {
      try {
        const btn = await $('#profile-btn-calculate-report');
        return (await btn.getText()) === 'Calculate Report';
      } catch {
        return false;
      }
    }, {
      timeout: 10000,
      timeoutMsg: 'Calculation took too long'
    });

    await dismissAlert();

    const content = await $('#profile-report-card-content');
    const contentText = await content.getText();
    expect(contentText).not.toContain('No report calculated yet.');

    const newTimestampElement = await $('#profile-report-timestamp');
    expect(await newTimestampElement.isExisting()).toBe(true);
    const timestampText = await newTimestampElement.getText();
    expect(timestampText).toContain('Since');

    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    expect(timestampText).toMatch(dateRegex);
  });

  it('should calculate reading speeds and show correct projections per media type', async () => {
    await navigateTo('media');
    await clickMediaItem('ダンジョン飯');
    await addExtraField('Character count', '3000');
    await backToGrid();

    await clickMediaItem('ある魔女が死ぬまで');
    await addExtraField('Character count', '14250');
    await backToGrid();

    await clickMediaItem('STEINS;GATE');
    await addExtraField('Character count', '31500');

    await navigateTo('profile');
    await calculateReport();

    await navigateTo('media');
    await clickMediaItem('呪術廻戦');
    await addExtraField('Character count', '6000');

    await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '15min', {
      timeout: 5000, timeoutMsg: 'est-remaining-time for Jututsu did not reach 15min'
    });
    await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '75%', {
      timeout: 5000, timeoutMsg: 'est-completion-rate for Jututsu did not reach 75%'
    });
    await backToGrid();

    await clickMediaItem('薬屋のひとりごと');
    await addExtraField('Character count', '15000');

    await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '1h15min', {
      timeout: 5000, timeoutMsg: 'est-remaining-time for Kusuriya did not reach 1h15min'
    });
    await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '75%', {
      timeout: 5000, timeoutMsg: 'est-completion-rate for Kusuriya did not reach 75%'
    });
    await backToGrid();

    await logActivityGlobal('呪術廻戦', 30);

    await navigateTo('media');
    await clickMediaItem('呪術廻戦');

    await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '0min', {
      timeout: 5000, timeoutMsg: 'est-remaining-time for Jujutsu (post-log) did not reach 0min'
    });
    await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '100%', {
      timeout: 5000, timeoutMsg: 'est-completion-rate for Jujutsu (post-log) did not reach 100%'
    });
  });
});

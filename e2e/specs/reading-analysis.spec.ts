import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { dismissAlert } from '../helpers/common.js';

describe('CUJ: Reading Analysis (Report Card)', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should calculate the reading report and verify updates', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    const calcBtn = await $('#profile-btn-calculate-report');
    
    await $('#profile-report-timestamp');

    await calcBtn.click();

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
    
    const newTimestampEl = await $('#profile-report-timestamp');
    expect(await newTimestampEl.isExisting()).toBe(true);
    const timestampText = await newTimestampEl.getText();
    expect(timestampText).toContain('Since');
    
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    expect(timestampText).toMatch(dateRegex);
  });
});

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem } from '../../helpers/library.js';
import {
  backToGrid,
  editMostRecentLogFromDetail,
  logActivityFromDetail,
} from '../../helpers/media-detail.js';
import { setSelect } from '../../helpers/form-controls.js';
import { waitForCurrentPieChartData } from '../../helpers/dashboard.js';

describe('CUJ: Activity Record Integrity', () => {
  const title = 'Activity Integrity Novel';
  const originalNotes = 'First line, with comma\nSecond "quoted" line';
  const editedNotes = 'Edited note survives navigation and export';

  before(async () => {
    await waitForAppReady();
  });

  it('preserves notes and historical activity types when the media default changes', async () => {
    await navigateTo('media');
    await addMedia(title, 'Reading', 'Novel', 'Paperback');

    await logActivityFromDetail(title, '23', '1200', 'Reading', originalNotes);
    const firstLog = $('.media-detail-log-item');
    expect(await firstLog.getText()).toContain('First line, with comma');
    expect(await firstLog.getText()).toContain('Second "quoted" line');

    await editMostRecentLogFromDetail('31', '1500', editedNotes, 'Reading');
    await browser.waitUntil(async () => (await $('.media-detail-log-item').getText()).includes(editedNotes), {
      timeout: 5000,
      timeoutMsg: 'Edited activity notes did not render on media detail',
    });

    await navigateTo('dashboard');
    const originalDashboardEntry = $(`.dashboard-activity-item[data-activity-title="${title}"]`);
    await originalDashboardEntry.waitForDisplayed({ timeout: 5000 });
    expect(await originalDashboardEntry.getText()).toContain('31 Minutes');
    expect(await originalDashboardEntry.getText()).toContain('of Reading');

    const aggregateBefore = await waitForCurrentPieChartData({
      labels: ['Reading'],
      values: [31],
    });

    await navigateTo('media');
    await clickMediaItem(title);
    await setSelect('#default-activity-type', { text: 'Watching' });
    expect(await $('#default-activity-type').getValue()).toBe('Watching');

    await navigateTo('dashboard');
    expect(await $(`.dashboard-activity-item[data-activity-title="${title}"]`).getText()).toContain('of Reading');
    expect(await waitForCurrentPieChartData({
      labels: ['Reading'],
      values: [31],
    })).toEqual(aggregateBefore);

    await navigateTo('media');
    await clickMediaItem(title);
    expect(await $('.media-detail-log-item').getText()).toContain(editedNotes);
    await logActivityFromDetail(title, '17', '0', undefined, 'New default activity');
    await backToGrid();

    await navigateTo('dashboard');
    const entries = $$(`.dashboard-activity-item[data-activity-title="${title}"]`);
    expect(await entries.length).toBe(2);
    const entryTexts = await entries.map(entry => entry.getText());
    expect(entryTexts.some(text => text.includes('31 Minutes') && text.includes('of Reading'))).toBe(true);
    expect(entryTexts.some(text => text.includes('17 Minutes') && text.includes('of Watching'))).toBe(true);
    expect(await verifyActiveView('dashboard')).toBe(true);
  });
});

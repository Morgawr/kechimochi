import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import {
  logActivity,
  getStatValue,
  deleteMostRecentLog,
  getHeatmapCellColor,
  waitForActivityFormToDisappear,
} from '../../helpers/dashboard.js';
import { submitPrompt, dismissAlert, closeModal } from '../../helpers/common.js';
import { clickMediaItem, isMediaVisible, isMediaNotVisible } from '../../helpers/library.js';
import { backToGrid, getDetailTrackingStatus } from '../../helpers/media-detail.js';
import { MOCK_DATE } from '../../config/test-constants.js';

describe('CUJ: Log Daily Activity', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should verify that "Final Fantasy 7" does not exist in the media tab initially', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    expect(await isMediaNotVisible('Final Fantasy 7')).toBe(true);
  });

  it('should log a new activity for "Final Fantasy 7" with minutes and characters', async () => {
    await logActivity('Final Fantasy 7', '60', '1000', MOCK_DATE);
    await submitPrompt('Playing');
    await waitForActivityFormToDisappear();
  });

  it('should log an activity with only characters for "Final Fantasy 7"', async () => {
    await logActivity('Final Fantasy 7', '0', '500', '2024-03-30');
  });

  it('should show an alert when trying to log 0 duration and 0 characters', async () => {
    await logActivity('Final Fantasy 7', '0', '0');

    await dismissAlert('Please enter either duration or characters.');
    await closeModal('#activity-cancel');
  });

  it('should verify the new entries in "Recent Activity" on dashboard', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    const entry1 = $(`.dashboard-activity-item[data-activity-title="Final Fantasy 7"]`);
    await entry1.waitForExist({ timeout: 3000 });
    const text1 = await entry1.getText();
    expect(text1).toContain('60 Minutes');
    expect(text1).toMatch(/1,?000 characters/);

    const entries = $$(`.dashboard-activity-item[data-activity-title="Final Fantasy 7"]`);
    expect(await entries.length).toBe(2);

    const listText = await $('#recent-logs-list').getText();
    expect(listText).toContain('500 characters');
  });

  it('should verify that "Final Fantasy 7" now exists in the media tab', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    expect(await isMediaVisible('Final Fantasy 7')).toBe(true);

    await clickMediaItem('Final Fantasy 7');
    expect(await getDetailTrackingStatus()).toBe('Ongoing');
    await backToGrid();
  });

  it('should reflect deletions and new logs on the dashboard immediately', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    // Self-contained: create our own log on the mocked "today" (the latest
    // selectable date, so it sorts to the top of the recent-activity list) and
    // exercise the add -> delete feedback loop against that log, rather than
    // assuming the seed's most-recent entry survived earlier tests this session.
    const targetDate = MOCK_DATE;
    const initialLogsCount = await getStatValue('stat-total-logs');
    const initialCellColor = await getHeatmapCellColor(targetDate);

    await logActivity('呪術廻戦', '300', '0', targetDate);

    const afterLogCount = await getStatValue('stat-total-logs');
    expect(afterLogCount).toBe(initialLogsCount + 1);

    const afterLogCellColor = await getHeatmapCellColor(targetDate);
    expect(afterLogCellColor).not.toBe(initialCellColor);
    expect(afterLogCellColor).not.toContain('rgba(0, 0, 0, 0)');
    expect(afterLogCellColor).not.toBe('');

    // Our log has the latest date and the newest id, so it is the most-recent
    // entry; deleting the most-recent log removes exactly what we just created.
    await deleteMostRecentLog();

    const afterDeleteCount = await getStatValue('stat-total-logs');
    expect(afterDeleteCount).toBe(initialLogsCount);

    const afterDeleteCellColor = await getHeatmapCellColor(targetDate);
    expect(afterDeleteCellColor).not.toBe(afterLogCellColor);

    const currentStreak = await getStatValue('stat-current-streak');
    expect(currentStreak).toBeGreaterThanOrEqual(1);

    const dailyAverage = await getStatValue('stat-total-avg');
    expect(dailyAverage).toBeGreaterThan(0);
  });
});

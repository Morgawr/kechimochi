import { waitForAppReady } from '../helpers/setup.js';
import { verifyViewNotBroken, navigateTo } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';
import {
  logActivity,
  editMostRecentLog,
  clickHeatmapCell,
  waitForHeatmapReady,
  selectActivityChartTimeRange,
  getActivityChartRangeMetadata,
} from '../helpers/dashboard.js';

describe('Dashboard CUJ', () => {
  before(async () => {
    await waitForAppReady();
    await waitForHeatmapReady();
  });

  it('should display the dashboard view on launch', async () => {
    const dashLink = $('[data-view="dashboard"]');
    const classes = await dashLink.getProperty('className');
    expect(classes).toContain('active');
  });

  it('should render the heatmap', async () => {
    await waitForHeatmapReady();

    const heatmapCellCount = await browser.execute(() => {
      return document.querySelectorAll('.heatmap-cell[title]').length;
    });
    expect(heatmapCellCount).toBeGreaterThanOrEqual(365);
  });

  it('should display stats cards with fixture data', async () => {
    const statsCards = await $$('.card');
    expect(await statsCards.length).toBeGreaterThan(0);
  });

  it('should have a functional view with no broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should match the baseline screenshot', async () => {
    await takeAndCompareScreenshot('dashboard-initial');
  });

  it('should jump the activity chart to the clicked heatmap week', async () => {
    await navigateTo('dashboard');

    await selectActivityChartTimeRange('30');
    const monthlyRange = await getActivityChartRangeMetadata();
    expect(monthlyRange.timeRangeDays).toBe('30');
    expect(monthlyRange.rangeStart).toBe('2024-03-01');
    expect(monthlyRange.rangeEnd).toBe('2024-03-31');

    await clickHeatmapCell('2024-03-07');

    await browser.waitUntil(async () => {
      const metadata = await getActivityChartRangeMetadata();
      return metadata.timeRangeDays === '7'
        && metadata.rangeStart === '2024-03-04'
        && metadata.rangeEnd === '2024-03-10';
    }, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Expected heatmap click to switch the dashboard chart to the selected week'
    });

    const weeklyRange = await getActivityChartRangeMetadata();
    expect(weeklyRange.timeRangeDays).toBe('7');
    expect(weeklyRange.rangeStart).toBe('2024-03-04');
    expect(weeklyRange.rangeEnd).toBe('2024-03-10');

    const timeRangeSelect = $('#select-time-range');
    expect(await timeRangeSelect.getValue()).toBe('7');
  });

  it('should allow editing an activity from the timeline', async () => {
    await navigateTo('dashboard');
    
    const duration = '45';
    const newDuration = '60';
    
    // Log an activity first
    await logActivity('STEINS;GATE', duration);
    
    // Verify it appeared
    const logEntry = $('.dashboard-activity-item*=45 Minutes');
    await logEntry.waitForExist({ timeout: 5000 });
    
    // Edit it
    await editMostRecentLog(newDuration);
    
    // Verify it updated
    const updatedEntry = $('.dashboard-activity-item*=60 Minutes');
    await updatedEntry.waitForExist({ timeout: 5000 });
    expect(await updatedEntry.isDisplayed()).toBe(true);
  });
});

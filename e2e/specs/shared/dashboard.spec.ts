import { waitForAppReady } from '../../helpers/setup.js';
import { verifyViewNotBroken, navigateTo } from '../../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../../helpers/common.js';
import { MOCK_DATE } from '../../config/test-constants.js';
import { getSelectValue } from '../../helpers/form-controls.js';
import {
  logActivity,
  editMostRecentLog,
  clickHeatmapCell,
  waitForHeatmapReady,
  selectActivityChartTimeRange,
  getActivityChartRangeMetadata,
  getStatValue,
} from '../../helpers/dashboard.js';

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
    expect(await getStatValue('stat-total-logs')).toBeGreaterThan(0);
    expect(await getStatValue('stat-total-media')).toBeGreaterThan(0);
    expect(await getStatValue('stat-max-streak')).toBeGreaterThan(0);
    expect(await getStatValue('stat-total-hours')).toBeGreaterThan(0);
    expect(await $('#stat-total-chars').isExisting()).toBe(false);
  });

  it('should have a functional view with no broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should capture a non-blocking dashboard visual diff', async () => {
    await takeAndCompareScreenshot('dashboard-initial');
  });

  it('should jump the activity chart to the clicked heatmap week', async () => {
    await navigateTo('dashboard');

    await selectActivityChartTimeRange('30');
    const monthlyRange = await getActivityChartRangeMetadata();
    expect(monthlyRange.timeRangeDays).toBe('30');
    expect(monthlyRange.rangeStart).toBe('2024-03-01');
    expect(monthlyRange.rangeEnd).toBe(MOCK_DATE);

    const monthlyStats = await browser.execute(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.dashboard-totals-card'));
      const card = cards.find(candidate => candidate.querySelector('.dashboard-totals-title')?.textContent?.includes('Monthly Stats'));
      const rows = Array.from(card?.querySelectorAll<HTMLElement>('[data-dashboard-total-index]') ?? []);
      const headerCells = Array.from(card?.querySelectorAll<HTMLElement>('.dashboard-stats-row-header > span') ?? []);
      const rowCellLefts = rows.slice(0, 5).map(row =>
        Array.from(row.children).map(cell => Math.round(cell.getBoundingClientRect().left)));
      const columnsAligned = rowCellLefts.length > 0
        && rowCellLefts[0].every((left, column) =>
          rowCellLefts.every(row => Math.abs((row[column] ?? Number.NaN) - left) <= 1));
      const firstWeekDivider = rows.find(row => row.classList.contains('is-week-start'));
      const firstWeekDividerStyle = firstWeekDivider ? getComputedStyle(firstWeekDivider) : null;

      return {
        rowCount: rows.length,
        headerCells: headerCells.map(cell => cell.textContent ?? ''),
        firstRowCells: Array.from(rows[0]?.children ?? []).map(cell => cell.textContent ?? ''),
        lastRowCells: Array.from(rows.at(-1)?.children ?? []).map(cell => cell.textContent ?? ''),
        columnsAligned,
        weekDividerDays: rows
          .filter(row => row.classList.contains('is-week-start'))
          .map(row => row.querySelector('.dashboard-stats-row-day')?.textContent ?? ''),
        hasVisibleWeekDivider: firstWeekDividerStyle !== null
          && Number.parseFloat(firstWeekDividerStyle.marginTop) > 0
          && Number.parseFloat(firstWeekDividerStyle.paddingTop) > 0
          && Number.parseFloat(firstWeekDividerStyle.borderTopWidth) > 0,
        containsWeekBucket: rows.some(row => row.textContent?.includes('Week ')),
        selectorLabels: Array.from(document.querySelectorAll<HTMLOptionElement>('#select-time-range option')).map(option => option.textContent ?? ''),
      };
    });

    expect(monthlyStats.rowCount).toBe(31);
    expect(monthlyStats.headerCells).toEqual(['Day', 'Weekday', 'Hours']);
    expect(monthlyStats.firstRowCells.slice(0, 2)).toEqual(['01', 'FRI']);
    expect(monthlyStats.lastRowCells.slice(0, 2)).toEqual(['31', 'SUN']);
    expect(monthlyStats.columnsAligned).toBe(true);
    expect(monthlyStats.weekDividerDays).toEqual(['04', '11', '18', '25']);
    expect(monthlyStats.hasVisibleWeekDivider).toBe(true);
    expect(monthlyStats.containsWeekBucket).toBe(false);
    expect(monthlyStats.selectorLabels).toEqual(['Week', 'Month', 'Year', 'All Time']);

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

    expect(await getSelectValue('#select-time-range')).toBe('7');
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

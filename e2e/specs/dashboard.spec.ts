import { waitForAppReady } from '../helpers/setup.js';
import { verifyViewNotBroken, navigateTo } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';
import { logActivity, editMostRecentLog } from '../helpers/dashboard.js';

describe('Dashboard CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should display the dashboard view on launch', async () => {
    const dashLink = $('[data-view="dashboard"]');
    const classes = await dashLink.getProperty('className');
    expect(classes).toContain('active');
  });

  it('should render the heatmap', async () => {
    const heatmap = $('.heatmap');
    expect(await heatmap.isDisplayed()).toBe(true);
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

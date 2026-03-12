import { waitForAppReady } from '../helpers/setup.js';
import { verifyViewNotBroken } from '../helpers/navigation.js';
import { takeAndCompareScreenshot } from '../helpers/common.js';

describe('Dashboard CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should display the dashboard view on launch', async () => {
    const dashLink = await $('[data-view="dashboard"]');
    const classes = await dashLink.getProperty('className');
    expect(classes).toContain('active');
  });

  it('should render the heatmap', async () => {
    const heatmap = await $('.heatmap');
    expect(await heatmap.isDisplayed()).toBe(true);
  });

  it('should display stats cards with fixture data', async () => {
    const statsCards = await $$('.card');
    expect(statsCards.length).toBeGreaterThan(0);
  });

  it('should have a functional view with no broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should match the baseline screenshot', async () => {
    await takeAndCompareScreenshot('dashboard-initial');
  });
});

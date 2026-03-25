import { waitForAppReady } from '../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
  verifyViewNotBroken,
} from '../helpers/navigation.js';

type ViewName = 'dashboard' | 'media' | 'timeline' | 'profile';

describe('Navigation CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  // The full navigation sequence as specified
  const sequence: ViewName[] = [
    'dashboard',  // Starting view (verified, not navigated to)
    'media',
    'timeline',
    'profile',
    'timeline',
    'media',
    'dashboard',
  ];

  it('should start on the dashboard view', async () => {
    expect(await verifyActiveView('dashboard')).toBe(true);
    await verifyViewNotBroken();
  });

  // Generate a test for each navigation step
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];
    const stepNumber = i;

    it(`Step ${stepNumber}: should navigate from ${from} to ${to}`, async () => {
      await navigateTo(to);
      await browser.pause(500);

      expect(await verifyActiveView(to)).toBe(true);
    });

    it(`Step ${stepNumber}: ${to} view should not be broken`, async () => {
      await verifyViewNotBroken();

      const container = await $('#view-container');
      const children = await container.$$('*');
      expect(await children.length).toBeGreaterThan(5);

      if (to === 'dashboard') {
        // Detailed check for dashboard components that were prone to disappearing
        const statsBox = await $('#stats-box-container');
        expect(await statsBox.isExisting()).toBe(true);
        const statsChildren = await statsBox.$$('*');
        expect(await statsChildren.length).toBeGreaterThan(0);

        const heatmap = await $('#heatmap-container');
        expect(await heatmap.isExisting()).toBe(true);
        const heatmapGrid = await heatmap.$('.heatmap');
        expect(await heatmapGrid.isExisting()).toBe(true);
      }
    });
  }
});

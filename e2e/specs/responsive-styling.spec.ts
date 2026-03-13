import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';

describe('Responsive Styling CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await browser.setWindowSize(1280, 1200);
  });

  it('should collapse nav controls and iconify Log Activity on narrow mobile width', async () => {
    await browser.setWindowSize(740, 1200);
    await browser.pause(300);

    const responsive = await browser.execute(() => {
      const text = document.querySelector<HTMLElement>('.activity-btn-text');
      const icon = document.querySelector<HTMLElement>('.activity-btn-icon');
      const spacer = document.getElementById('nav-spacer');
      const controls = document.getElementById('nav-controls-row');

      return {
        textDisplay: text ? getComputedStyle(text).display : null,
        iconDisplay: icon ? getComputedStyle(icon).display : null,
        spacerDisplay: spacer ? getComputedStyle(spacer).display : null,
        controlsOrder: controls ? getComputedStyle(controls).order : null,
      };
    });

    expect(responsive.textDisplay).toBe('none');
    expect(responsive.iconDisplay).not.toBe('none');
    expect(responsive.spacerDisplay).toBe('none');
    expect(responsive.controlsOrder).toBe('3');
  });

  it('should stack dashboard stats and charts vertically on tablet width', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(1000, 1200);
    await browser.pause(350);

    const stacked = await browser.execute(() => {
      const stats = document.getElementById('stats-box-container');
      const heatmap = document.getElementById('heatmap-container');
      const charts = document.querySelectorAll('#activity-charts-grid .card');
      if (!stats || !heatmap || charts.length < 2) {
        return {
          hasRequiredNodes: false,
          heatmapBelowStats: false,
          secondChartBelowFirst: false,
        };
      }

      const statsRect = stats.getBoundingClientRect();
      const heatmapRect = heatmap.getBoundingClientRect();
      const firstChartRect = charts[0].getBoundingClientRect();
      const secondChartRect = charts[1].getBoundingClientRect();

      return {
        hasRequiredNodes: true,
        heatmapBelowStats: heatmapRect.top > (statsRect.top + 40),
        secondChartBelowFirst: secondChartRect.top > (firstChartRect.top + 40),
      };
    });

    expect(stacked.hasRequiredNodes).toBe(true);
    expect(stacked.heatmapBelowStats).toBe(true);
    expect(stacked.secondChartBelowFirst).toBe(true);
  });

  it('should apply mobile media-detail layout structure and style hooks', async () => {
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    const firstItem = await $('.media-grid-item');
    await firstItem.waitForDisplayed({ timeout: 10000 });
    await firstItem.click();

    const title = await $('#media-title');
    await title.waitForDisplayed({ timeout: 10000 });

    await browser.setWindowSize(760, 1200);
    await browser.pause(350);

    const mediaLayout = await browser.execute(() => {
      const coverColumn = document.getElementById('media-cover-column');
      const headerSpacer = document.getElementById('media-detail-header-spacer');
      const header = document.getElementById('media-detail-header');
      const statsGrid = document.getElementById('media-stats-grid');
      const contentArea = document.getElementById('media-content-area');

      if (!coverColumn || !headerSpacer || !header || !statsGrid || !contentArea) {
        return {
          hasRequiredNodes: false,
          coverPosition: null,
          headerSpacerDisplay: null,
          headerWrap: null,
          statsColumns: null,
          contentPaddingTop: null,
        };
      }

      return {
        hasRequiredNodes: true,
        coverPosition: getComputedStyle(coverColumn).position,
        headerSpacerDisplay: getComputedStyle(headerSpacer).display,
        headerWrap: getComputedStyle(header).flexWrap,
        statsColumnCount: getComputedStyle(statsGrid).gridTemplateColumns.split(' ').length,
        contentPaddingTop: getComputedStyle(contentArea).paddingTop,
      };
    });

    expect(mediaLayout.hasRequiredNodes).toBe(true);
    expect(mediaLayout.coverPosition).toBe('absolute');
    expect(mediaLayout.headerSpacerDisplay).toBe('none');
    expect(mediaLayout.headerWrap).toBe('wrap');
    expect(mediaLayout.statsColumnCount).toBe(1);
    expect(mediaLayout.contentPaddingTop).toBe('180px');
  });
});

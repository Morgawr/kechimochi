import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { setLibraryLayout, waitForLibraryLayout } from '../helpers/library.js';

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

  it('should switch the library to list mode on narrow widths and restore grid when widened again', async () => {
    await browser.setWindowSize(1280, 1200);
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    await setLibraryLayout('grid');

    const gridToggle = $('#btn-layout-grid');
    const listToggle = $('#btn-layout-list');
    await gridToggle.waitForDisplayed({ timeout: 10000 });
    await listToggle.waitForDisplayed({ timeout: 10000 });

    expect(await gridToggle.isEnabled()).toBe(true);
    expect(await gridToggle.getAttribute('aria-pressed')).toBe('true');

    await browser.setWindowSize(760, 1200);
    await waitForLibraryLayout('list');

    expect(await listToggle.getAttribute('aria-pressed')).toBe('true');
    expect(await gridToggle.isEnabled()).toBe(false);
    expect(await gridToggle.getAttribute('disabled')).not.toBeNull();

    await browser.setWindowSize(1280, 1200);
    await waitForLibraryLayout('grid');

    expect(await gridToggle.isEnabled()).toBe(true);
    expect(await gridToggle.getAttribute('aria-pressed')).toBe('true');
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
      const backSlot = document.getElementById('media-back-slot');
      const header = document.getElementById('media-detail-header');
      const titleGroup = document.getElementById('media-title-group');
      const overflowRoot = document.getElementById('media-overflow-root');
      const statsGrid = document.getElementById('media-stats-grid');
      const contentArea = document.getElementById('media-content-area');

      if (!coverColumn || !backSlot || !header || !titleGroup || !overflowRoot || !statsGrid || !contentArea) {
        return {
          hasRequiredNodes: false,
          coverPosition: null,
          backSlotDisplay: null,
          headerWrap: null,
          titleGroupDisplay: null,
          overflowRootDisplay: null,
          statsColumns: null,
          contentPaddingTop: null,
        };
      }

      return {
        hasRequiredNodes: true,
        coverPosition: getComputedStyle(coverColumn).position,
        backSlotDisplay: getComputedStyle(backSlot).display,
        headerWrap: getComputedStyle(header).flexWrap,
        titleGroupDisplay: getComputedStyle(titleGroup).display,
        overflowRootDisplay: getComputedStyle(overflowRoot).display,
        statsColumnCount: getComputedStyle(statsGrid).gridTemplateColumns.split(' ').length,
        contentPaddingTop: getComputedStyle(contentArea).paddingTop,
      };
    });

    expect(mediaLayout.hasRequiredNodes).toBe(true);
    expect(mediaLayout.coverPosition).toBe('absolute');
    expect(mediaLayout.backSlotDisplay).toBe('none');
    expect(mediaLayout.headerWrap).toBe('wrap');
    expect(mediaLayout.titleGroupDisplay).toBe('flex');
    expect(mediaLayout.overflowRootDisplay).toBe('flex');
    expect(mediaLayout.statsColumnCount).toBe(1);
    expect(mediaLayout.contentPaddingTop).toBe('180px');
  });
});

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

  it('should hide nav controls on mobile width and iconify Log Activity on narrow mobile width', async () => {
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
        controlsDisplay: controls ? getComputedStyle(controls).display : null,
      };
    });

    
    expect(responsive.iconDisplay).not.toBe('true');
    expect(responsive.spacerDisplay).toBe('none');
    expect(responsive.controlsDisplay).toBe('none');

    await browser.setWindowSize(340, 1200);
    await browser.pause(300);

    const responsiveAfterResize = await browser.execute(() => {
      const text = document.querySelector('.activity-btn-text');
      return {
        textDisplay: text ? getComputedStyle(text).display : null,
      };
    });
    expect(responsiveAfterResize.textDisplay).toBe('none');

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

  it('should distribute dashboard visualization controls across the full row at desktop width', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(1280, 1200);
    await browser.pause(350);

    const alignment = await browser.execute(() => {
      const heatmapCard = document.querySelector('#heatmap-container .card') as HTMLElement | null;
      const heatmapTitleControls = document.querySelector('.heatmap-title-controls') as HTMLElement | null;
      const chartCard = document.querySelector('#activity-charts-grid .card:last-child') as HTMLElement | null;
      const chartTitleControls = document.querySelector('.activity-charts-title-controls') as HTMLElement | null;
      const chartToolbar = document.querySelector('.chart-toolbar') as HTMLElement | null;

      if (!heatmapCard || !heatmapTitleControls || !chartCard || !chartTitleControls || !chartToolbar) {
        return {
          hasRequiredNodes: false,
          heatmapCenterOffset: Number.POSITIVE_INFINITY,
          chartTitleCenterOffset: Number.POSITIVE_INFINITY,
          chartToolbarCenterOffset: Number.POSITIVE_INFINITY,
          chartToolbarWidthRatio: Number.POSITIVE_INFINITY,
          chartToolbarColumnCount: 0,
        };
      }

      const getCenterOffset = (element: HTMLElement, parent: HTMLElement) => {
        const elementRect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const elementCenter = elementRect.left + (elementRect.width / 2);
        const parentCenter = parentRect.left + (parentRect.width / 2);
        return Math.abs(elementCenter - parentCenter);
      };

      const chartToolbarRect = chartToolbar.getBoundingClientRect();
      const chartCardRect = chartCard.getBoundingClientRect();
      const chartToolbarColumnCount = getComputedStyle(chartToolbar).gridTemplateColumns.split(' ').length;

      return {
        hasRequiredNodes: true,
        heatmapCenterOffset: getCenterOffset(heatmapTitleControls, heatmapCard),
        chartTitleCenterOffset: getCenterOffset(chartTitleControls, chartCard),
        chartToolbarCenterOffset: getCenterOffset(chartToolbar, chartCard),
        chartToolbarWidthRatio: chartToolbarRect.width / chartCardRect.width,
        chartToolbarColumnCount,
      };
    });

    expect(alignment.hasRequiredNodes).toBe(true);
    expect(alignment.heatmapCenterOffset).toBeLessThan(16);
    expect(alignment.chartTitleCenterOffset).toBeLessThan(16);
    expect(alignment.chartToolbarCenterOffset).toBeLessThan(16);
    expect(alignment.chartToolbarWidthRatio).toBeGreaterThan(0.9);
    expect(alignment.chartToolbarWidthRatio).toBeLessThan(1.02);
    expect(alignment.chartToolbarColumnCount).toBe(4);
  });

  it('should keep dashboard visualization controls on one scaled row at narrow app widths', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(650, 1200);
    await browser.pause(350);

    const compactLayout = await browser.execute(() => {
      const chartCard = document.querySelector('#activity-charts-grid .card:last-child') as HTMLElement | null;
      const chartToolbar = document.querySelector('.chart-toolbar') as HTMLElement | null;

      if (!chartCard || !chartToolbar) {
        return {
          hasRequiredNodes: false,
          chartToolbarWidthRatio: Number.POSITIVE_INFINITY,
          chartToolbarColumnCount: 0,
          chartToolbarRowCount: Number.POSITIVE_INFINITY,
          chartToolbarOverflow: true,
        };
      }

      const chartToolbarRect = chartToolbar.getBoundingClientRect();
      const chartCardRect = chartCard.getBoundingClientRect();
      const toolbarItems = Array.from(chartToolbar.children).filter((child) =>
        child instanceof HTMLElement && child.matches('.chart-toolbar-group, .chart-toolbar-select-shell'),
      ) as HTMLElement[];
      const rowCount = new Set(toolbarItems.map((item) => Math.round(item.getBoundingClientRect().top))).size;

      return {
        hasRequiredNodes: true,
        chartToolbarWidthRatio: chartToolbarRect.width / chartCardRect.width,
        chartToolbarColumnCount: getComputedStyle(chartToolbar).gridTemplateColumns.split(' ').length,
        chartToolbarRowCount: rowCount,
        chartToolbarOverflow: chartToolbar.scrollWidth > (chartToolbar.clientWidth + 1),
      };
    });

    expect(compactLayout.hasRequiredNodes).toBe(true);
    expect(compactLayout.chartToolbarWidthRatio).toBeGreaterThan(0.9);
    expect(compactLayout.chartToolbarColumnCount).toBe(4);
    expect(compactLayout.chartToolbarRowCount).toBe(1);
    expect(compactLayout.chartToolbarOverflow).toBe(false);
  });

  it('should keep dashboard visualization headers inside their cards on narrow mobile widths', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(390, 960);
    await browser.pause(350);

    const overflow = await browser.execute(() => {
      const heatmapCard = document.querySelector('#heatmap-container .card') as HTMLElement | null;
      const heatmapTitleControls = document.querySelector('.heatmap-title-controls') as HTMLElement | null;
      const chartCard = document.querySelector('#activity-charts-grid .card:last-child') as HTMLElement | null;
      const chartHeader = document.querySelector('.activity-charts-header') as HTMLElement | null;
      const chartToolbar = document.querySelector('.chart-toolbar') as HTMLElement | null;

      if (!heatmapCard || !heatmapTitleControls || !chartCard || !chartHeader || !chartToolbar) {
        return {
          hasRequiredNodes: false,
          heatmapTitleOverflow: true,
          chartHeaderOverflow: true,
          chartToolbarOverflow: true,
          chartToolbarColumnCount: 0,
        };
      }

      const exceedsParent = (element: HTMLElement, parent: HTMLElement) => {
        const elementRect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        return elementRect.left < (parentRect.left - 1) || elementRect.right > (parentRect.right + 1);
      };

      return {
        hasRequiredNodes: true,
        heatmapTitleOverflow: exceedsParent(heatmapTitleControls, heatmapCard) || heatmapTitleControls.scrollWidth > (heatmapTitleControls.clientWidth + 1),
        chartHeaderOverflow: exceedsParent(chartHeader, chartCard) || chartHeader.scrollWidth > (chartHeader.clientWidth + 1),
        chartToolbarOverflow: exceedsParent(chartToolbar, chartCard) || chartToolbar.scrollWidth > (chartToolbar.clientWidth + 1),
        chartToolbarColumnCount: getComputedStyle(chartToolbar).gridTemplateColumns.split(' ').length,
      };
    });

    expect(overflow.hasRequiredNodes).toBe(true);
    expect(overflow.heatmapTitleOverflow).toBe(false);
    expect(overflow.chartHeaderOverflow).toBe(false);
    expect(overflow.chartToolbarOverflow).toBe(false);
    expect(overflow.chartToolbarColumnCount).toBe(2);
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

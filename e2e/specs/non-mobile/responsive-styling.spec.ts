import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import {
  setHideArchived,
  setLibraryLayout,
  setMediaTypeFilters,
  setSearchQuery,
  setTrackingStatusFilters,
  waitForLibraryItemCount,
  waitForLibraryLayout,
} from '../../helpers/library.js';
import { safeClick, waitForSelectorDisplayed } from '../../helpers/common.js';
import { clickHeatmapCell, getActivityChartRangeMetadata } from '../../helpers/dashboard.js';

describe('Responsive Styling CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await browser.setWindowSize(1280, 1200);
  });

  it('should hide nav controls on mobile width and iconify Log Activity on narrow mobile width', async () => {
    await browser.setWindowSize(740, 1200);
    await browser.waitUntil(async () => {
      const spacer = await $('#nav-spacer');
      return await spacer.isExisting() && (await spacer.getCSSProperty('display')).value === 'none';
    }, { timeout: 3000 });

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
    await browser.waitUntil(async () => {
      const text = await $('.activity-btn-text');
      return await text.isExisting() && (await text.getCSSProperty('display')).value === 'none';
    }, { timeout: 3000 });

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
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const stats = document.getElementById('stats-box-container');
        const heatmap = document.getElementById('heatmap-container');
        const charts = document.querySelectorAll('[data-dashboard-card="activity_mix"] .card, [data-dashboard-card="activity_flow"] .card');
        return stats && heatmap && charts.length >= 2
          && heatmap.getBoundingClientRect().top > (stats.getBoundingClientRect().top + 40)
          && charts[1].getBoundingClientRect().top > (charts[0].getBoundingClientRect().top + 40);
      });
    }, { timeout: 10000 });

    const stacked = await browser.execute(() => {
      const stats = document.getElementById('stats-box-container');
      const heatmap = document.getElementById('heatmap-container');
      const charts = document.querySelectorAll('[data-dashboard-card="activity_mix"] .card, [data-dashboard-card="activity_flow"] .card');
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

  it('should collapse the dashboard side panel into a cover rail and restore it at stacked widths', async () => {
    const SIDE_PANEL_TIMEOUT = 10000;

    const readSidePanel = async () => browser.execute(() => {
      const columns = document.getElementById('dashboard-columns');
      const column = document.getElementById('dashboard-left-column');
      const stats = document.getElementById('stats-box-container');
      const cover = document.querySelector<HTMLElement>('.quick-log-cover');
      if (!columns || !column || !stats || !cover) return null;

      return {
        columnWidth: column.getBoundingClientRect().width,
        coverWidth: cover.getBoundingClientRect().width,
        statsHidden: getComputedStyle(stats).display === 'none',
        isCollapsed: columns.classList.contains('is-side-panel-collapsed'),
      };
    });

    // The window resize is asynchronous and slow under a loaded parallel run, and both
    // layouts satisfy a naive "column is wide" check — the stacked column is far wider
    // than the expanded panel. Gate every resize on the viewport itself before asserting.
    const resizeViewportTo = async (width: number) => {
      await browser.setWindowSize(width, 1200);
      await browser.waitUntil(
        async () => Math.abs(await browser.execute(() => window.innerWidth) - width) <= 40,
        {
          timeout: SIDE_PANEL_TIMEOUT,
          timeoutMsg: `Viewport did not settle at ${width}px`,
        },
      );
    };

    const waitForSidePanel = async (
      predicate: (panel: NonNullable<Awaited<ReturnType<typeof readSidePanel>>>) => boolean,
      timeoutMsg: string,
    ) => {
      await browser.waitUntil(async () => {
        const panel = await readSidePanel();
        return panel !== null && predicate(panel);
      }, { timeout: SIDE_PANEL_TIMEOUT, timeoutMsg });
    };

    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);
    await resizeViewportTo(1280);
    await waitForSelectorDisplayed('#dashboard-side-panel-toggle');

    await waitForSidePanel(
      panel => panel.columnWidth > 200 && panel.columnWidth < 400 && !panel.statsHidden,
      'Dashboard side panel did not render at its expanded desktop width',
    );

    await safeClick('#dashboard-side-panel-toggle');
    await waitForSidePanel(
      panel => panel.columnWidth < 60 && panel.statsHidden,
      'Side panel did not collapse to the rail width',
    );

    const collapsed = await readSidePanel();
    expect(collapsed!.coverWidth).toBeLessThan(60);
    expect(collapsed!.coverWidth).toBeGreaterThan(20);

    await resizeViewportTo(1000);
    await waitForSidePanel(
      panel => !panel.statsHidden && panel.columnWidth > 400,
      'Stacked layout kept the rail instead of restoring the full side panel',
    );
    expect((await readSidePanel())!.isCollapsed).toBe(true);

    await resizeViewportTo(1280);
    await waitForSidePanel(
      panel => panel.columnWidth < 60 && panel.statsHidden,
      'Widening the window did not restore the collapsed rail',
    );

    await safeClick('#dashboard-side-panel-toggle');
    await waitForSidePanel(
      panel => panel.columnWidth > 200 && panel.columnWidth < 400,
      'Side panel did not expand again',
    );
  });

  it('should reflow weekday stats and keep highlights on a separate row', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);
    await clickHeatmapCell('2024-03-07');
    await browser.waitUntil(async () => (await getActivityChartRangeMetadata()).rangeStart === '2024-03-04', {
      timeout: 5000,
      timeoutMsg: 'Dashboard did not load the seeded activity week',
    });

    const readTotalsLayout = async () => browser.execute(() => {
      const grid = document.querySelector<HTMLElement>('#dashboard-card-grid');
      const primaryCards = [
        document.querySelector<HTMLElement>('.dashboard-weekday-card'),
        Array.from(document.querySelectorAll<HTMLElement>('.dashboard-card')).find(card => card.textContent?.includes('Weekly Stats')),
        Array.from(document.querySelectorAll<HTMLElement>('.dashboard-card')).find(card => card.textContent?.includes('Categories')),
      ];
      const highlights = document.querySelector<HTMLElement>('.dashboard-highlights-card');
      const radar = document.querySelector<SVGElement>('.dashboard-weekday-radar');
      if (!grid || primaryCards.some(card => !card) || !highlights) {
        return null;
      }

      const primaryRects = primaryCards.map(card => card!.getBoundingClientRect());
      const highlightsRect = highlights.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const rowCount = new Set(primaryRects.map(rect => Math.round(rect.top))).size;
      return {
        rowCount,
        weekdayFirst: primaryRects[0].left < primaryRects[1].left && primaryRects[0].left < primaryRects[2].left,
        weekdayOwnRow: primaryRects[0].bottom <= Math.min(primaryRects[1].top, primaryRects[2].top) + 1,
        remainingCardsShareRow: Math.abs(primaryRects[1].top - primaryRects[2].top) <= 1,
        highlightsBelowPrimary: highlightsRect.top > Math.max(...primaryRects.map(rect => rect.bottom)) - 1,
        gridOverflow: grid.scrollWidth > grid.clientWidth + 1,
        cardsInsideGrid: primaryRects.every(rect => rect.left >= gridRect.left - 1 && rect.right <= gridRect.right + 1),
        radarInsideCard: !radar || (() => {
          const radarRect = radar.getBoundingClientRect();
          const cardRect = primaryCards[0]!.getBoundingClientRect();
          return radarRect.left >= cardRect.left - 1 && radarRect.right <= cardRect.right + 1;
        })(),
      };
    });

    // The card grid is the window less the side panel and padding, and the three-abreast
    // tier needs 960px of grid, so this has to clear roughly 1336.
    await browser.setWindowSize(1400, 1200);
    await browser.waitUntil(async () => (await readTotalsLayout())?.rowCount === 1, {
      timeout: 5000,
      timeoutMsg: 'Dashboard totals did not form one desktop row',
    });
    const desktop = await readTotalsLayout();
    expect(desktop?.highlightsBelowPrimary).toBe(true);
    expect(desktop?.weekdayFirst).toBe(true);

    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('#toggle-metric-characters')?.click();
    });
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector<HTMLElement>('.dashboard-weekday-card')?.dataset.metric === 'characters'
    ), { timeout: 3000, timeoutMsg: 'Weekday distribution did not switch to characters' });
    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('#toggle-metric-time')?.click();
    });
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector<HTMLElement>('.dashboard-weekday-card')?.dataset.metric === 'minutes'
    ), { timeout: 3000, timeoutMsg: 'Weekday distribution did not switch back to time' });

    // 900px is the `medium` tier (769-1024), where cards are two across.
    await browser.setWindowSize(900, 1200);
    await browser.waitUntil(async () => {
      const layout = await readTotalsLayout();
      return layout?.rowCount === 2 && !layout.gridOverflow;
    }, {
      timeout: 5000,
      timeoutMsg: 'Dashboard totals did not wrap to two rows at the medium tier',
    });
    const medium = await readTotalsLayout();
    expect(medium?.weekdayOwnRow).toBe(true);
    expect(medium?.remainingCardsShareRow).toBe(true);
    expect(medium?.highlightsBelowPrimary).toBe(true);
    expect(medium?.gridOverflow).toBe(false);

    await browser.setWindowSize(390, 1200);
    await browser.waitUntil(async () => {
      const layout = await readTotalsLayout();
      return layout?.rowCount === 3 && !layout.gridOverflow;
    }, {
      timeout: 5000,
      timeoutMsg: 'Dashboard totals did not stack without overflow in compact mode',
    });
    const compact = await readTotalsLayout();
    expect(compact?.highlightsBelowPrimary).toBe(true);
    expect(compact?.gridOverflow).toBe(false);
    expect(compact?.cardsInsideGrid).toBe(true);
    expect(compact?.radarInsideCard).toBe(true);
  });

  it('should keep dashboard controls on a single row at the wide tier', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(1400, 1200);
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const cardsCluster = document.querySelector('[data-dashboard-controls-cluster="cards"]') as HTMLElement | null;
        const periodCluster = document.querySelector('[data-dashboard-controls-cluster="period"]') as HTMLElement | null;
        if (!cardsCluster || !periodCluster) return false;
        return Math.round(cardsCluster.getBoundingClientRect().top) === Math.round(periodCluster.getBoundingClientRect().top);
      });
    }, { timeout: 3000, timeoutMsg: 'Dashboard controls did not settle onto a single row at the wide tier' });

    const alignment = await browser.execute(() => {
      const heatmapCard = document.querySelector('#heatmap-container .card') as HTMLElement | null;
      const heatmapTitleControls = document.querySelector('.heatmap-title-controls') as HTMLElement | null;
      const chartCard = document.querySelector('[data-dashboard-card="controls"] .card') as HTMLElement | null;
      const chartTitleControls = document.querySelector('.activity-charts-title-controls') as HTMLElement | null;
      const controlsFields = document.querySelector('[data-dashboard-controls-fields]') as HTMLElement | null;
      const cardsCluster = document.querySelector('[data-dashboard-controls-cluster="cards"]') as HTMLElement | null;
      const periodCluster = document.querySelector('[data-dashboard-controls-cluster="period"]') as HTMLElement | null;

      if (!heatmapCard || !heatmapTitleControls || !chartCard || !chartTitleControls || !controlsFields || !cardsCluster || !periodCluster) {
        return {
          hasRequiredNodes: false,
          heatmapCenterOffset: Number.POSITIVE_INFINITY,
          chartTitleCenterOffset: Number.POSITIVE_INFINITY,
          clustersShareRow: false,
          controlsFieldsWidthRatio: Number.POSITIVE_INFINITY,
        };
      }

      const getCenterOffset = (element: HTMLElement, parent: HTMLElement) => {
        const elementRect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const elementCenter = elementRect.left + (elementRect.width / 2);
        const parentCenter = parentRect.left + (parentRect.width / 2);
        return Math.abs(elementCenter - parentCenter);
      };

      const controlsFieldsRect = controlsFields.getBoundingClientRect();
      const chartCardRect = chartCard.getBoundingClientRect();

      return {
        hasRequiredNodes: true,
        heatmapCenterOffset: getCenterOffset(heatmapTitleControls, heatmapCard),
        chartTitleCenterOffset: getCenterOffset(chartTitleControls, chartCard),
        clustersShareRow: Math.round(cardsCluster.getBoundingClientRect().top) === Math.round(periodCluster.getBoundingClientRect().top),
        controlsFieldsWidthRatio: controlsFieldsRect.width / chartCardRect.width,
      };
    });

    expect(alignment.hasRequiredNodes).toBe(true);
    expect(alignment.heatmapCenterOffset).toBeLessThan(16);
    expect(alignment.chartTitleCenterOffset).toBeLessThan(16);
    expect(alignment.clustersShareRow).toBe(true);
    expect(alignment.controlsFieldsWidthRatio).toBeGreaterThan(0.9);
    expect(alignment.controlsFieldsWidthRatio).toBeLessThan(1.02);
  });

  it('should wrap dashboard controls onto stacked rows without overflow at narrow app widths', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(650, 1200);
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const cardsCluster = document.querySelector('[data-dashboard-controls-cluster="cards"]') as HTMLElement | null;
        const periodCluster = document.querySelector('[data-dashboard-controls-cluster="period"]') as HTMLElement | null;
        if (!cardsCluster || !periodCluster) return false;
        return cardsCluster.getBoundingClientRect().top < periodCluster.getBoundingClientRect().top;
      });
    }, { timeout: 3000, timeoutMsg: 'Dashboard controls did not stack their clusters at the mobile tier' });

    const compactLayout = await browser.execute(() => {
      const chartCard = document.querySelector('[data-dashboard-card="controls"] .card') as HTMLElement | null;
      const controlsFields = document.querySelector('[data-dashboard-controls-fields]') as HTMLElement | null;

      if (!chartCard || !controlsFields) {
        return {
          hasRequiredNodes: false,
          controlsFieldsWidthRatio: Number.POSITIVE_INFINITY,
          controlsFieldsOverflow: true,
        };
      }

      const controlsFieldsRect = controlsFields.getBoundingClientRect();
      const chartCardRect = chartCard.getBoundingClientRect();

      return {
        hasRequiredNodes: true,
        controlsFieldsWidthRatio: controlsFieldsRect.width / chartCardRect.width,
        controlsFieldsOverflow: controlsFields.scrollWidth > (controlsFields.clientWidth + 1),
      };
    });

    expect(compactLayout.hasRequiredNodes).toBe(true);
    expect(compactLayout.controlsFieldsWidthRatio).toBeGreaterThan(0.9);
    expect(compactLayout.controlsFieldsOverflow).toBe(false);
  });

  it('should keep dashboard visualization headers inside their cards on narrow mobile widths', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);

    await browser.setWindowSize(390, 960);
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const cardsCluster = document.querySelector('[data-dashboard-controls-cluster="cards"]') as HTMLElement | null;
        const periodCluster = document.querySelector('[data-dashboard-controls-cluster="period"]') as HTMLElement | null;
        return Boolean(cardsCluster && periodCluster && cardsCluster.getBoundingClientRect().top < periodCluster.getBoundingClientRect().top);
      });
    }, { timeout: 3000 });

    const overflow = await browser.execute(() => {
      const heatmapCard = document.querySelector('#heatmap-container .card') as HTMLElement | null;
      const heatmapTitleControls = document.querySelector('.heatmap-title-controls') as HTMLElement | null;
      const chartCard = document.querySelector('[data-dashboard-card="controls"] .card') as HTMLElement | null;
      const controlsFields = document.querySelector('[data-dashboard-controls-fields]') as HTMLElement | null;

      if (!heatmapCard || !heatmapTitleControls || !chartCard || !controlsFields) {
        return {
          hasRequiredNodes: false,
          heatmapTitleOverflow: true,
          controlsFieldsOverflow: true,
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
        controlsFieldsOverflow: exceedsParent(controlsFields, chartCard) || controlsFields.scrollWidth > (controlsFields.clientWidth + 1),
      };
    });

    expect(overflow.hasRequiredNodes).toBe(true);
    expect(overflow.heatmapTitleOverflow).toBe(false);
    expect(overflow.controlsFieldsOverflow).toBe(false);
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

  it('should show more library covers when the grid is zoomed out', async () => {
    await browser.setWindowSize(1280, 1200);
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);
    await setLibraryLayout('grid');

    const resetZoom = $('#btn-grid-zoom-reset');
    await resetZoom.waitForDisplayed({ timeout: 10000 });
    await resetZoom.click();
    await waitForSelectorDisplayed('.media-grid-item', 10000);

    const readGridMetrics = async () => browser.execute(() => {
      const grid = document.getElementById('media-grid-container');
      const firstItem = document.querySelector<HTMLElement>('.media-grid-item');
      const zoomValue = document.getElementById('btn-grid-zoom-reset');
      if (!grid || !firstItem || !zoomValue) {
        return { cardWidth: 0, columnCount: 0, zoomValue: null };
      }

      return {
        cardWidth: firstItem.getBoundingClientRect().width,
        columnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
        zoomValue: zoomValue.textContent,
      };
    });

    await browser.waitUntil(async () => (await readGridMetrics()).zoomValue === '100%', {
      timeout: 3000,
      timeoutMsg: 'Library grid zoom did not reset to 100%',
    });
    const normalGrid = await readGridMetrics();

    for (const expectedZoom of ['90%', '80%', '70%']) {
      await $('#btn-grid-zoom-out').click();
      await browser.waitUntil(async () => (await readGridMetrics()).zoomValue === expectedZoom, {
        timeout: 3000,
        timeoutMsg: `Library grid zoom did not reach ${expectedZoom}`,
      });
    }

    const compactGrid = await readGridMetrics();
    expect(compactGrid.cardWidth).toBeLessThan(normalGrid.cardWidth);
    expect(compactGrid.columnCount).toBeGreaterThan(normalGrid.columnCount);

    await $('#btn-grid-zoom-reset').click();
    await browser.waitUntil(async () => (await readGridMetrics()).zoomValue === '100%', {
      timeout: 3000,
      timeoutMsg: 'Library grid zoom did not return to 100%',
    });
  });

  it('should preserve an unchanged filtered grid when navigating away and back', async () => {
    await browser.setWindowSize(1280, 1200);
    await navigateTo('media');
    await setLibraryLayout('grid');
    await setSearchQuery('呪術');
    await setMediaTypeFilters(['Manga']);
    await setTrackingStatusFilters(['Ongoing']);
    await setHideArchived(true);

    try {
      await waitForLibraryItemCount(1, {
        timeoutMsg: 'Combined library filters did not settle on one grid item',
      });
      const beforeNavigation = await browser.execute(() => {
        const root = document.getElementById('media-root');
        const item = document.querySelector<HTMLElement>('.media-grid-item[data-title="呪術廻戦"]');
        if (!root || !item) return null;
        item.dataset.navigationCacheMarker = 'preserved-filtered-grid';
        return root.dataset.libraryRequestId || '';
      });
      expect(beforeNavigation).not.toBeNull();

      await navigateTo('dashboard');
      await navigateTo('media');
      await browser.waitUntil(async () => browser.execute((previousRequestId) => {
        const root = document.getElementById('media-root');
        return Boolean(root?.dataset.libraryRequestId
          && root.dataset.libraryRequestId !== previousRequestId);
      }, beforeNavigation), {
        timeout: 10000,
        timeoutMsg: 'Library background snapshot did not finish after navigation',
      });

      const preserved = await browser.execute(() => {
        const markedItem = document.querySelector<HTMLElement>(
          '.media-grid-item[data-navigation-cache-marker="preserved-filtered-grid"]',
        );
        return {
          markerPresent: Boolean(markedItem),
          titles: Array.from(
            document.querySelectorAll<HTMLElement>('.media-grid-item'),
            item => item.dataset.title || '',
          ),
          searchQuery: document.querySelector<HTMLInputElement>('#grid-search-filter')?.value || '',
        };
      });
      expect(preserved.markerPresent).toBe(true);
      expect(preserved.titles).toEqual(['呪術廻戦']);
      expect(preserved.searchQuery).toBe('呪術');
    } finally {
      await setSearchQuery('');
      await setTrackingStatusFilters([]);
      await setMediaTypeFilters([]);
      await setHideArchived(false);
    }
  });

  it('should apply mobile media-detail layout structure and style hooks', async () => {
    await browser.setWindowSize(952, 1200);
    await navigateTo('media');
    expect(await verifyActiveView('media')).toBe(true);

    await waitForSelectorDisplayed('.media-grid-item', 10000);
    await safeClick('.media-grid-item');

    await waitForSelectorDisplayed('#media-title', 10000);

    const showMediaHeader = async () => {
      // Chromium preserves scroll anchors across view changes and responsive
      // reflows. Put the controls in view before asking which element is on top.
      await browser.execute(() => {
        const mainContent = document.querySelector<HTMLElement>('.main-content');
        if (mainContent) mainContent.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await browser.waitUntil(async () => browser.execute(() => {
        const header = document.getElementById('media-detail-header');
        if (!header) return false;
        const rect = header.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }), { timeout: 3000, timeoutMsg: 'Media detail controls did not return to the viewport' });
    };

    await showMediaHeader();

    const compactDesktopLayout = await browser.execute(() => {
      const topBar = document.querySelector<HTMLElement>('.app-nav-bar');
      const coverColumn = document.getElementById('media-cover-column');
      const headerControls = [
        document.getElementById('media-prev'),
        document.getElementById('btn-media-overflow'),
        document.getElementById('media-next'),
      ];
      if (!topBar || !coverColumn) return null;

      const headerControlsReceivePointerInput = headerControls.every((control) => {
        if (!(control instanceof HTMLElement)) return false;
        const rect = control.getBoundingClientRect();
        const topmostElement = document.elementFromPoint(
          rect.left + (rect.width / 2),
          rect.top + (rect.height / 2),
        );
        return topmostElement === control || control.contains(topmostElement);
      });

      return {
        bannerGap: coverColumn.getBoundingClientRect().top - topBar.getBoundingClientRect().bottom,
        headerControlsReceivePointerInput,
      };
    });
    expect(compactDesktopLayout).not.toBeNull();
    expect(compactDesktopLayout?.bannerGap).toBeGreaterThanOrEqual(12);
    expect(compactDesktopLayout?.headerControlsReceivePointerInput).toBe(true);

    await browser.setWindowSize(760, 1200);
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const header = document.getElementById('media-detail-header');
        return header && getComputedStyle(header).flexWrap === 'wrap';
      });
    }, { timeout: 3000 });

    await showMediaHeader();

    const mediaLayout = await browser.execute(() => {
      const coverColumn = document.getElementById('media-cover-column');
      const backSlot = document.getElementById('media-back-slot');
      const header = document.getElementById('media-detail-header');
      const titleGroup = document.getElementById('media-title-group');
      const overflowRoot = document.getElementById('media-overflow-root');
      const statsGrid = document.getElementById('media-stats-grid');
      const contentArea = document.getElementById('media-content-area');
      const headerControls = [
        document.getElementById('media-prev'),
        document.getElementById('btn-media-overflow'),
        document.getElementById('media-next'),
      ];

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
          headerControlsReceivePointerInput: false,
        };
      }

      const headerControlsReceivePointerInput = headerControls.every((control) => {
        if (!(control instanceof HTMLElement)) return false;
        const rect = control.getBoundingClientRect();
        const topmostElement = document.elementFromPoint(
          rect.left + (rect.width / 2),
          rect.top + (rect.height / 2),
        );
        return topmostElement === control || control.contains(topmostElement);
      });

      return {
        hasRequiredNodes: true,
        coverPosition: getComputedStyle(coverColumn).position,
        backSlotDisplay: getComputedStyle(backSlot).display,
        headerWrap: getComputedStyle(header).flexWrap,
        titleGroupDisplay: getComputedStyle(titleGroup).display,
        overflowRootDisplay: getComputedStyle(overflowRoot).display,
        statsColumnCount: getComputedStyle(statsGrid).gridTemplateColumns.split(' ').length,
        contentPaddingTop: getComputedStyle(contentArea).paddingTop,
        headerControlsReceivePointerInput,
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
    expect(mediaLayout.headerControlsReceivePointerInput).toBe(true);

    await $('#btn-media-overflow').click();
    await waitForSelectorDisplayed('#btn-delete-media-detail');

    await $('#btn-media-overflow').click();
    await browser.waitUntil(async () => !(await $('#btn-delete-media-detail').isExisting()), {
      timeout: 3000,
      timeoutMsg: 'Media actions menu did not close before testing navigation',
    });

    const initialMediaIndex = await $('#media-select').getValue();
    await $('#media-next').click();
    await browser.waitUntil(async () => (await $('#media-select').getValue()) !== initialMediaIndex, {
      timeout: 3000,
      timeoutMsg: 'Next media control did not change the selected media at mobile width',
    });

    await $('#media-prev').click();
    await browser.waitUntil(async () => (await $('#media-select').getValue()) === initialMediaIndex, {
      timeout: 3000,
      timeoutMsg: 'Previous media control did not restore the selected media at mobile width',
    });
  });
});

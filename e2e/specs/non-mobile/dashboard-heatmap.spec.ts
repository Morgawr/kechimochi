import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import {
  HEATMAP_SELECTOR,
  clickHeatmapCell,
  getActivityChartRangeMetadata,
  isHeatmapMonthCalendarShown,
  selectActivityChartTimeRange,
  waitForHeatmapReady,
} from '../../helpers/dashboard.js';

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 400;
const WINDOW_HEIGHT = 1200;

type EdgesByDate = Record<string, string>;

async function readVisibleEdges(attribute: 'selectionEdges' | 'previewEdges'): Promise<EdgesByDate> {
  return browser.execute((heatmapSelector, datasetKey) => {
    const edges: Record<string, string> = {};
    for (const day of document.querySelectorAll<HTMLElement>(`${heatmapSelector} [data-date]`)) {
      const rect = day.getBoundingClientRect();
      const value = day.dataset[datasetKey];
      if (rect.width > 0 && rect.height > 0 && value) edges[day.dataset.date!] = value;
    }
    return edges;
  }, HEATMAP_SELECTOR, attribute);
}

async function waitForRange(start: string, end: string): Promise<void> {
  await browser.waitUntil(async () => {
    const metadata = await getActivityChartRangeMetadata();
    return metadata.rangeStart === start && metadata.rangeEnd === end;
  }, { timeout: 5000, interval: 100, timeoutMsg: `Dashboard range did not become ${start}..${end}` });
}

describe('Dashboard heatmap CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await browser.setWindowSize(DESKTOP_WIDTH, WINDOW_HEIGHT);
  });

  it('should outline the selected week on the year grid and preview a hovered week', async () => {
    await browser.setWindowSize(DESKTOP_WIDTH, WINDOW_HEIGHT);
    await navigateTo('dashboard');
    await selectActivityChartTimeRange('7');

    await clickHeatmapCell('2024-03-07');
    await waitForRange('2024-03-04', '2024-03-10');

    const selection = await readVisibleEdges('selectionEdges');
    expect(Object.keys(selection).sort()).toEqual([
      '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08', '2024-03-09', '2024-03-10',
    ]);
    expect(selection['2024-03-04']).toBe('top right left');
    expect(selection['2024-03-10']).toBe('right bottom left');

    const selectedMonthLabelSelector = `${HEATMAP_SELECTOR} [data-month-index][data-selected]`;
    expect(await $$(selectedMonthLabelSelector).length).toBe(1);
    expect(await $(selectedMonthLabelSelector).isDisplayed()).toBe(true);
    expect(await $(selectedMonthLabelSelector).getText()).toBe('Mar');
    const [labelLeft, firstMarchWeekLeft] = await browser.execute((labelSelector, cellSelector) => [
      document.querySelector(labelSelector)!.getBoundingClientRect().left,
      document.querySelector(cellSelector)!.getBoundingClientRect().left,
    ], selectedMonthLabelSelector, `${HEATMAP_SELECTOR} [data-date="2024-03-04"]`);
    expect(Math.abs(labelLeft - firstMarchWeekLeft)).toBeLessThan(1);

    await $(`${HEATMAP_SELECTOR} [data-date="2024-03-13"]`).moveTo();
    await browser.waitUntil(async () => (await readVisibleEdges('previewEdges'))['2024-03-11'] === 'top right left', {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Hovering a day did not preview its week',
    });
  });

  it('should show a month calendar with neighbouring days on mobile width and select a month from it', async () => {
    await browser.setWindowSize(MOBILE_WIDTH, WINDOW_HEIGHT);
    await waitForHeatmapReady();
    expect(await isHeatmapMonthCalendarShown()).toBe(true);
    await selectActivityChartTimeRange('30');

    await clickHeatmapCell('2024-02-18');
    await waitForRange('2024-02-01', '2024-02-29');

    expect(await $(`${HEATMAP_SELECTOR} button[data-date="2024-01-31"]`).isDisplayed()).toBe(true);
    const selection = await readVisibleEdges('selectionEdges');
    expect(selection['2024-02-01']).toBe('top left');
    expect(selection['2024-01-31']).toBeUndefined();
    expect(Object.keys(selection).every(date => date.startsWith('2024-02'))).toBe(true);
  });
});

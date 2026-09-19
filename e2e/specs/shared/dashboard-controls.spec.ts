import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { setSelect } from '../../helpers/form-controls.js';
import { getActivityChartRangeMetadata, ACTIVITY_FLOW_SELECTOR, DASHBOARD_CONTROLS_SELECTOR } from '../../helpers/dashboard.js';

interface ChartSnapshot {
  chartType: string | null;
  groupBy: string | null;
  metric: string | null;
  labels: string[];
  totals: number[];
  rangeStart: string;
  rangeEnd: string;
}

async function getChartSnapshot(): Promise<ChartSnapshot> {
  const canvas = $('#barChart');
  await canvas.waitForExist({ timeout: 5000 });
  let snapshot: ChartSnapshot | null = null;
  await browser.waitUntil(async () => {
    snapshot = await browser.execute(() => {
      const root = document.querySelector<HTMLElement>('.dashboard-root');
      const controls = root?.querySelector<HTMLElement>('[data-dashboard-card="controls"]');
      const chart = root?.querySelector<HTMLCanvasElement>('[data-dashboard-card="activity_flow"] #barChart');
      const requestId = root?.dataset.dashboardRequestId;
      // Controls update before the range response and lazy Chart.js render.
      // Read one coherent snapshot only after the current render completes.
      if (!requestId || controls?.dataset.dashboardRequestId !== requestId
          || !chart?.dataset.seriesLabels || !chart.dataset.seriesTotals) return null;
      return {
        chartType: chart.dataset.chartType ?? null,
        groupBy: chart.dataset.groupBy ?? null,
        metric: chart.dataset.metric ?? null,
        labels: JSON.parse(chart.dataset.seriesLabels) as string[],
        totals: JSON.parse(chart.dataset.seriesTotals) as number[],
        rangeStart: controls.dataset.rangeStart ?? '',
        rangeEnd: controls.dataset.rangeEnd ?? '',
      };
    });
    return snapshot !== null;
  }, {
    timeout: 5000,
    interval: 100,
    timeoutMsg: 'Dashboard chart did not finish rendering the current range',
  });
  return snapshot!;
}

function totalsByLabel(snapshot: ChartSnapshot): Record<string, number> {
  expect(snapshot.totals).toHaveLength(snapshot.labels.length);
  return Object.fromEntries(snapshot.labels.map((label, index) => [label, snapshot.totals[index]]));
}

async function clickChartToggle(groupSelector: string): Promise<void> {
  const clicked = await browser.execute((targetSelector) => {
    const group = document.querySelector(targetSelector);
    const secondOption = group?.querySelectorAll<HTMLButtonElement>('.toggle-option').item(1);
    if (!secondOption) return false;
    secondOption.click();
    return true;
  }, groupSelector);
  expect(clicked).toBe(true);
}

describe('CUJ: Dashboard Analytics Controls', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('dashboard');
  });

  it('updates real chart datasets and persists chart and grouping preferences', async () => {
    await setSelect('#select-time-range', { value: '30' });
    await getActivityChartRangeMetadata();
    const initial = await getChartSnapshot();
    expect(initial.chartType).toBe('bar');
    expect(initial.groupBy).toBe('activity_type');
    expect(initial.metric).toBe('minutes');
    expect(initial.labels.length).toBeGreaterThan(0);
    expect(initial.rangeStart).toBe('2024-03-01');
    expect(initial.rangeEnd).toBe('2024-03-31');
    expect(totalsByLabel(initial)).toEqual({ Reading: 160, Playing: 60, Watching: 24 });

    await clickChartToggle('#toggle-chart-type');
    await browser.waitUntil(async () => (await getChartSnapshot()).chartType === 'line');

    await clickChartToggle('#toggle-group-by');
    await browser.waitUntil(async () => (await getChartSnapshot()).groupBy === 'log_name');
    const groupedByName = await getChartSnapshot();
    expect(groupedByName.labels).not.toEqual(initial.labels);
    expect(totalsByLabel(groupedByName)).toEqual({
      '本好きの下剋上': 70,
      'ある魔女が死ぬまで': 40,
      '葬送のフリーレン': 24,
      '薬屋のひとりごと': 50,
      'ペルソナ5': 60,
    });

    await setSelect('#select-time-range', { value: '7' });
    await getActivityChartRangeMetadata();
    expect(await $(ACTIVITY_FLOW_SELECTOR).getAttribute('data-chart-empty')).toBe('true');

    await setSelect('#select-time-range', { value: '30' });
    await getActivityChartRangeMetadata();
    expect(await $(ACTIVITY_FLOW_SELECTOR).getAttribute('data-chart-empty')).toBe('false');

    await clickChartToggle('#toggle-metric');
    await browser.waitUntil(async () => (await getChartSnapshot()).metric === 'characters');
    const characters = await getChartSnapshot();
    expect(characters.totals).toEqual([]);
    expect(await $(ACTIVITY_FLOW_SELECTOR).getAttribute('data-chart-empty')).toBe('true');

    expect(await $(DASHBOARD_CONTROLS_SELECTOR).getAttribute('data-time-range-days')).toBe('30');
    await $('#btn-chart-prev').click();
    expect(await $(DASHBOARD_CONTROLS_SELECTOR).getAttribute('data-time-range-offset')).toBe('1');
    expect(await $('#btn-chart-next').isEnabled()).toBe(true);

    await setSelect('#select-time-range', { value: '0' });
    expect(await $('#btn-chart-prev').isEnabled()).toBe(false);
    expect(await $('#btn-chart-next').isEnabled()).toBe(false);

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('dashboard');
    const afterReload = await getChartSnapshot();
    expect(afterReload.chartType).toBe('line');
    expect(afterReload.groupBy).toBe('log_name');
    expect(afterReload.metric).toBe('characters');
    expect(await $(DASHBOARD_CONTROLS_SELECTOR).getAttribute('data-time-range-days')).toBe('0');
  });
});

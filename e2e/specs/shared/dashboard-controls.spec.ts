import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { setSelect } from '../../helpers/form-controls.js';

interface ChartSnapshot {
  chartType: string | null;
  groupBy: string | null;
  metric: string | null;
  labels: string[];
  totals: number[];
}

async function getChartSnapshot(): Promise<ChartSnapshot> {
  const canvas = $('#barChart');
  await canvas.waitForDisplayed({ timeout: 5000 });
  return {
    chartType: await canvas.getAttribute('data-chart-type'),
    groupBy: await canvas.getAttribute('data-group-by'),
    metric: await canvas.getAttribute('data-metric'),
    labels: JSON.parse((await canvas.getAttribute('data-series-labels')) || '[]') as string[],
    totals: JSON.parse((await canvas.getAttribute('data-series-totals')) || '[]') as number[],
  };
}

async function clickChartToggle(selector: string): Promise<void> {
  const clicked = await browser.execute((targetSelector) => {
    const input = document.querySelector(targetSelector);
    if (!(input instanceof HTMLInputElement)) return false;
    input.click();
    return true;
  }, selector);
  expect(clicked).toBe(true);
}

describe('CUJ: Dashboard Analytics Controls', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('dashboard');
  });

  it('updates real chart datasets and persists chart and grouping preferences', async () => {
    await setSelect('#select-time-range', { value: '30' });
    const initial = await getChartSnapshot();
    expect(initial.chartType).toBe('bar');
    expect(initial.groupBy).toBe('activity_type');
    expect(initial.metric).toBe('minutes');
    expect(initial.labels.length).toBeGreaterThan(0);

    await clickChartToggle('#toggle-chart-type');
    await browser.waitUntil(async () => (await getChartSnapshot()).chartType === 'line');

    await clickChartToggle('#toggle-group-by');
    await browser.waitUntil(async () => (await getChartSnapshot()).groupBy === 'log_name');
    const groupedByName = await getChartSnapshot();
    expect(groupedByName.labels).not.toEqual(initial.labels);

    await clickChartToggle('#toggle-metric');
    await browser.waitUntil(async () => (await getChartSnapshot()).metric === 'characters');
    const characters = await getChartSnapshot();
    expect(characters.totals).not.toEqual(groupedByName.totals);

    expect(await $('#activity-charts-grid').getAttribute('data-time-range-days')).toBe('30');
    await $('#btn-chart-prev').click();
    expect(await $('#activity-charts-grid').getAttribute('data-time-range-offset')).toBe('1');
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
  });
});

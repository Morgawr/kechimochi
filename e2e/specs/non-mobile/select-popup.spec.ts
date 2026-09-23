import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { requireFinePointer } from '../../helpers/library.js';
import { safeClick } from '../../helpers/common.js';
import { getSelectValue, setSelect } from '../../helpers/form-controls.js';
import { getActivityChartRangeMetadata } from '../../helpers/dashboard.js';

const PERIOD_SELECT = '#select-time-range';
const PERIOD_LISTBOX = '[role="listbox"][aria-labelledby="select-time-range-label"]';
const WIDGETS_TRIGGER = '#dashboard-cards-menu-button';
const WIDGETS_PANEL = '[role="group"][aria-label="Displayed Widgets"]';

async function openPeriodPopup(): Promise<void> {
  await safeClick(PERIOD_SELECT);
  await $(PERIOD_LISTBOX).waitForDisplayed({ timeout: 3000 });
}

describe('Desktop/Web: themed select popup', () => {
  let initialPeriod: string | null = null;

  before(async () => {
    await waitForAppReady();
    await navigateTo('dashboard');
    await requireFinePointer();
    initialPeriod = await getSelectValue(PERIOD_SELECT);
  });

  afterEach(async () => {
    await browser.keys('Escape');
  });

  after(async () => {
    if (initialPeriod !== null) await setSelect(PERIOD_SELECT, { value: initialPeriod });
  });

  it('should open a themed listbox instead of the native picker', async () => {
    await openPeriodPopup();

    expect(await $(PERIOD_SELECT).getAttribute('aria-expanded')).toBe('true');
  });

  it('should apply the picked option to the select and the dashboard', async () => {
    const targetPeriod = initialPeriod === '365' ? '30' : '365';
    await openPeriodPopup();

    await safeClick(`${PERIOD_LISTBOX} [role="option"][data-value="${targetPeriod}"]`);

    await $(PERIOD_LISTBOX).waitForExist({ reverse: true, timeout: 3000 });
    expect(await getSelectValue(PERIOD_SELECT)).toBe(targetPeriod);
    await browser.waitUntil(
      async () => (await getActivityChartRangeMetadata()).timeRangeDays === targetPeriod,
      { timeout: 10000, timeoutMsg: `Dashboard range did not switch to ${targetPeriod} days` },
    );
  });

  it('should close on Escape without changing the value', async () => {
    const valueBefore = await getSelectValue(PERIOD_SELECT);
    await openPeriodPopup();

    await browser.keys('ArrowDown');
    await browser.keys('Escape');

    await $(PERIOD_LISTBOX).waitForExist({ reverse: true, timeout: 3000 });
    expect(await getSelectValue(PERIOD_SELECT)).toBe(valueBefore);
  });

  it('should open the widgets multiselect with one click while the select popup is open', async () => {
    await openPeriodPopup();

    await safeClick(WIDGETS_TRIGGER);

    await $(WIDGETS_PANEL).waitForDisplayed({ timeout: 3000 });
    expect(await $(PERIOD_LISTBOX).isExisting()).toBe(false);
  });
});

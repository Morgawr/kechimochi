import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';

const PERIOD_SELECT = '#select-time-range';

describe('Android: selects keep the native picker', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('dashboard');
    await $(PERIOD_SELECT).waitForExist({ timeout: 10000 });
  });

  it('should report a touch primary pointer to the WebView', async () => {
    const isPointerFine = await browser.execute(() => globalThis.matchMedia('(pointer: fine)').matches);

    expect(isPointerFine).toBe(false);
  });

  it('should not intercept a press on a select', async () => {
    const result = await browser.execute((selector) => {
      const select = document.querySelector<HTMLSelectElement>(selector);
      if (!select) return null;
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
      select.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        hasListbox: document.querySelector('[role="listbox"]') !== null,
      };
    }, PERIOD_SELECT);

    expect(result).toEqual({ defaultPrevented: false, hasListbox: false });
  });
});

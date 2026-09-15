import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import {
  addMedia,
  getActiveLibraryContainerSelector,
  getActiveMediaItemSelector,
  isMediaNotVisible,
  requireFinePointer,
} from '../../helpers/library.js';
import { backToGrid } from '../../helpers/media-detail.js';
import { clickMenuItem, confirmAction, safeClick } from '../../helpers/common.js';
import { setSelect } from '../../helpers/form-controls.js';

async function markLibraryContainer(): Promise<void> {
  const selector = await getActiveLibraryContainerSelector();
  await browser.execute((sel) => {
    const el = document.querySelector(sel as string) as (HTMLElement & Record<string, unknown>) | null;
    if (el) el.__e2eRebuildMarker = true;
  }, selector);
}

async function libraryContainerHasMarker(): Promise<boolean> {
  const selector = await getActiveLibraryContainerSelector();
  return browser.execute((sel) => {
    const el = document.querySelector(sel as string) as (HTMLElement & Record<string, unknown>) | null;
    return Boolean(el?.__e2eRebuildMarker);
  }, selector);
}

async function openContextMenuFor(title: string): Promise<void> {
  const selector = await getActiveMediaItemSelector(title);
  await $(selector).waitForDisplayed({ timeout: 5000 });
  await browser.execute((sel) => {
    const el = document.querySelector(sel as string) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  }, selector);
  await $('[role="menu"]').waitForDisplayed({ timeout: 3000 });
}

async function libraryItemOrder(): Promise<string[]> {
  const itemSelector = await getActiveMediaItemSelector();
  const titles: string[] = [];
  for (const element of await $$(itemSelector)) {
    titles.push((await element.getAttribute('data-title')) || '');
  }
  return titles;
}

describe('Desktop/Web: Library right-click context menu', () => {
  const suffix = Date.now();
  const firstTitle = `Context Menu First ${suffix}`;
  const secondTitle = `Context Menu Second ${suffix}`;
  const thirdTitle = `Context Menu Third ${suffix}`;

  before(async () => {
    await waitForAppReady();
    await navigateTo('media');
    await requireFinePointer();
    await addMedia(firstTitle, 'Reading', 'Manga');
    await backToGrid();
    await addMedia(secondTitle, 'Reading', 'Manga');
    await backToGrid();
    await addMedia(thirdTitle, 'Reading', 'Manga');
    await backToGrid();
  });

  it('opens with the expected items and closes on Escape', async () => {
    await openContextMenuFor(firstTitle);

    const menu = $('[role="menu"]');
    expect(await menu.getAttribute('aria-label')).toBe(`Actions for ${firstTitle}`);
    expect(await menu.$('aria/Add log').isDisplayed()).toBe(true);
    expect(await menu.$('aria/Add milestone').isDisplayed()).toBe(true);
    expect(await menu.$('aria/Mark complete').isDisplayed()).toBe(true);
    expect(await menu.$('aria/Archive').isDisplayed()).toBe(true);
    expect(await menu.$('aria/Delete').isDisplayed()).toBe(true);

    await browser.keys('Escape');
    await menu.waitForExist({ reverse: true, timeout: 3000 });
  });

  it('offers New media when right-clicking outside any card', async () => {
    const containerSelector = await getActiveLibraryContainerSelector();
    await browser.execute((sel) => {
      const el = document.querySelector(sel as string) as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom - 4,
      }));
    }, containerSelector);

    const menu = $('[role="menu"]');
    await menu.waitForDisplayed({ timeout: 3000 });
    expect(await menu.getAttribute('aria-label')).toBe('Library actions');
    expect(await menu.$('aria/New media').isDisplayed()).toBe(true);

    await browser.keys('Escape');
    await menu.waitForExist({ reverse: true, timeout: 3000 });
  });

  it('marks a card complete in place, matching the order a full re-render produces', async () => {
    await safeClick('#btn-toggle-sort');
    await safeClick('#btn-add-sort-level');
    await setSelect('.media-sort-level-select[data-level-index="0"]', { value: 'builtin:trackingStatus' });
    await safeClick('.media-sort-direction-option[data-level-index="0"][data-direction="ascending"]');
    await safeClick('#btn-toggle-sort');

    await markLibraryContainer();
    const orderBefore = await libraryItemOrder();
    const completedTitle = orderBefore.indexOf(firstTitle) < orderBefore.indexOf(secondTitle)
      ? firstTitle
      : secondTitle;

    await openContextMenuFor(completedTitle);
    await clickMenuItem('aria/Mark complete');

    let lastObservedOrder: string[] = orderBefore;
    await browser.waitUntil(async () => {
      lastObservedOrder = await libraryItemOrder();
      return lastObservedOrder.indexOf(completedTitle) !== orderBefore.indexOf(completedTitle);
    }, { timeout: 8000 }).catch(() => {
      throw new Error(
        `Completing a media did not move its card under the status sort.\n`
        + `  completed: ${completedTitle}\n  before: ${orderBefore.join(' | ')}\n  after:  ${lastObservedOrder.join(' | ')}`,
      );
    });

    expect(await libraryContainerHasMarker()).toBe(true);

    const orderAfterInPlaceMove = lastObservedOrder;
    await navigateTo('dashboard');
    await navigateTo('media');
    await browser.waitUntil(
      async () => (await libraryItemOrder()).length === orderAfterInPlaceMove.length,
      { timeout: 8000, timeoutMsg: 'Library did not finish re-rendering after navigating back' },
    );
    expect(await libraryItemOrder()).toEqual(orderAfterInPlaceMove);
  });

  it('deletes a card from the library via the context menu', async () => {
    await openContextMenuFor(thirdTitle);
    await clickMenuItem('aria/Delete');
    await confirmAction(true);

    await browser.waitUntil(() => isMediaNotVisible(thirdTitle), {
      timeout: 8000,
      timeoutMsg: 'Deleted media card was still visible',
    });
  });
});

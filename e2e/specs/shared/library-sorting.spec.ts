import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import {
  waitForLibraryDisplayed,
  waitForLibraryItemCount,
  getActiveMediaItemSelector,
} from '../../helpers/library.js';
import { safeClick } from '../../helpers/common.js';
import { setSelect } from '../../helpers/form-controls.js';

const SORT_PANEL_TOGGLE = '#btn-toggle-sort';
const ADD_SORT_LEVEL = '#btn-add-sort-level';
const FIRST_LEVEL_SELECT = '.media-sort-level-select[data-level-index="0"]';
const FIRST_LEVEL_ASCENDING = '.media-sort-direction-option[data-level-index="0"][data-direction="ascending"]';
// The <input> itself is visually hidden behind the styled slider, so the label is the clickable hook.
const GROUP_BY_TYPE_SWITCH = '#sort-group-by-type-switch';
const SECTION_HEADER = '.media-library-section-header';

/** Titles in the order the active layout currently renders them. */
async function getRenderedTitles(): Promise<string[]> {
  const items = $$(await getActiveMediaItemSelector());
  const titles = await items.map((item) => item.getAttribute('data-title'));
  return titles.filter((title): title is string => Boolean(title));
}

async function openLibrary() {
  await navigateTo('media');
  await waitForLibraryDisplayed();
  await waitForLibraryItemCount(count => count > 0, {
    timeoutMsg: 'Media items did not render in time',
  });
}

async function sortByTitleAscending() {
  await safeClick(SORT_PANEL_TOGGLE);
  await safeClick(ADD_SORT_LEVEL);
  await setSelect(FIRST_LEVEL_SELECT, { value: 'builtin:title' });
  await safeClick(FIRST_LEVEL_ASCENDING);
}

describe('Library sorting', () => {
  it('keeps an applied sort after reloading the app', async () => {
    await waitForAppReady();
    await openLibrary();

    const defaultOrder = await getRenderedTitles();
    expect(defaultOrder.length).toBeGreaterThan(1);

    await sortByTitleAscending();

    // The fixture's default order is recency-based, so sorting by title must move something.
    await browser.waitUntil(async () => {
      const current = await getRenderedTitles();
      return current.length === defaultOrder.length && current.join('|') !== defaultOrder.join('|');
    }, { timeout: 8000, timeoutMsg: 'Sorting by title did not reorder the library' });

    const sortedOrder = await getRenderedTitles();

    // The real assertion: the sort survives a full app restart, which is the only
    // place the JSON-array setting round-trips through the database and transport.
    await browser.refresh();
    await waitForAppReady();
    await openLibrary();

    expect(await getRenderedTitles()).toEqual(sortedOrder);
  });

  it('renders media type section headers when grouping is enabled', async () => {
    await waitForAppReady();
    await openLibrary();

    await safeClick(SORT_PANEL_TOGGLE);
    // Clicking is deliberate: the switch's change handler re-renders the whole header, which
    // replaces the input an in-page setCheckbox would be verifying.
    await safeClick(GROUP_BY_TYPE_SWITCH);

    // Headers are emitted into the same incremental batcher as the items, so this
    // also proves the flattened header/item stream survives real async chunking.
    const firstHeader = $(SECTION_HEADER);
    await firstHeader.waitForDisplayed({
      timeout: 8000,
      timeoutMsg: 'No media type section header rendered with grouping enabled',
    });
    expect(await firstHeader.getText()).not.toBe('');
  });
});
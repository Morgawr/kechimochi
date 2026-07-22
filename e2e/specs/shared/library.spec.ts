import { waitForAppReady } from '../../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
  verifyViewNotBroken,
} from '../../helpers/navigation.js';
import {
  setSearchQuery,
  setMediaTypeFilters,
  setTrackingStatusFilters,
  setHideArchived,
  waitForLibraryItemCount,
  waitForListCount,
  setLibraryLayout,
  isMediaVisible,
  isMediaNotVisible,
  getMediaItemText,
  clickMediaItem,
  getActiveMediaItemSelector,
} from '../../helpers/library.js';
import { safeClick, takeAndCompareScreenshot } from '../../helpers/common.js';
import { backToLibrary } from '../../helpers/media-detail.js';

async function waitForDetailTitle(title: string) {
  await browser.waitUntil(async () => {
    return (await $('#media-title').getText().catch(() => '')) === title;
  }, {
    timeout: 5000,
    timeoutMsg: `Expected media detail title to become "${title}"`,
  });
}

async function resetLibraryFilters() {
  await setSearchQuery('');
  await setTrackingStatusFilters([]);
  await setMediaTypeFilters([]);
  await setHideArchived(false);
}

async function runSharedFilterAssertions() {
  await setSearchQuery('呪術');
  expect(await isMediaVisible('呪術廻戦')).toBe(true);
  expect(await isMediaNotVisible('ペルソナ5')).toBe(true);

  await setSearchQuery('');
  expect(await isMediaVisible('ペルソナ5')).toBe(true);

  await setMediaTypeFilters(['Manga', 'Visual Novel']);
  expect(await isMediaVisible('呪術廻戦')).toBe(true);
  expect(await isMediaVisible('ダンジョン飯')).toBe(true);
  expect(await isMediaVisible('STEINS;GATE')).toBe(true);
  expect(await isMediaVisible('WHITE ALBUM 2')).toBe(true);
  expect(await isMediaNotVisible('ペルソナ5')).toBe(true);
  expect(await isMediaNotVisible('薬屋のひとりごと')).toBe(true);

  await setTrackingStatusFilters(['Ongoing', 'Paused']);
  expect(await isMediaVisible('呪術廻戦')).toBe(true);
  expect(await isMediaVisible('WHITE ALBUM 2')).toBe(true);
  expect(await isMediaNotVisible('STEINS;GATE')).toBe(true);
  expect(await isMediaNotVisible('ダンジョン飯')).toBe(true);
  expect(await isMediaNotVisible('葬送のフリーレン')).toBe(true);

  await setSearchQuery('WHITE');
  expect(await isMediaVisible('WHITE ALBUM 2')).toBe(true);
  expect(await isMediaNotVisible('呪術廻戦')).toBe(true);

  await setSearchQuery('');
  await setTrackingStatusFilters([]);
  await setMediaTypeFilters(['Manga']);
  expect(await isMediaVisible('呪術廻戦')).toBe(true);
  expect(await isMediaVisible('ダンジョン飯')).toBe(true);

  await setHideArchived(true);
  expect(await isMediaVisible('呪術廻戦')).toBe(true);
  expect(await isMediaNotVisible('ダンジョン飯')).toBe(true);
}

describe('Media Grid CUJ', () => {
  before(async () => {
    await waitForAppReady();
    await navigateTo('media');
  });

  it('should navigate to the media view', async () => {
    expect(await verifyActiveView('media')).toBe(true);
  });

  it('should display media items from fixture data', async () => {
    await waitForLibraryItemCount(count => count > 0, { timeoutMsg: 'Media items did not render in time' });
  });

  it('should display a status indicator on media items', async () => {
    const itemSelector = await getActiveMediaItemSelector();
    // Grid items carry a `.status-led`, list items a `.badge-status`; both
    // encode the tracking status in a `status-<state>` class.
    const statusSelector = `${itemSelector} .status-led, ${itemSelector} .badge-status`;

    let statusClassName = '';
    await browser.waitUntil(async () => {
      const [firstStatus] = await $$(statusSelector);
      if (!firstStatus || !(await firstStatus.isDisplayed().catch(() => false))) {
        return false;
      }
      statusClassName = (await firstStatus.getAttribute('class').catch(() => null)) ?? '';
      return statusClassName.includes('status-');
    }, { timeout: 10000, timeoutMsg: 'A displayed status indicator did not render in time' });

    expect(statusClassName).toContain('status-');
  });

  it('should have a working search bar', async () => {
    const itemSelector = await getActiveMediaItemSelector();
    const initialCount = await $$(itemSelector).length;

    // Search for a specific title from seed.ts
    await setSearchQuery('呪術');
    await waitForLibraryItemCount(count => count > 0 && count < initialCount, {
      timeoutMsg: 'Search filtering did not reduce item count'
    });

    // Clear search and ensure all items come back
    await setSearchQuery('');
    await waitForLibraryItemCount(initialCount, {
      timeoutMsg: 'Search clearing did not restore items'
    });
  });

  it('should toggle to list view and show expected entries', async () => {
    try {
      await setLibraryLayout('list');
      await waitForListCount(count => count > 0, { timeoutMsg: 'Media list did not render in time' });

      const gridToggle = $('#btn-layout-grid');
      const listToggle = $('#btn-layout-list');
      expect(await gridToggle.getAttribute('aria-pressed')).toBe('false');
      expect(await listToggle.getAttribute('aria-pressed')).toBe('true');

      expect(await isMediaVisible('ある魔女が死ぬまで')).toBe(true);
      expect(await isMediaVisible('ペルソナ5')).toBe(true);
      expect(await isMediaVisible('薬屋のひとりごと')).toBe(true);

      const personaEntryText = await getMediaItemText('ペルソナ5');
      const normalizedEntryText = personaEntryText.toUpperCase();
      expect(personaEntryText).toContain('ペルソナ5');
      expect(personaEntryText).toContain('Ongoing');
      expect(normalizedEntryText).toContain('FIRST LOGGED');
      expect(normalizedEntryText).toContain('LAST LOGGED');
      expect(normalizedEntryText).toContain('TIME LOGGED');
    } finally {
      await setLibraryLayout('grid');
    }
  });

  it('should open detail view when clicking a media item from list view', async () => {
    try {
      await setLibraryLayout('list');
      await waitForListCount(count => count > 0, { timeoutMsg: 'Media list did not render in time' });

      await clickMediaItem('ある魔女が死ぬまで');

      // Detail view should show -- check for detail-specific elements
      const detailView = $('#media-root');
      await detailView.waitForDisplayed({ timeout: 3000 });
      expect(await detailView.isDisplayed()).toBe(true);

      expect(await $('#media-detail-header').isDisplayed()).toBe(true);
      expect(await $('#media-title').getText()).toContain('ある魔女が死ぬまで');
    } finally {
      await backToLibrary('list');
      await setLibraryLayout('grid');
    }
  });

  it('should not be in a broken state', async () => {
    await verifyViewNotBroken();
  });

  it('should capture a non-blocking library visual diff', async () => {
    await navigateTo('media');
    await takeAndCompareScreenshot('media-grid');
  });
});

describe('CUJ: Library Exploration (Search & Filter)', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should filter library results correctly', async () => {
    await navigateTo('media');
    await runSharedFilterAssertions();

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('media');

    expect(await isMediaNotVisible('ダンジョン飯')).toBe(true);
    expect(await isMediaVisible('呪術廻戦')).toBe(true);
    expect(await isMediaVisible('ペルソナ5')).toBe(true);
    expect(await isMediaVisible('STEINS;GATE')).toBe(true);

    await setHideArchived(false);
    expect(await isMediaVisible('ダンジョン飯')).toBe(true);
  });

  it('should apply the same filters correctly in list view', async () => {
    await navigateTo('media');
    await setLibraryLayout('list');
    await waitForListCount(count => count > 0, { timeoutMsg: 'Media list did not render in time' });

    try {
      await resetLibraryFilters();
      await runSharedFilterAssertions();
    } finally {
      await resetLibraryFilters();
      await setLibraryLayout('grid');
    }
  });

  it('should keep detail navigation constrained to the filtered library order', async () => {
    await navigateTo('media');
    await resetLibraryFilters();
    await setMediaTypeFilters(['Manga']);

    try {
      await waitForLibraryItemCount(2, { timeoutMsg: 'Manga filter did not produce exactly two entries' });
      await clickMediaItem('呪術廻戦');
      await waitForDetailTitle('呪術廻戦');

      const navigationTitles = await browser.execute(() => {
        const select = document.querySelector<HTMLSelectElement>('#media-select');
        return select ? Array.from(select.options, (option) => option.textContent?.trim() || '') : [];
      });
      expect(navigationTitles).toEqual(['呪術廻戦', 'ダンジョン飯']);

      await safeClick('#media-next');
      await waitForDetailTitle('ダンジョン飯');

      await safeClick('#media-next');
      await waitForDetailTitle('呪術廻戦');

      await safeClick('#media-prev');
      await waitForDetailTitle('ダンジョン飯');
    } finally {
      await backToLibrary('grid');
      await resetLibraryFilters();
    }
  });
});

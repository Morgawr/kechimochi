import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo } from '../helpers/navigation.js';
import {
    setSearchQuery,
    setMediaTypeFilter,
    setTrackingStatusFilter,
    setHideArchived,
    isMediaVisible
} from '../helpers/library.js';

describe('CUJ: Library Exploration (Search & Filter)', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should filter library results correctly', async () => {
        await navigateTo('media');

        await setSearchQuery('呪術');
        expect(await isMediaVisible('呪術廻戦')).toBe(true);
        expect(await isMediaVisible('ペルソナ5')).toBe(false);

        await setSearchQuery('');
        expect(await isMediaVisible('ペルソナ5')).toBe(true);

        await setMediaTypeFilter('Manga');

        expect(await isMediaVisible('呪術廻戦')).toBe(true);
        expect(await isMediaVisible('ダンジョン飯')).toBe(true);
        expect(await isMediaVisible('ペルソナ5')).toBe(false);

        await setTrackingStatusFilter('Ongoing');

        // '呪術廻戦' was updated to 'Ongoing' in seed.ts for this test
        expect(await isMediaVisible('呪術廻戦')).toBe(true);
        expect(await isMediaVisible('ダンジョン飯')).toBe(false);

        await setTrackingStatusFilter('All');
        await setMediaTypeFilter('All');
        await setHideArchived(true);

        // 'ダンジョン飯' has status 'Archived', so it should be hidden
        expect(await isMediaVisible('ダンジョン飯')).toBe(false);

        // '呪術廻戦' has status 'Active', so it remains visible
        expect(await isMediaVisible('呪術廻戦')).toBe(true);

        // 'ある魔女が死ぬまで' has status 'Complete', but NOT archived, so it should be visible
        expect(await isMediaVisible('ある魔女が死ぬまで')).toBe(true);

        // Verify persistence after reload
        await browser.refresh();
        await waitForAppReady();
        await navigateTo('media');

        // Should still be hidden
        expect(await isMediaVisible('ダンジョン飯')).toBe(false);

        await setHideArchived(false);
        expect(await isMediaVisible('ダンジョン飯')).toBe(true);

        await setMediaTypeFilter('All');
        await setTrackingStatusFilter('All');
        expect(await isMediaVisible('ペルソナ5')).toBe(true);
    });
});

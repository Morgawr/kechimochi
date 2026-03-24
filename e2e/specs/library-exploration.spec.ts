import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo } from '../helpers/navigation.js';
import {
    setSearchQuery,
    setMediaTypeFilters,
    setTrackingStatusFilters,
    setHideArchived,
    isMediaVisible,
    isMediaNotVisible
} from '../helpers/library.js';

describe('CUJ: Library Exploration (Search & Filter)', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should filter library results correctly', async () => {
        await navigateTo('media');

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
});

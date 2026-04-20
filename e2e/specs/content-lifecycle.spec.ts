import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { clickMediaItem, setHideArchived, isMediaVisible, isMediaNotVisible } from '../helpers/library.js';
import {
    clickMarkAsComplete,
    getDetailTrackingStatus,
    isArchivedStatusActive,
    toggleArchivedStatusDetail,
    backToGrid
} from '../helpers/media-detail.js';

describe('CUJ: Content Lifecycle (Manual Archiving)', () => {
    beforeAll(async () => {
        await waitForAppReady();
    });

    it('should decouple completion from archiving and handle visibility', async () => {
        await navigateTo('media');
        expect(await verifyActiveView('media')).toBe(true);

        // "呪術廻戦" is Ongoing and Active by default in seed.ts
        await clickMediaItem('呪術廻戦');

        await clickMarkAsComplete();

        expect(await getDetailTrackingStatus()).toBe('Complete');

        expect(await isArchivedStatusActive()).toBe(true);

        await toggleArchivedStatusDetail();
        expect(await isArchivedStatusActive()).toBe(false);

        await backToGrid();
        expect(await verifyActiveView('media')).toBe(true);

        await setHideArchived(true);
        expect(await isMediaNotVisible('呪術廻戦')).toBe(true);

        await setHideArchived(false);
        expect(await isMediaVisible('呪術廻戦')).toBe(true);

        // Verify archived visual indicator (opacity 0.6)
        const item = $(`[data-title="呪術廻戦"]`);
        expect(await item.getCSSProperty('opacity')).toMatchObject({ value: 0.6 });
    });
});

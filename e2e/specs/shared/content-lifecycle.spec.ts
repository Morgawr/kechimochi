import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { clickMediaItem, setHideArchived, isMediaVisible, isMediaNotVisible, getActiveLibraryLayout } from '../../helpers/library.js';
import {
    clickMarkAsComplete,
    getDetailTrackingStatus,
    isArchivedStatusActive,
    toggleArchivedStatusDetail,
    backToGrid
} from '../../helpers/media-detail.js';

describe('CUJ: Content Lifecycle (Manual Archiving)', () => {
    before(async () => {
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

        // Verify archived visual indicator: both layouts dim an inner element rather than
        // the animated shell, so the fade-in animation cannot outrank the dimming.
        // Assert "dimmed" (< 1) rather than a hardcoded value so either layout passes.
        const layout = await getActiveLibraryLayout();
        const dimmedItem = layout === 'grid'
            ? $(`.media-grid-item[data-title="呪術廻戦"] .media-grid-item-body`)
            : $(`.media-list-item-shell[data-title="呪術廻戦"] .media-list-item`);
        const archivedOpacity = Number((await dimmedItem.getCSSProperty('opacity')).value);
        expect(archivedOpacity).toBeLessThan(1);
    });
});

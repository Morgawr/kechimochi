import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import {
    fetchMetadata,
    confirmMerge,
    toggleImportCheckbox,
    verifyDiffDisplayed
} from '../helpers/import.js';
import { getDescription, getExtraField } from '../helpers/media-detail.js';

describe('CUJ: Information Enrichment (Mocked Metadata Fetching)', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should fetch metadata and handle conflicts/diffs correctly', async () => {
        await navigateTo('media');
        expect(await verifyActiveView('media')).toBe(true);

        await addMedia('STEINS;GATE 0', 'Reading', 'Visual Novel');

        const mockData = {
            title: "STEINS;GATE 0",
            description: "New scraped description",
            coverImageUrl: "https://example.com/new_cover.jpg",
            extraData: {
                "Developer": "MAGES. / 5pb.",
                "Release Date": "2015-12-10",
                "Conflicts": "New value",
                "Stay": "New value"
            }
        };

        await browser.execute((data) => {
            (globalThis as unknown as { mockMetadata: unknown, mockDownloadedImagePath: string }).mockMetadata = data;
            (globalThis as unknown as { mockMetadata: unknown, mockDownloadedImagePath: string }).mockDownloadedImagePath = "/mock/path/to/cover.jpg";
        }, mockData);

        await $('#btn-add-extra').click();
        await import('../helpers/common.js').then(m => m.submitPrompt('Conflicts'));
        await import('../helpers/common.js').then(m => m.submitPrompt('Old value'));

        await $('#btn-add-extra').click();
        await import('../helpers/common.js').then(m => m.submitPrompt('Stay'));
        await import('../helpers/common.js').then(m => m.submitPrompt('Original'));

        await import('../helpers/media-detail.js').then(m => m.editDescription('Old description'));

        await fetchMetadata('https://vndb.org/v17102');

        await verifyDiffDisplayed('description', 'Old description', 'New scraped description');
        await verifyDiffDisplayed('extra-Conflicts', 'Old value', 'New value');
        await verifyDiffDisplayed('extra-Stay', 'Original', 'New value');

        await toggleImportCheckbox('extra-Stay', false);

        await confirmMerge();

        expect(await getDescription()).toBe('New scraped description');
        expect(await getExtraField('Conflicts')).toBe('New value');
        expect(await getExtraField('Stay')).toBe('Original');
        expect(await getExtraField('Developer')).toBe('MAGES. / 5pb.');
        expect(await getExtraField('Release Date')).toBe('2015-12-10');
    });
});

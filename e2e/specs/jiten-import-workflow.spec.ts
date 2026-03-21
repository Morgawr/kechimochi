import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { addMedia } from '../helpers/library.js';
import { confirmMerge } from '../helpers/import.js';
import { getExtraField } from '../helpers/media-detail.js';

describe('CUJ: Jiten Media Search and Import Workflow', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should search external Jiten API, select a volume and import metadata', async () => {
        await navigateTo('media');
        expect(await verifyActiveView('media')).toBe(true);

        const mediaTitle = 'Test Series';
        await addMedia(mediaTitle, 'Reading', 'Visual Novel');

        // Setup mock for search results and detail endpoints
        const mocks = {
            'api/media-deck/get-media-decks': {
                data: [{
                    deckId: 100,
                    originalTitle: "Test Series",
                    romajiTitle: "Test Series",
                    englishTitle: "Test Series",
                    mediaType: 7, // Visual Novel
                    coverName: null,
                    parentDeckId: null,
                    childrenDeckCount: 2
                }]
            },
            'api/media-deck/100/detail': {
                data: {
                    mainDeck: {
                        deckId: 100,
                        originalTitle: "Test Series",
                        mediaType: 7,
                        characterCount: null,
                        wordCount: null
                    },
                    subDecks: [{
                        deckId: 101,
                        originalTitle: "Test Series - Volume 1",
                        mediaType: 7,
                        parentDeckId: 100
                    }, {
                        deckId: 102,
                        originalTitle: "Test Series - Volume 2",
                        mediaType: 7,
                        parentDeckId: 100
                    }]
                }
            },
            'api/media-deck/101/detail': {
                data: {
                    mainDeck: {
                        deckId: 101,
                        originalTitle: "Test Series - Volume 1",
                        description: "This is a great first volume.",
                        mediaType: 7,
                        characterCount: 50,
                        wordCount: 15,
                        uniqueKanjiCount: 8,
                        difficultyRaw: 2.5,
                        parentDeckId: 100
                    }
                }
            }
        };

        await browser.execute((mockData) => {
            (globalThis as unknown as Record<string, unknown>).mockExternalJSON = mockData;
        }, mocks);

        // Click Search on jiten
        const searchBtn = $('#btn-search-jiten');
        await searchBtn.waitForDisplayed({ timeout: 5000 });
        await searchBtn.click();

        // Verify pre-filled search box inside modal
        const searchInput = $('#jiten-search-input');
        await searchInput.waitForDisplayed({ timeout: 5000 });
        expect(await searchInput.getValue()).toBe(mediaTitle);

        // Verify mocked API returned entries and rendered them
        const resultCard100 = $('.jiten-result-card[data-id="100"]');
        await resultCard100.waitForDisplayed({ timeout: 10000 });
        expect(await resultCard100.isExisting()).toBe(true);

        // Click series card -> should show volumes
        await resultCard100.click();

        // Verify multi-entry dialog shows separate volumes
        const volCard101 = $('.jiten-volume-card[data-deck-id="101"]');
        await volCard101.waitForDisplayed({ timeout: 10000 });
        expect(await volCard101.isExisting()).toBe(true);

        // Click volume 1 -> triggers metadata import
        await volCard101.click();

        // Wait for import modal, verify diffs for new fields
        const confirmBtn = $('#import-confirm');
        await confirmBtn.waitForDisplayed({ timeout: 10000 });

        const verifyNewField = async (field: string, newText: string) => {
            await browser.waitUntil(async () => {
                const labelEl = await $(`[data-field="${field}"]`).parentElement();
                const isExisting = await labelEl.isExisting();
                if (!isExisting) return false;
                const text = await labelEl.getText();
                // Depending on browser and CSS, the text might be rendered with different whitespace/newlines
                return text.includes(newText) && text.toLowerCase().includes('new field');
            }, {
                timeout: 5000,
                timeoutMsg: `Expected new field ${field} with text "${newText}"`
            });
        };

        await verifyNewField('description', 'This is a great first volume.');
        await verifyNewField('extra-Character count', '50');
        await verifyNewField('extra-Word count', '15');
        await verifyNewField('extra-Unique kanji', '8');

        // Confirm merge
        await confirmMerge();

        // Verify data gets imported into the media detail page
        const descriptionShell = $('#media-description');
        await browser.waitUntil(async () => {
            return (await descriptionShell.getText()) === 'This is a great first volume.';
        }, {
            timeout: 5000,
            timeoutMsg: 'Merged description was not applied'
        });

        // Verify extra fields 
        expect(await getExtraField('Character count')).toBe('50');
        expect(await getExtraField('Word count')).toBe('15');
        expect(await getExtraField('Jiten difficulty')).toBe('2.50/5');

        // Cleanup global mock
        await browser.execute(() => {
            const gt = globalThis as unknown as Record<string, unknown>;
            delete gt.mockExternalJSON;
        });
    });
});

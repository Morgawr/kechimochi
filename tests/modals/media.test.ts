import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showAddMediaModal, showImportMergeModal, showMediaCsvConflictModal, showJitenSearchModal } from '../../src/media/modal';

vi.mock('../../src/jiten_api', () => ({
    searchJiten: vi.fn(),
    getJitenCoverUrl: vi.fn(() => 'cover.jpg'),
    getJitenDeckUrl: vi.fn((id) => `https://jiten.moe/decks/${id}`),
    getJitenDeckChildren: vi.fn(),
    getJitenMediaLabel: vi.fn((type) => {
        if (type === 1) return 'Anime';
        if (type === 9) return 'Manga';
        if (type === 4) return 'Novel';
        return 'Media';
    }),
}));

import * as jitenApi from '../../src/jiten_api';
import { JitenResult } from '../../src/jiten_api';
import { Media, MediaConflict } from '../../src/api';
import { ScrapedMetadata } from '../../src/importers/index';

describe('modals/media.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    describe('showAddMediaModal', () => {
        it('should resolve media data on confirm', async () => {
            const promise = showAddMediaModal();
            await vi.waitFor(() => document.querySelector('#add-media-confirm'));
            
            const titleInput = document.querySelector('#add-media-title') as HTMLInputElement;
            const typeSelect = document.querySelector('#add-media-type') as HTMLSelectElement;
            const contentSelect = document.querySelector('#add-media-content-type') as HTMLSelectElement;
            
            titleInput.value = 'New Manga';
            typeSelect.value = 'Reading';
            typeSelect.dispatchEvent(new Event('change'));
            contentSelect.value = 'Manga';
            
            (document.querySelector('#add-media-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result).toEqual({ title: 'New Manga', type: 'Reading', contentType: 'Manga' });
        });

        it('should resolve null on cancel', async () => {
            const promise = showAddMediaModal();
            await vi.waitFor(() => document.querySelector('#add-media-cancel'));
            
            (document.querySelector('#add-media-cancel') as HTMLElement).click();
            
            const result = await promise;
            expect(result).toBeNull();
        });
    });

    describe('showImportMergeModal', () => {
        it('should show differences and return selected merges', async () => {
            const scraped = {
                title: 'New Title',
                description: 'New Desc',
                coverImageUrl: 'new.jpg',
                extraData: { 'Author': 'New Author', 'Genre': 'Action' }
            };
            const current = {
                description: 'Old Desc',
                extraData: { 'Author': 'Old Author' }
            };

            const promise = showImportMergeModal(scraped as unknown as ScrapedMetadata, current as unknown as { description?: string, coverImageUrl?: string, extraData: Record<string, string>, imagesIdentical?: boolean });
            await vi.waitFor(() => document.querySelector('#import-confirm'));
            
            // Uncheck one field
            const authorCheckbox = document.querySelector('input[data-field="extra-Author"]') as HTMLInputElement;
            authorCheckbox.checked = false;
            
            (document.querySelector('#import-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result?.description).toBe('New Desc');
            expect(result?.coverImageUrl).toBe('new.jpg');
            expect(result?.extraData['Genre']).toBe('Action');
            expect(result?.extraData['Author']).toBeUndefined();
        });

        it('should label inherited Jiten fields as coming from the entire series', async () => {
            const scraped = {
                title: 'Volume 1',
                description: 'Series Desc',
                coverImageUrl: 'series-cover.jpg',
                extraData: { 'Word count': '6,000', 'Character count': '1,000' },
                fieldSources: {
                    description: 'entireSeries',
                    coverImageUrl: 'entireSeries',
                    extraData: { 'Word count': 'entireSeries' }
                }
            };
            const current = {
                description: '',
                extraData: {}
            };

            const promise = showImportMergeModal(scraped as unknown as ScrapedMetadata, current as unknown as { description?: string, coverImageUrl?: string, extraData: Record<string, string>, imagesIdentical?: boolean });
            await vi.waitFor(() => document.querySelector('#import-confirm'));

            const labels = Array.from(document.querySelectorAll('label')).map(node => node.textContent || '');
            expect(labels.some(text => text.includes('Description') && text.includes('From Entire Series'))).toBe(true);
            expect(labels.some(text => text.includes('Cover Image') && text.includes('From Entire Series'))).toBe(true);
            expect(labels.some(text => text.includes('Word count') && text.includes('From Entire Series'))).toBe(true);
            expect(labels.some(text => text.includes('Character count') && text.includes('From Entire Series'))).toBe(false);

            (document.querySelector('#import-cancel') as HTMLElement).click();
            await expect(promise).resolves.toBeNull();
        });
    });
    describe('showMediaCsvConflictModal', () => {
        it('should resolve conflicting records', async () => {
            const conflicts = [
                { incoming: { "Title": "M1", "Status": "Ongoing" }, existing: { status: "Not Started" } }
            ];
            const promise = showMediaCsvConflictModal(conflicts as unknown as MediaConflict[]);
            await vi.waitFor(() => document.querySelector('#conflict-confirm'));
            
            const radioReplace = document.querySelector('input[value="replace"]') as HTMLInputElement;
            radioReplace.checked = true;
            
            (document.querySelector('#conflict-confirm') as HTMLElement).click();
            
            const result = await promise;
            expect(result).toHaveLength(1);
            expect(result![0]["Status"]).toBe("Ongoing");
        });
    });

    describe('showJitenSearchModal', () => {
        it('should search and resolve selected deck URL', async () => {
            vi.mocked(jitenApi.searchJiten).mockResolvedValue([{ deckId: 123, originalTitle: 'Result', mediaType: 4 }] as unknown as JitenResult[]);
            
            const promise = showJitenSearchModal({ title: 'Query' } as unknown as Media);
            await vi.waitFor(() => document.querySelector('.jiten-result-card'));
            
            const card = document.querySelector('.jiten-result-card') as HTMLElement;
            card.click();
            
            const result = await promise;
            expect(result).toBe('https://jiten.moe/decks/123');
        });
        it('should handle volume selection', async () => {
             const parentDeck = { deckId: 100, originalTitle: 'Series', childrenDeckCount: 2 };
             const childDeck = { deckId: 101, originalTitle: 'Vol 1' };
             vi.mocked(jitenApi.searchJiten).mockResolvedValue([parentDeck] as unknown as JitenResult[]);
             vi.mocked(jitenApi.getJitenDeckChildren).mockResolvedValue([childDeck] as unknown as JitenResult[]);

             const promise = showJitenSearchModal({ title: 'Query' } as unknown as Media);
             await vi.waitFor(() => document.querySelector('.jiten-result-card'));
             
             // Click parent deck
             (document.querySelector('.jiten-result-card') as HTMLElement).click();
             
             // Wait for sub-decks to load
             await vi.waitFor(() => document.querySelector('.jiten-volume-card'));
             
             // Click child deck
             const childCard = document.querySelector('.jiten-volume-card[data-deck-id="101"]') as HTMLElement;
             childCard.click();
             
             const result = await promise;
             expect(result).toBe('https://jiten.moe/decks/101');
        });
    });
});

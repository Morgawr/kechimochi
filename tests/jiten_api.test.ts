import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jiten from '../src/jiten_api';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('jiten_api.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchJiten', () => {
    it('should return results from original search', async () => {
      const mockResult = {
        data: [{
          deckId: 1,
          originalTitle: 'Title',
          romajiTitle: 'Title',
          englishTitle: 'Title',
          mediaType: 4,
          coverName: 'cover.jpg',
          parentDeckId: null,
          childrenDeckCount: 0
        }]
      };
      vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify(mockResult));

      const results = await jiten.searchJiten('Title', 'Novel');
      expect(results.length).toBe(1);
      expect(results[0].deckId).toBe(1);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('should try fallback search without mediaType if original fails', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce(JSON.stringify({ data: [] })) // Original with mediaType
        .mockResolvedValueOnce(JSON.stringify({ data: [{ deckId: 2 }] })); // Fallback

      const results = await jiten.searchJiten('Title', 'Novel');
      expect(results.length).toBe(1);
      expect(results[0].deckId).toBe(2);
      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('should return empty if results > 25 (false positive)', async () => {
      const largeResult = {
        data: Array.from({ length: 26 }, (_, i) => ({ deckId: i }))
      };
      vi.mocked(invoke).mockResolvedValue(JSON.stringify(largeResult));

      const results = await jiten.searchJiten('Title', 'Novel');
      expect(results.length).toBe(0);
    });

    it('should try no-punctuation search', async () => {
      vi.mocked(invoke)
        .mockResolvedValue(JSON.stringify({ data: [] })); // All fail
      
      // We want to verify it calls invoke with a different URL
      await jiten.searchJiten('Title!', 'Novel');
      
      const calls = vi.mocked(invoke).mock.calls;
      // Search original with MT, search original without MT
      // Then search no-punct with MT, search no-punct without MT
      const noPunctCall = calls.find(call => (call[1] as any).url.includes('titleFilter=Title'));
      expect(noPunctCall).toBeDefined();
    });
  });

  describe('getJitenDeckChildren', () => {
    it('should return children subDecks', async () => {
      const mockDetail = {
        data: {
          subDecks: [{ deckId: 101, originalTitle: 'Sub' }]
        }
      };
      vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockDetail));

      const children = await jiten.getJitenDeckChildren(100);
      expect(children.length).toBe(1);
      expect(children[0].deckId).toBe(101);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('api error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const children = await jiten.getJitenDeckChildren(100);
      expect(children).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('helpers', () => {
    it('getJitenCoverUrl should return correct URL', () => {
      expect(jiten.getJitenCoverUrl(1, null)).toBe('https://cdn.jiten.moe/1/cover.jpg');
      expect(jiten.getJitenCoverUrl(2, 1)).toBe('https://cdn.jiten.moe/1/cover.jpg');
    });

    it('getJitenDeckUrl should return correct URL', () => {
      expect(jiten.getJitenDeckUrl(123)).toBe('https://jiten.moe/decks/123');
    });
  });
});

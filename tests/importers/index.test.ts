import { describe, it, expect } from 'vitest';
import * as importersIndex from '../../src/importers/index';

describe('importers/index.ts', () => {
    it('isValidImporterUrl should return true for supported URLs', () => {
        // VNDB example
        expect(importersIndex.isValidImporterUrl('https://vndb.org/v1', 'Visual Novel')).toBe(true);
        expect(importersIndex.isValidImporterUrl('https://google.com', 'Visual Novel')).toBe(false);
    });

    it('getRecommendedImportersForContentType should return relevant importers', () => {
        const novelImporters = importersIndex.getRecommendedImportersForContentType('Visual Novel');
        expect(novelImporters.some(i => i.name === 'VNDB')).toBe(true);
    });

    it('getAvailableSourcesForContentType should return list of names', () => {
        const sources = importersIndex.getAvailableSourcesForContentType('Visual Novel');
        expect(sources).toContain('VNDB');
    });

    it('fetchMetadataForUrl should return mock metadata if window.mockMetadata exists', async () => {
        const mockData = { title: 'Mock' };
        const g = globalThis as unknown as Record<string, unknown>;
        g.mockMetadata = mockData;
        const result = await importersIndex.fetchMetadataForUrl('url', 'type');
        expect(result).toBe(mockData);
        delete g.mockMetadata;
    });

    it('fetchMetadataForUrl should throw error if no importer found', async () => {
        await expect(importersIndex.fetchMetadataForUrl('https://invalid.com', 'None'))
            .rejects.toThrow("Content importer not supported. If you want to request a new metadata import source, please file a request at https://github.com/Morgawr/kechimochi/issues");
    });
});

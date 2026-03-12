import { describe, it, expect, vi } from 'vitest';
import * as importersIndex from '../../src/importers/index';

describe('importers/index.ts', () => {
    it('isValidImporterUrl should return true for supported URLs', () => {
        // VNDB example
        expect(importersIndex.isValidImporterUrl('https://vndb.org/v1', 'Visual Novel')).toBe(true);
        expect(importersIndex.isValidImporterUrl('https://google.com', 'Visual Novel')).toBe(false);
    });

    it('getImportersForContentType should return relevant importers', () => {
        const novelImporters = importersIndex.getImportersForContentType('Visual Novel');
        expect(novelImporters.some(i => i.name === 'VNDB')).toBe(true);
    });

    it('getAvailableSourcesForContentType should return list of names', () => {
        const sources = importersIndex.getAvailableSourcesForContentType('Visual Novel');
        expect(sources).toContain('VNDB');
    });

    it('fetchMetadataForUrl should return mock metadata if window.mockMetadata exists', async () => {
        const mockData = { title: 'Mock' } as any;
        (window as any).mockMetadata = mockData;
        const result = await importersIndex.fetchMetadataForUrl('url', 'type');
        expect(result).toBe(mockData);
        delete (window as any).mockMetadata;
    });

    it('fetchMetadataForUrl should throw error if no importer found', async () => {
        await expect(importersIndex.fetchMetadataForUrl('https://invalid.com', 'None'))
            .rejects.toThrow("No importer available for this URL and/or Content Type.");
    });
});

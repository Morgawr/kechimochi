import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VndbImporter } from '../../src/importers/vndb';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('VndbImporter', () => {
    let importer: VndbImporter;

    beforeEach(() => {
        importer = new VndbImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid VNDB URLs', () => {
            expect(importer.matchUrl('https://vndb.org/v5850', 'Visual Novel')).toBe(true);
            expect(importer.matchUrl('https://vndb.org/v1', 'Visual Novel')).toBe(true);
        });

    });

    describe('removeBbcode', () => {
        it('should remove BBCode tags but keep content', () => {
            const input = '[b]Bold[/b] [url=https://vndb.org]VNDB[/url] [spoiler]Secret[/spoiler]';
            // @ts-expect-error - reaching into private method for test
            expect(importer.removeBbcode(input)).toBe('Bold VNDB Secret');
        });

        it('should handle empty or null input', () => {
            // @ts-expect-error - reaching into private method
            expect(importer.removeBbcode('')).toBe('');
        });
    });

    describe('fetch', () => {
        it('should fetch and parse VN metadata correctly', async () => {
            const vnData = {
                results: [{
                    id: 'v5850',
                    description: 'A great [b]VN[/b].',
                    image: { url: 'https://img.vndb.org/cv/123.jpg' },
                    platforms: ['win', 'ps3']
                }]
            };

            const relData = {
                results: [{
                    released: '2010-01-01',
                    producers: [
                        { name: 'Dev Team', developer: true },
                        { name: 'Pub Co', publisher: true }
                    ]
                }]
            };

            vi.mocked(invoke)
                .mockResolvedValueOnce(JSON.stringify(vnData))
                .mockResolvedValueOnce(JSON.stringify(relData));

            const result = await importer.fetch('https://vndb.org/v5850');

            expect(result.description).toBe('A great VN.');
            expect(result.coverImageUrl).toBe('https://img.vndb.org/cv/123.jpg');
            expect(result.extraData['Source (VNDB)']).toBe('https://vndb.org/v5850');
            expect(result.extraData['Developer']).toBe('Dev Team');
            expect(result.extraData['Publisher']).toBe('Pub Co');
            expect(result.extraData['Release Date']).toBe('2010-01-01');
            expect(result.extraData['Platforms']).toBe('WIN, PS3');
            expect(invoke).toHaveBeenCalledTimes(2);
        });

        it('should throw error if VN not found', async () => {
            vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ results: [] }));
            await expect(importer.fetch('https://vndb.org/v0')).rejects.toThrow('VN not found on VNDB.');
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShonenjumpplusImporter } from '../../src/importers/shonenjumpplus';
import { invoke } from '@tauri-apps/api/core';

describe('ShonenjumpplusImporter', () => {
    let importer: ShonenjumpplusImporter;

    beforeEach(() => {
        importer = new ShonenjumpplusImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Shonen Jump Plus URLs', () => {
            expect(importer.matchUrl('https://shonenjumpplus.com/episode/123')).toBe(true);
        });
    });

    describe('fetch', () => {
        it('should parse metadata from page and RSS correctly', async () => {
            const pageHtml = `
                <html>
                <head>
                    <link rel="alternate" type="application/rss+xml" href="https://example.com/rss">
                    <meta property="og:image" content="https://img.sjp.com/og.jpg">
                </head>
                <body></body>
                </html>
            `;
            const rssXml = `
                <rss>
                    <channel>
                        <description>Series description.</description>
                        <item>
                            <author>Fujimoto Tatsuki</author>
                            <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
                        </item>
                        <item>
                            <pubDate>Mon, 01 Jan 2023 00:00:00 +0000</pubDate>
                        </item>
                    </channel>
                </rss>
            `;

            vi.mocked(invoke)
                .mockResolvedValueOnce(pageHtml)
                .mockResolvedValueOnce(rssXml);

            const result = await importer.fetch('https://shonenjumpplus.com/episode/123');

            expect(result.description).toBe('Series description.');
            expect(result.coverImageUrl).toBe('https://img.sjp.com/og.jpg');
            expect(result.extraData['Author']).toBe('Fujimoto Tatsuki');
            expect(result.extraData['Publication Date']).toBe('2023-01-01'); // Oldest date
        });

        it('should handle missing RSS gracefully', async () => {
            vi.mocked(invoke).mockResolvedValue('<html><body></body></html>');
            const result = await importer.fetch('https://shonenjumpplus.com/episode/123');
            expect(result.description).toBe('');
            expect(result.extraData['Author']).toBeUndefined();
        });
    });
});

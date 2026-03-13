import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookmeterImporter } from '../../src/importers/bookmeter';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('BookmeterImporter', () => {
    let importer: BookmeterImporter;

    beforeEach(() => {
        importer = new BookmeterImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Bookmeter URLs', () => {
            expect(importer.matchUrl('https://bookmeter.com/books/123')).toBe(true);
        });
    });

    describe('fetch', () => {
        it('should parse metadata correctly', async () => {
            const mockHtml = `
                <html>
                <head>
                    <meta property="og:image" content="https://img.bm.com/123.jpg">
                    <meta property="og:description" content="Prefix textがあるので安心。Main plot.">
                </head>
                <body>
                    <div class="header__authors">
                        <a href="/search?author=Nisio+isin">Nisio Isin</a>
                    </div>
                    <dl>
                        <dt class="bm-details-side__title">ページ数</dt>
                        <dd>448ページ</dd>
                    </dl>
                    <div class="current-book-detail__publisher">出版社：Kodansha</div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://bookmeter.com/books/123');

            expect(result.description).toBe('Main plot.');
            expect(result.coverImageUrl).toBe('https://img.bm.com/123.jpg');
            expect(result.extraData['Page Count']).toBe('448');
            expect(result.extraData['Publisher']).toBe('Kodansha');
            expect(result.extraData['Author']).toBe('Nisio Isin');
        });
        it('should handle publisher without prefix', async () => {
            const mockHtml = `
                <html>
                <body>
                    <div class="current-book-detail__publisher">Just Publisher Name</div>
                </body>
                </html>
            `;
            vi.mocked(invoke).mockResolvedValue(mockHtml);
            const result = await importer.fetch('url');
            expect(result.extraData['Publisher']).toBe('Just Publisher Name');
        });
    });
});

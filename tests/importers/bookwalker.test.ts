import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookwalkerImporter } from '../../src/importers/bookwalker';
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../../src/core/logger';

describe('BookwalkerImporter', () => {
    let importer: BookwalkerImporter;

    beforeEach(() => {
        importer = new BookwalkerImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Bookwalker URLs', () => {
            expect(importer.matchUrl('https://bookwalker.jp/de123/')).toBe(true);
        });
    });

    describe('fetch', () => {
        it('should parse metadata from a volume page correctly', async () => {
            const mockHtml = `
                <html>
                <head>
                    <meta property="og:description" content="Meta Desc">
                    <meta property="og:image" content="https://img.bw.jp/123.jpg">
                </head>
                <body>
                    <div class="m-synopsis">Real Desc</div>
                    <dl>
                        <dt>シリーズ</dt>
                        <dd><a href="/s/">Test Series</a></dd>
                        <dt>著者</dt>
                        <dd><a href="/a1/">Author A (著者)</a> <a href="/a2/">Artist B (イラスト)</a></dd>
                        <dt>出版社</dt>
                        <dd><a href="/p/">Publisher X</a></dd>
                        <dt>配信開始日</dt>
                        <dd>2024/05/15 00:00</dd>
                        <dt>ページ概数</dt>
                        <dd>200ページ</dd>
                    </dl>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://bookwalker.jp/v1/');

            expect(result.description).toBe('Real Desc');
            expect(result.coverImageUrl).toBe('https://img.bw.jp/123.jpg');
            expect(result.extraData['Series Name']).toBe('Test Series');
            expect(result.extraData['Author']).toBe('Author A, Artist B');
            expect(result.extraData['Publisher']).toBe('Publisher X');
            expect(result.extraData['Publication Date']).toBe('2024年05月');
            expect(result.extraData['Page Number']).toBe('200');
        });

        it('should handle volume routing to a series list', async () => {
             const volumeHtml = `
                <html><body><a href="https://bookwalker.jp/series/list/">Series List</a></body></html>
             `;
             const seriesHtml = `
                <html>
                <body>
                    <div class="m-book-item__title"><a href="/v3/">Book 3</a></div>
                    <div class="m-book-item__title"><a href="/v4/">Book 4</a></div>
                </body>
                </html>
             `;
             const targetHtml = `
                <html><body><div class="m-synopsis">Target Desc</div></body></html>
             `;

             vi.mocked(invoke)
                .mockResolvedValueOnce(volumeHtml)
                .mockResolvedValueOnce(seriesHtml)
                .mockResolvedValueOnce(targetHtml);

             const result = await importer.fetch('https://bookwalker.jp/v1/', 4);

             expect(result.description).toBe('Target Desc');
             expect(vi.mocked(invoke)).toHaveBeenCalledTimes(3);
             expect(vi.mocked(invoke)).toHaveBeenLastCalledWith('fetch_external_json', expect.objectContaining({ url: 'https://bookwalker.jp/v4/' }));
        });

        it('should fall back to the original page when no series link is found', async () => {
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
            const pageHtml = `
                <html>
                <body>
                    <div class="m-synopsis">Original Desc</div>
                    <div class="m-main-cover__img" src="https://img.bw.jp/fallback.jpg"></div>
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(pageHtml);

            const result = await importer.fetch('https://bookwalker.jp/v1/', 4);

            expect(result.description).toBe('Original Desc');
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});

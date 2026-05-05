import { expect, it, vi } from 'vitest';
import { BookwalkerImporter } from '../../src/importers/bookwalker';
import { Logger } from '../../src/core/logger';
import {
    describeImporter,
    expectMockedImport,
    htmlDocument,
    itMatchesUrls,
    mockedInvoke,
    mockFetchResponse,
    mockFetchResponses,
} from './importer_test_utils';

describeImporter('BookwalkerImporter', () => new BookwalkerImporter(), getImporter => {
    itMatchesUrls('matches valid Bookwalker URLs', getImporter, [
        { url: 'https://bookwalker.jp/de123/' },
    ]);

    it('parses metadata from a volume page correctly', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://bookwalker.jp/v1/',
            response: htmlDocument({
                head: `
                    <meta property="og:description" content="Meta Desc">
                    <meta property="og:image" content="https://img.bw.jp/123.jpg">
                `,
                body: `
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
                `,
            }),
            expected: {
                description: 'Real Desc',
                coverImageUrl: 'https://img.bw.jp/123.jpg',
                extraData: {
                    'Series Name': 'Test Series',
                    Author: 'Author A, Artist B',
                    Publisher: 'Publisher X',
                    'Publication Date': '2024年05月',
                    'Page Number': '200',
                },
            },
        });

        expect(result).toBeDefined();
    });

    it('handles volume routing to a series list', async () => {
        mockFetchResponses([
            '<html><body><a href="https://bookwalker.jp/series/list/">Series List</a></body></html>',
            htmlDocument({
                body: `
                    <div class="m-book-item__title"><a href="/v3/">Book 3</a></div>
                    <div class="m-book-item__title"><a href="/v4/">Book 4</a></div>
                `,
            }),
            '<html><body><div class="m-synopsis">Target Desc</div></body></html>',
        ]);

        const result = await getImporter().fetch('https://bookwalker.jp/v1/', 4);

        expect(result.description).toBe('Target Desc');
        expect(mockedInvoke).toHaveBeenCalledTimes(3);
        expect(mockedInvoke).toHaveBeenLastCalledWith('fetch_external_json', expect.objectContaining({ url: 'https://bookwalker.jp/v4/' }));
    });

    it('falls back to the original page when no series link is found', async () => {
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
        mockFetchResponse(htmlDocument({
            body: `
                <div class="m-synopsis">Original Desc</div>
                <div class="m-main-cover__img" src="https://img.bw.jp/fallback.jpg"></div>
            `,
        }));

        const result = await getImporter().fetch('https://bookwalker.jp/v1/', 4);

        expect(result.description).toBe('Original Desc');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

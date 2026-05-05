import { expect, it } from 'vitest';
import { CmoaImporter } from '../../src/importers/cmoa';
import { describeImporter, expectMockedImport, htmlDocument, itMatchesUrls } from './importer_test_utils';

describeImporter('CmoaImporter', () => new CmoaImporter(), getImporter => {
    itMatchesUrls('matches valid Cmoa URLs', getImporter, [
        { url: 'https://www.cmoa.jp/title/123/', contentType: 'Manga' },
        { url: 'https://www.cmoa.jp/title/123/', contentType: 'Reading' },
    ]);

    it('parses Cmoa metadata correctly', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://www.cmoa.jp/title/123/',
            response: htmlDocument({
                body: `
                    <div class="title_detail_text">コミックシーモアなら無料で試し読み！Test Title｜Sample description text.</div>
                    <div class="title_detail_img"><img src="//www.cmoa.jp/img/123.jpg"></div>
                    <div class="category_line">
                        <div class="category_line_f_l_l">ジャンル</div>
                        <div class="category_line_f_r_l"><a href="/1">Fantasy</a><a href="/2">(1位)</a></div>
                    </div>
                    <div class="category_line">
                        <div class="category_line_f_l_l">作品タグ</div>
                        <div class="category_line_f_r_l"><a>Cool</a><a>Magic</a></div>
                    </div>
                    <div class="category_line">
                        <div class="category_line_f_l_l">出版社</div>
                        <div class="category_line_f_r_l"><a href="/p">Publisher A</a></div>
                    </div>
                    <div class="category_line">
                        <div class="category_line_f_l_l">出版年月</div>
                        <div class="category_line_f_r_l">2023年01月</div>
                    </div>
                    <div class="category_line">
                        <div class="category_line_f_l_l">ISBN</div>
                        <div class="category_line_f_r_l"><pre>123-456</pre></div>
                    </div>
                    <div class="title_details_author_name"><a>Test Artist</a></div>
                `,
            }),
            expected: {
                description: 'Sample description text.',
                coverImageUrl: 'https://www.cmoa.jp/img/123.jpg',
                extraData: {
                    Genres: 'Fantasy',
                    Tags: 'Cool, Magic',
                    Publisher: 'Publisher A',
                    'Publication Date': '2023年01月',
                    ISBN: '123-456',
                    Author: 'Test Artist',
                },
            },
        });

        expect(result).toBeDefined();
    });

    it('handles meta fallback and rating', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'url',
            response: htmlDocument({
                head: `
                    <meta property="og:description" content="Meta Description">
                    <meta property="og:image" content="//www.cmoa.jp/meta.jpg">
                `,
                body: `
                    <script type="application/ld+json">{"@context":"http://schema.org","AggregateRating":{"ratingValue":"4.5"}}</script>
                    <div class="category_line">
                        <div class="category_line_f_l_l">配信開始日</div>
                        <div class="category_line_f_r_l">2022年12月15日</div>
                    </div>
                `,
            }),
            expected: {
                description: 'Meta Description',
                coverImageUrl: 'https://www.cmoa.jp/meta.jpg',
                extraData: {
                    Rating: '4.5 Stars',
                    'Publication Date': '2022年12月',
                },
            },
        });

        expect(result).toBeDefined();
    });
});

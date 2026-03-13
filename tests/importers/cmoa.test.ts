import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CmoaImporter } from '../../src/importers/cmoa';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('CmoaImporter', () => {
    let importer: CmoaImporter;

    beforeEach(() => {
        importer = new CmoaImporter();
        vi.clearAllMocks();
    });

    describe('matchUrl', () => {
        it('should match valid Cmoa URLs', () => {
            expect(importer.matchUrl('https://www.cmoa.jp/title/123/', 'Manga')).toBe(true);
            expect(importer.matchUrl('https://www.cmoa.jp/title/123/', 'Reading')).toBe(true);
        });

    });

    describe('fetch', () => {
        it('should parse Cmoa metadata correctly', async () => {
            const mockHtml = `
                <html>
                <body>
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
                </body>
                </html>
            `;

            vi.mocked(invoke).mockResolvedValue(mockHtml);

            const result = await importer.fetch('https://www.cmoa.jp/title/123/');

            expect(result.description).toBe('Sample description text.'); // prefix removed
            expect(result.coverImageUrl).toBe('https://www.cmoa.jp/img/123.jpg');
            expect(result.extraData['Genres']).toBe('Fantasy'); // "(1位)" filtered
            expect(result.extraData['Tags']).toBe('Cool, Magic');
            expect(result.extraData['Publisher']).toBe('Publisher A');
            expect(result.extraData['Publication Date']).toBe('2023年01月');
            expect(result.extraData['ISBN']).toBe('123-456');
            expect(result.extraData['Author']).toBe('Test Artist');
        });

        it('should handle meta fallback and rating', async () => {
            const mockHtml = `
                <html>
                <head>
                    <meta property="og:description" content="Meta Description">
                    <meta property="og:image" content="//www.cmoa.jp/meta.jpg">
                </head>
                <body>
                    <script type="application/ld+json">{"@context":"http://schema.org","AggregateRating":{"ratingValue":"4.5"}}</script>
                    <div class="category_line">
                        <div class="category_line_f_l_l">配信開始日</div>
                        <div class="category_line_f_r_l">2022年12月15日</div>
                    </div>
                </body>
                </html>
            `;
            vi.mocked(invoke).mockResolvedValue(mockHtml);
            const result = await importer.fetch('url');
            expect(result.description).toBe('Meta Description');
            expect(result.coverImageUrl).toBe('https://www.cmoa.jp/meta.jpg');
            expect(result.extraData['Rating']).toBe('4.5 Stars');
            expect(result.extraData['Publication Date']).toBe('2022年12月');
        });
    });
});

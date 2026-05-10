import { expect, it } from 'vitest';
import { DmmImporter } from '../../src/importers/dmm';
import {
    describeImporter,
    expectMockedImport,
    htmlDocument,
    itMatchesUrls,
} from './importer_test_utils';

describeImporter('DmmImporter', () => new DmmImporter(), getImporter => {
    itMatchesUrls('matches valid DMM Games URLs', getImporter, [
        { url: 'https://dlsoft.dmm.com/detail/falcom_0002/' },
        { url: 'https://dlsoft.dmm.com/detail/clear_0035/' },
        { url: 'https://dlsoft.dmm.co.jp/detail/hobc_0011/' },
    ]);

    it('parses metadata from a DMM detail page correctly', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://dlsoft.dmm.com/detail/falcom_0002/',
            response: htmlDocument({
                body: `
                    <div class="read-text-area pbe-m">
                        <p class="text-overflow">This is a test description.<br>It has multiple lines and an <a href="http://example.com">external link</a>.</p>
                        <a class="readmore"><span>もっとみる</span></a>
                    </div>
                    
                    <div class="contentsDetailTop__table">
                        <div class="contentsDetailTop__tableRow">
                            <div class="contentsDetailTop__tableDataLeft"><p>メーカー</p></div>
                            <div class="contentsDetailTop__tableDataRight"><a href="#">Test Developer</a></div>
                        </div>
                    </div>
                    
                    <div class="contentsDetailBottom__table">
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>ダウンロード版対応OS</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><span>Windows 10/11</span></div>
                        </div>
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>ダウンロード版配信開始日</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><span>2024/01/01 10:00</span></div>
                        </div>
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>ゲームジャンル</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><p>RPG</p></div>
                        </div>
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>シリーズ</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><a href="#">Test Series</a></div>
                        </div>
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>ボイス</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><span>Full Voice</span></div>
                        </div>
                        <!-- Should be ignored according to instructions -->
                        <div class="contentsDetailBottom__tableRow">
                            <div class="contentsDetailBottom__tableDataLeft"><p>ジャンル</p></div>
                            <div class="contentsDetailBottom__tableDataRight"><a href="#">Fantasy</a></div>
                        </div>
                    </div>
                `,
            }),
            expected: {
                description: 'This is a test description.\nIt has multiple lines and an external link.',
                coverImageUrl: '',
                extraData: {
                    'Developer': 'Test Developer',
                    'Platform': 'Windows 10/11',
                    'Release date': '2024/01/01 10:00',
                    'Genre': 'RPG',
                    'Series': 'Test Series',
                    'Voice acting': 'Full Voice',
                },
            },
        });

        expect(result).toBeDefined();
        // The title is not imported and will be blank.
        expect(result?.title).toBe("");
        // Cover should be explicitly blank.
        expect(result?.coverImageUrl).toBe("");
    });
});

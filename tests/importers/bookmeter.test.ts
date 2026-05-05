import { expect, it } from 'vitest';
import { BookmeterImporter } from '../../src/importers/bookmeter';
import { describeImporter, expectMockedImport, htmlDocument, itMatchesUrls } from './importer_test_utils';

describeImporter('BookmeterImporter', () => new BookmeterImporter(), getImporter => {
    itMatchesUrls('matches valid Bookmeter URLs', getImporter, [
        { url: 'https://bookmeter.com/books/123' },
    ]);

    it('parses metadata correctly', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'https://bookmeter.com/books/123',
            response: htmlDocument({
                head: `
                    <meta property="og:image" content="https://img.bm.com/123.jpg">
                    <meta property="og:description" content="Prefix textがあるので安心。Main plot.">
                `,
                body: `
                    <div class="header__authors">
                        <a href="/search?author=Nisio+isin">Nisio Isin</a>
                    </div>
                    <dl>
                        <dt class="bm-details-side__title">ページ数</dt>
                        <dd>448ページ</dd>
                    </dl>
                    <div class="current-book-detail__publisher">出版社：Kodansha</div>
                `,
            }),
            expected: {
                description: 'Main plot.',
                coverImageUrl: 'https://img.bm.com/123.jpg',
                extraData: {
                    'Page Count': '448',
                    Publisher: 'Kodansha',
                    Author: 'Nisio Isin',
                },
            },
        });

        expect(result).toBeDefined();
    });

    it('handles publisher without prefix', async () => {
        const result = await expectMockedImport(getImporter(), {
            url: 'url',
            response: htmlDocument({
                body: '<div class="current-book-detail__publisher">Just Publisher Name</div>',
            }),
            expected: {
                extraData: {
                    Publisher: 'Just Publisher Name',
                },
            },
        });

        expect(result).toBeDefined();
    });
});

import { describe, expect, it } from 'vitest';
import { parseReleaseNotes, renderReleaseNotesHtml } from '../../src/release_notes';

describe('release notes helpers', () => {
    it('parses headings, paragraphs, and bullet lists from changelog markdown', () => {
        expect(parseReleaseNotes([
            '## [1.0.0] - 2026-03-24',
            '',
            '### Added',
            '- New update flow',
            '- Another item',
            '',
            'Summary line.',
        ].join('\n'))).toEqual([
            { type: 'heading', level: 2, text: '[1.0.0] - 2026-03-24' },
            { type: 'heading', level: 3, text: 'Added' },
            { type: 'list', items: ['New update flow', 'Another item'] },
            { type: 'paragraph', text: 'Summary line.' },
        ]);
    });

    it('keeps indented wrapped changelog bullet lines in the same list item', () => {
        expect(parseReleaseNotes([
            '### Fixed',
            ' - Activities logged in weeks between month boundaries will now show the correct',
            '   amount in the pie chart slice',
        ].join('\n'))).toEqual([
            { type: 'heading', level: 3, text: 'Fixed' },
            {
                type: 'list',
                items: [
                    'Activities logged in weeks between month boundaries will now show the correct amount in the pie chart slice',
                ],
            },
        ]);
    });

    it('renders release notes as escaped HTML blocks', () => {
        const html = renderReleaseNotesHtml('### Added\n- <script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('<ul');
    });
});

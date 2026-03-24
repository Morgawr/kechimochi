import { describe, expect, it } from 'vitest';
import { parseReleaseNotes, renderReleaseNotesHtml } from '../../src/updates/release_notes';

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

    it('renders release notes as escaped HTML blocks', () => {
        const html = renderReleaseNotesHtml('### Added\n- <script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('<ul');
    });
});

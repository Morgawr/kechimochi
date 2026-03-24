import { escapeHTML } from '../core/html';

interface HeadingBlock {
    type: 'heading';
    level: 2 | 3;
    text: string;
}

interface ParagraphBlock {
    type: 'paragraph';
    text: string;
}

interface ListBlock {
    type: 'list';
    items: string[];
}

type ReleaseNotesBlock = HeadingBlock | ParagraphBlock | ListBlock;

function flushParagraph(blocks: ReleaseNotesBlock[], lines: string[]): void {
    if (lines.length === 0) return;
    blocks.push({
        type: 'paragraph',
        text: lines.join(' ').trim(),
    });
    lines.length = 0;
}

function flushList(blocks: ReleaseNotesBlock[], items: string[]): void {
    if (items.length === 0) return;
    blocks.push({
        type: 'list',
        items: [...items],
    });
    items.length = 0;
}

export function parseReleaseNotes(markdown: string): ReleaseNotesBlock[] {
    const blocks: ReleaseNotesBlock[] = [];
    const paragraphLines: string[] = [];
    const listItems: string[] = [];
    const lines = markdown.replaceAll('\r\n', '\n').split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '') {
            flushParagraph(blocks, paragraphLines);
            flushList(blocks, listItems);
            continue;
        }

        if (line.startsWith('### ')) {
            flushParagraph(blocks, paragraphLines);
            flushList(blocks, listItems);
            blocks.push({
                type: 'heading',
                level: 3,
                text: line.slice(4).trim(),
            });
            continue;
        }

        if (line.startsWith('## ')) {
            flushParagraph(blocks, paragraphLines);
            flushList(blocks, listItems);
            blocks.push({
                type: 'heading',
                level: 2,
                text: line.slice(3).trim(),
            });
            continue;
        }

        if (line.startsWith('- ')) {
            flushParagraph(blocks, paragraphLines);
            listItems.push(line.slice(2).trim());
            continue;
        }

        flushList(blocks, listItems);
        paragraphLines.push(line);
    }

    flushParagraph(blocks, paragraphLines);
    flushList(blocks, listItems);
    return blocks;
}

export function renderReleaseNotesHtml(markdown: string): string {
    const blocks = parseReleaseNotes(markdown);
    return blocks.map(block => {
        if (block.type === 'heading') {
            const tag = block.level === 2 ? 'h4' : 'h5';
            const color = block.level === 2 ? 'var(--text-primary)' : 'var(--accent-blue)';
            const marginTop = block.level === 2 ? '0.5rem' : '1rem';
            return `<${tag} style="margin: ${marginTop} 0 0.4rem; color: ${color};">${escapeHTML(block.text)}</${tag}>`;
        }

        if (block.type === 'list') {
            const items = block.items
                .map(item => `<li style="margin-bottom: 0.35rem;">${escapeHTML(item)}</li>`)
                .join('');
            return `<ul style="margin: 0 0 0.75rem 1.2rem; color: var(--text-secondary);">${items}</ul>`;
        }

        return `<p style="margin: 0 0 0.75rem; color: var(--text-secondary);">${escapeHTML(block.text)}</p>`;
    }).join('');
}

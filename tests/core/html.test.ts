import { describe, it, expect } from 'vitest';
import { html, escapeHTML } from '../../src/core/html';

describe('core/html.ts', () => {
    describe('html tagged template', () => {
        it('should create an element from string', () => {
            const el = html`<div class="test">Hello</div>`;
            expect(el).toBeInstanceOf(HTMLElement);
            expect(el.className).toBe('test');
            expect(el.textContent).toBe('Hello');
        });

        it('should nest HTMLElements', () => {
            const child = document.createElement('span');
            child.textContent = 'Child';
            const parent = html`<div>${child}</div>`;
            expect(parent.firstElementChild).toBe(child);
            expect(parent.textContent).toBe('Child');
        });

        it('should handle arrays of HTMLElements', () => {
            const children = [
                document.createElement('span'),
                document.createElement('span')
            ];
            children[0].textContent = 'C1';
            children[1].textContent = 'C2';
            const parent = html`<div>${children}</div>`;
            expect(parent.children.length).toBe(2);
            expect(parent.textContent).toBe('C1C2');
        });

        it('should throw if no root element', () => {
            expect(() => html`Just text`).toThrow('html template must contain exactly one root element');
        });
    });

    describe('escapeHTML', () => {
        it('should escape symbols', () => {
            expect(escapeHTML('<script>')).toBe('&lt;script&gt;');
            expect(escapeHTML('Content & "more"')).toBe('Content &amp; "more"');
        });
    });
});

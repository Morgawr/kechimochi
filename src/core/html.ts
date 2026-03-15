/**
 * A simple tagged template literal for creating HTML elements.
 * Usage: html`<div class="foo">${content}</div>`
 */
export class RawHtml {
    constructor(public readonly value: string) {}
}

export function rawHtml(value: string): RawHtml {
    return new RawHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement {
    const template = document.createElement('template');
    const placeholders: Map<string, HTMLElement | HTMLElement[]> = new Map();
    let htmlString = '';
    
    strings.forEach((str, i) => {
        const val = values[i];
        if (val instanceof HTMLElement || (Array.isArray(val) && val.length > 0 && val[0] instanceof HTMLElement)) {
            const array = new Uint32Array(1);
            crypto.getRandomValues(array);
            const id = `placeholder-${array[0].toString(36)}`;
            placeholders.set(id, val);
            htmlString += str + `<div id="${id}"></div>`;
        } else if (Array.isArray(val)) {
            htmlString += str + val.map(stringifyAndEscape).join('');
        } else {
            htmlString += str + stringifyAndEscape(val);
        }
    });
    
    template.innerHTML = htmlString.trim();
    const element = template.content.firstElementChild as HTMLElement;
    
    if (!element) {
        throw new Error('html template must contain exactly one root element');
    }

    // Replace placeholders with actual elements
    placeholders.forEach((val, id) => {
        const placeholderEl = element.id === id ? element : element.querySelector(`#${id}`);
        if (placeholderEl) {
            if (Array.isArray(val)) {
                const fragment = document.createDocumentFragment();
                val.forEach(v => fragment.appendChild(v));
                placeholderEl.replaceWith(fragment);
            } else {
                placeholderEl.replaceWith(val);
            }
        }
    });
    
    return element;
}

function stringifyAndEscape(val: unknown): string {
    if (val == null) return '';
    if (val instanceof RawHtml) return val.value;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return escapeHTML(String(val));
    }
    return escapeHTML(JSON.stringify(val));
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escapeHTML(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

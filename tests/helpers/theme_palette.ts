import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STYLESHEET_PATH = resolve(process.cwd(), 'src/styles.css');
const STYLE_ELEMENT_ID = 'test-theme-palette';
const DEFAULT_THEME = 'pastel-pink';

const ROOT_BLOCK_PATTERN = /:root\s*\{([^}]*)}/;

let cachedStylesheet: string | null = null;

export function applyThemePalette(theme: string = DEFAULT_THEME): void {
    if (document.getElementById(STYLE_ELEMENT_ID) === null) {
        cachedStylesheet ??= readFileSync(STYLESHEET_PATH, 'utf8');
        const rootDeclarations = ROOT_BLOCK_PATTERN.exec(cachedStylesheet)?.[1] ?? '';
        const element = document.createElement('style');
        element.id = STYLE_ELEMENT_ID;
        element.textContent = `${cachedStylesheet}\nbody {${rootDeclarations}}`;
        document.head.appendChild(element);
    }
    document.body.dataset.theme = theme;
}

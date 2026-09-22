export const PLUS = '<path d="M12 5v14M5 12h14"/>';
export const FLAG = '<path d="M5 21V4a1 1 0 0 1 1-1h12l-3 5 3 5H6a1 1 0 0 0-1 1v8"/>';
export const CHECKMARK = '<path d="M20 6 9 17l-5-5"/>';
export const BOX = '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>';
export const FORK = '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a4 4 0 0 0 4 4h2M18 7v2a4 4 0 0 1-4 4h-2v4"/>';
export const TRASH_CAN = '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>';
export const GAUGE = '<path d="M3 18a9 9 0 0 1 18 0"/><path d="M12 18l4.5-5.5"/>';
export const WIDGET_GRID = '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1" opacity="0.35"/>';

const ICON_VIEWBOX = '0 0 24 24';

export function renderIcon(iconMarkup: string, sizePx: number): string {
    return `<svg width="${sizePx}" height="${sizePx}" viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup}</svg>`;
}

export const PLUS = '<path d="M12 5v14M5 12h14"/>';
export const FLAG = '<path d="M5 21V4a1 1 0 0 1 1-1h12l-3 5 3 5H6a1 1 0 0 0-1 1v8"/>';
export const CHECKMARK = '<path d="M20 6 9 17l-5-5"/>';
export const BOX = '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>';
export const FORK = '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a4 4 0 0 0 4 4h2M18 7v2a4 4 0 0 1-4 4h-2v4"/>';
export const TRASH_CAN = '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>';
export const GAUGE = '<path d="M3 18a9 9 0 0 1 18 0"/><path d="M12 18l4.5-5.5"/>';
export const WIDGET_GRID = '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1" opacity="0.35"/>';
export const DOWNLOAD = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>';
export const CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
export const HIRAGANA_KE = '<path d="M6.5 5c-1 4.5-1 9.5.5 14"/><path d="M10.5 9.5h9"/><path d="M15.5 4.5c.7 5.5.5 11-2 15.5"/>';

const ICON_VIEWBOX = '0 0 24 24';

export function renderIcon(iconMarkup: string, sizePx: number): string {
    return `<svg width="${sizePx}" height="${sizePx}" viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup}</svg>`;
}

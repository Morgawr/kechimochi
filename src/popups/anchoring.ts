import { STORAGE_KEYS } from '../constants';

export const ANCHOR_GAP_PX = 8;

// E2E only: parallel test windows steal focus at random, so the harness opts out of blur dismissal to keep popup specs deterministic without giving up suite parallelism.
export function shouldCloseOnWindowBlur(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEYS.KEEP_POPUP_MENUS_ON_BLUR) !== 'true';
    } catch {
        return true;
    }
}

export function positionPanelBelowAnchor(panelElement: HTMLElement, anchor: HTMLElement): void {
    const { width, height } = panelElement.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();

    const preferredLeft = anchorRect.left;
    const left = preferredLeft + width > globalThis.innerWidth ? globalThis.innerWidth - width : preferredLeft;
    let top = anchorRect.bottom + ANCHOR_GAP_PX;
    if (top + height > globalThis.innerHeight) top = anchorRect.top - ANCHOR_GAP_PX - height;

    panelElement.style.left = `${Math.max(0, left)}px`;
    panelElement.style.top = `${Math.max(0, top)}px`;
}

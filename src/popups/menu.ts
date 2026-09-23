import { escapeHTML } from '../html';
import { ANCHOR_GAP_PX, shouldCloseOnWindowBlur } from './anchoring';

const ICON_VIEWBOX = '0 0 24 24';
const ICON_SIZE_PX = 14;

export interface PopupMenuItem {
    actionId: string;
    label: string;
    iconMarkup?: string;
    elementId?: string;
    isDanger?: boolean;
    separatorBefore?: boolean;
    onSelect: () => void;
}

type PopupMenuAnchor =
    | { kind: 'point'; clientX: number; clientY: number }
    | { kind: 'element'; element: HTMLElement; align: 'start' | 'end' };

interface PopupMenuOptions {
    label: string;
    anchor: PopupMenuAnchor;
    items: PopupMenuItem[];
    onClose?: () => void;
}

export interface PopupMenuHandle {
    close: () => void;
}

function createMenuItemButton(item: PopupMenuItem): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = item.isDanger ? 'popup-menu-item popup-menu-item-danger' : 'popup-menu-item';
    button.dataset.actionId = item.actionId;
    if (item.elementId) button.id = item.elementId;
    const icon = item.iconMarkup
        ? `<svg width="${ICON_SIZE_PX}" height="${ICON_SIZE_PX}" viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.iconMarkup}</svg>`
        : '';
    button.innerHTML = `${icon}<span>${escapeHTML(item.label)}</span>`;
    return button;
}

function positionMenu(menuElement: HTMLElement, anchor: PopupMenuAnchor): void {
    const { width, height } = menuElement.getBoundingClientRect();
    let left: number;
    let top: number;

    if (anchor.kind === 'point') {
        left = anchor.clientX + width > globalThis.innerWidth ? anchor.clientX - width : anchor.clientX;
        top = anchor.clientY + height > globalThis.innerHeight ? anchor.clientY - height : anchor.clientY;
    } else {
        const anchorRect = anchor.element.getBoundingClientRect();
        const preferredLeft = anchor.align === 'end' ? anchorRect.right - width : anchorRect.left;
        left = preferredLeft + width > globalThis.innerWidth ? globalThis.innerWidth - width : preferredLeft;
        top = anchorRect.bottom + ANCHOR_GAP_PX;
        if (top + height > globalThis.innerHeight) top = anchorRect.top - ANCHOR_GAP_PX - height;
    }

    menuElement.style.left = `${Math.max(0, left)}px`;
    menuElement.style.top = `${Math.max(0, top)}px`;
}

export function openPopupMenu(options: PopupMenuOptions): PopupMenuHandle {
    const { label, anchor, items, onClose } = options;
    const anchorElement = anchor.kind === 'element' ? anchor.element : null;
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const anchorRectAtOpen = anchorElement?.getBoundingClientRect();

    const menuElement = document.createElement('div');
    menuElement.className = 'popup-menu';
    menuElement.setAttribute('role', 'menu');
    menuElement.setAttribute('aria-label', label);

    const buttons: HTMLButtonElement[] = [];
    items.forEach((item, index) => {
        if (item.separatorBefore && index > 0) {
            const separator = document.createElement('div');
            separator.className = 'popup-menu-separator';
            menuElement.appendChild(separator);
        }
        const button = createMenuItemButton(item);
        button.addEventListener('click', () => {
            close();
            item.onSelect();
        });
        menuElement.appendChild(button);
        buttons.push(button);
    });

    const focusItemAt = (index: number) => {
        buttons[(index + buttons.length) % buttons.length]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            close();
            return;
        }

        const activeElement = document.activeElement;
        const currentIndex = activeElement instanceof HTMLButtonElement ? buttons.indexOf(activeElement) : -1;
        const noItemFocused = currentIndex === -1;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusItemAt(noItemFocused ? 0 : currentIndex + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusItemAt(noItemFocused ? buttons.length - 1 : currentIndex - 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            focusItemAt(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            focusItemAt(buttons.length - 1);
        }
    };

    const handleOutsidePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (menuElement.contains(target) || anchorElement?.contains(target)) return;
        close();
    };

    const handleResize = () => {
        // WebKit can deliver a queued resize after the user has opened a menu
        // in the new layout. Its position already uses those dimensions.
        if (globalThis.innerWidth !== viewportWidth || globalThis.innerHeight !== viewportHeight) {
            close();
        }
    };

    const handleScroll = () => {
        if (!anchorElement || !anchorRectAtOpen) {
            close();
            return;
        }
        const anchorRect = anchorElement.getBoundingClientRect();
        if (anchorRect.top !== anchorRectAtOpen.top || anchorRect.left !== anchorRectAtOpen.left) {
            close();
        }
    };

    let isClosed = false;
    function close() {
        if (isClosed) return;
        isClosed = true;
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('scroll', handleScroll, true);
        globalThis.removeEventListener('resize', handleResize);
        globalThis.removeEventListener('blur', close);
        menuElement.remove();
        anchorElement?.setAttribute('aria-expanded', 'false');
        onClose?.();
    }

    document.body.appendChild(menuElement);
    positionMenu(menuElement, anchor);
    anchorElement?.setAttribute('aria-expanded', 'true');

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
    globalThis.addEventListener('resize', handleResize);
    if (shouldCloseOnWindowBlur()) globalThis.addEventListener('blur', close);

    return { close };
}

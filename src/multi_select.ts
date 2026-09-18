import { escapeHTML } from './html';
import { STORAGE_KEYS } from './constants';

const ANCHOR_GAP_PX = 8;

// E2E only: parallel test windows steal focus at random, so the harness opts out of blur dismissal to keep specs deterministic without giving up suite parallelism.
function shouldCloseOnWindowBlur(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEYS.KEEP_POPUP_MENUS_ON_BLUR) !== 'true';
    } catch {
        return true;
    }
}

export interface MultiSelectItem<Value extends string> {
    readonly value: Value;
    readonly label: string;
}

export interface MultiSelectOptions<Value extends string> {
    readonly anchor: HTMLElement;
    readonly label: string;
    readonly items: readonly MultiSelectItem<Value>[];
    readonly selectedValues: ReadonlySet<Value>;
    readonly onToggle: (value: Value, isSelected: boolean) => void;
    readonly onClose?: () => void;
}

function positionPanel(panelElement: HTMLElement, anchor: HTMLElement): void {
    const { width, height } = panelElement.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();

    const preferredLeft = anchorRect.left;
    const left = preferredLeft + width > globalThis.innerWidth ? globalThis.innerWidth - width : preferredLeft;
    let top = anchorRect.bottom + ANCHOR_GAP_PX;
    if (top + height > globalThis.innerHeight) top = anchorRect.top - ANCHOR_GAP_PX - height;

    panelElement.style.left = `${Math.max(0, left)}px`;
    panelElement.style.top = `${Math.max(0, top)}px`;
}

export function openMultiSelect<Value extends string>(
    options: MultiSelectOptions<Value>,
): { close: () => void } {
    const { anchor, label, items, selectedValues, onToggle, onClose } = options;
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const anchorRectAtOpen = anchor.getBoundingClientRect();

    const panelElement = document.createElement('div');
    panelElement.className = 'multi-select-panel';
    panelElement.setAttribute('role', 'group');
    panelElement.setAttribute('aria-label', label);

    const optionListElement = document.createElement('div');
    optionListElement.className = 'multi-select-options';

    const checkboxes: HTMLInputElement[] = [];
    for (const item of items) {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'multi-select-option';
        optionLabel.innerHTML = `<input type="checkbox" value="${escapeHTML(item.value)}"><span>${escapeHTML(item.label)}</span>`;
        const checkbox = optionLabel.querySelector('input') as HTMLInputElement;
        checkbox.checked = selectedValues.has(item.value);
        checkbox.addEventListener('change', () => onToggle(item.value, checkbox.checked));
        checkboxes.push(checkbox);
        optionListElement.appendChild(optionLabel);
    }
    panelElement.appendChild(optionListElement);

    const focusableElements: HTMLElement[] = checkboxes;

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            close(true);
            return;
        }
        if (event.key !== 'Tab') return;

        const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
        if (currentIndex === -1) return;
        if (!event.shiftKey && currentIndex === focusableElements.length - 1) {
            event.preventDefault();
            focusableElements[0].focus();
        } else if (event.shiftKey && currentIndex === 0) {
            event.preventDefault();
            focusableElements[focusableElements.length - 1].focus();
        }
    };

    const handleOutsidePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panelElement.contains(target) || anchor.contains(target)) return;
        close();
    };

    const handleResize = () => {
        if (globalThis.innerWidth !== viewportWidth || globalThis.innerHeight !== viewportHeight) {
            close();
        }
    };

    const handleScroll = () => {
        const anchorRect = anchor.getBoundingClientRect();
        if (anchorRect.top !== anchorRectAtOpen.top || anchorRect.left !== anchorRectAtOpen.left) {
            close();
        }
    };

    let isClosed = false;
    function close(shouldRestoreFocus = false) {
        if (isClosed) return;
        isClosed = true;
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('scroll', handleScroll, true);
        globalThis.removeEventListener('resize', handleResize);
        globalThis.removeEventListener('blur', handleWindowBlur);
        panelElement.remove();
        anchor.setAttribute('aria-expanded', 'false');
        if (shouldRestoreFocus) anchor.focus();
        onClose?.();
    }

    function handleWindowBlur() {
        close();
    }

    panelElement.style.minWidth = `${anchorRectAtOpen.width}px`;
    document.body.appendChild(panelElement);
    positionPanel(panelElement, anchor);
    anchor.setAttribute('aria-expanded', 'true');
    checkboxes[0]?.focus();

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
    globalThis.addEventListener('resize', handleResize);
    if (shouldCloseOnWindowBlur()) globalThis.addEventListener('blur', handleWindowBlur);

    return { close };
}

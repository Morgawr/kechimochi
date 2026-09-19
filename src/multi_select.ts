import { escapeHTML } from './html';
import { STORAGE_KEYS } from './constants';
import { pushBackHandler } from './back_stack';

const ANCHOR_GAP_PX = 8;
const SHEET_LAYOUT_MEDIA_QUERY = '(max-width: 768px)';

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

export interface MultiSelectFieldOptions<Value extends string> {
    readonly id: string;
    readonly label: string;
    readonly items: readonly MultiSelectItem<Value>[];
    readonly getSelectedValues: () => ReadonlySet<Value>;
    readonly onToggle: (value: Value, isSelected: boolean) => void;
    readonly placeholderLabel?: string;
    readonly allLabel?: string;
}

export interface MultiSelectField {
    readonly element: HTMLElement;
    refresh(): void;
    close(): void;
}

const DEFAULT_PLACEHOLDER_LABEL = 'None';
const DEFAULT_ALL_LABEL = 'All';

export function createMultiSelectField<Value extends string>(
    options: MultiSelectFieldOptions<Value>,
): MultiSelectField {
    const {
        id, label, items, getSelectedValues, onToggle,
        placeholderLabel = DEFAULT_PLACEHOLDER_LABEL,
        allLabel = DEFAULT_ALL_LABEL,
    } = options;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = id;
    trigger.className = 'multi-select-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    trigger.innerHTML = `
        <span class="multi-select-trigger-value"></span>
        <span class="multi-select-trigger-counter"></span>
        <span class="multi-select-trigger-chevron" aria-hidden="true"></span>
    `;
    const valueElement = trigger.querySelector<HTMLElement>('.multi-select-trigger-value')!;
    const counterElement = trigger.querySelector<HTMLElement>('.multi-select-trigger-counter')!;

    let closePanel: (() => void) | null = null;

    function refresh(): void {
        const selectedValues = getSelectedValues();
        const selectedLabels = items.filter(item => selectedValues.has(item.value)).map(item => item.label);

        if (selectedLabels.length === 0) {
            valueElement.textContent = placeholderLabel;
            valueElement.classList.add('is-placeholder');
            counterElement.textContent = '';
        } else if (selectedLabels.length === items.length) {
            valueElement.textContent = allLabel;
            valueElement.classList.remove('is-placeholder');
            counterElement.textContent = '';
        } else {
            const [firstLabel, ...restLabels] = selectedLabels;
            valueElement.textContent = firstLabel;
            valueElement.classList.remove('is-placeholder');
            counterElement.textContent = restLabels.length > 0 ? `+${restLabels.length}` : '';
        }

        if (selectedLabels.length > 0) {
            trigger.title = ['Selected options:', ...selectedLabels.map(selectedLabel => `• ${selectedLabel}`)].join('\n');
        } else {
            trigger.removeAttribute('title');
        }
    }

    trigger.addEventListener('click', () => {
        if (closePanel) {
            closePanel();
            return;
        }
        const { close } = openMultiSelect<Value>({
            anchor: trigger,
            label,
            items,
            selectedValues: getSelectedValues(),
            onToggle: (value, isSelected) => {
                onToggle(value, isSelected);
                refresh();
            },
            onClose: () => { closePanel = null; },
        });
        closePanel = close;
    });

    refresh();

    return {
        element: trigger,
        refresh,
        close: () => closePanel?.(),
    };
}

export function openMultiSelect<Value extends string>(
    options: MultiSelectOptions<Value>,
): { close: () => void } {
    const { anchor, label, items, selectedValues, onToggle, onClose } = options;
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const anchorRectAtOpen = anchor.getBoundingClientRect();

    const sheetLayoutQuery = globalThis.matchMedia?.(SHEET_LAYOUT_MEDIA_QUERY) ?? null;
    const isSheet = sheetLayoutQuery?.matches ?? false;

    const panelElement = document.createElement('div');
    panelElement.className = isSheet ? 'multi-select-panel is-sheet' : 'multi-select-panel';
    panelElement.setAttribute('role', 'group');
    panelElement.setAttribute('aria-label', label);

    const scrimElement = isSheet ? document.createElement('div') : null;
    if (scrimElement) scrimElement.className = 'multi-select-scrim';

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

    const handleLayoutChange = () => close();

    let removeBackHandler: (() => void) | null = null;
    let isClosed = false;
    function close(shouldRestoreFocus = false) {
        if (isClosed) return;
        isClosed = true;
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('scroll', handleScroll, true);
        globalThis.removeEventListener('resize', handleResize);
        globalThis.removeEventListener('blur', handleWindowBlur);
        sheetLayoutQuery?.removeEventListener('change', handleLayoutChange);
        removeBackHandler?.();
        scrimElement?.remove();
        panelElement.remove();
        anchor.setAttribute('aria-expanded', 'false');
        if (shouldRestoreFocus) anchor.focus();
        onClose?.();
    }

    function handleWindowBlur() {
        close();
    }

    if (scrimElement) document.body.appendChild(scrimElement);
    if (!isSheet) panelElement.style.minWidth = `${anchorRectAtOpen.width}px`;
    document.body.appendChild(panelElement);
    if (!isSheet) positionPanel(panelElement, anchor);
    anchor.setAttribute('aria-expanded', 'true');
    checkboxes[0]?.focus();

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    if (!isSheet) {
        document.addEventListener('scroll', handleScroll, true);
        globalThis.addEventListener('resize', handleResize);
    }
    sheetLayoutQuery?.addEventListener('change', handleLayoutChange);
    if (shouldCloseOnWindowBlur()) globalThis.addEventListener('blur', handleWindowBlur);
    if (isSheet) removeBackHandler = pushBackHandler(() => { close(true); return true; });

    return { close };
}

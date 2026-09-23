import { escapeHTML } from '../html';
import { pushBackHandler } from '../back_stack';
import { renderIcon } from '../icons';
import { shouldCloseOnWindowBlur, positionPanelBelowAnchor } from './anchoring';

const SHEET_LAYOUT_MEDIA_QUERY = '(max-width: 768px)';
const TRIGGER_ICON_SIZE_PX = 16;

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

export interface MultiSelectCounts {
    readonly selectedCount: number;
    readonly totalCount: number;
    readonly selectedLabels: readonly string[];
}

export interface MultiSelectSummary {
    readonly value: string;
    readonly suffix?: string;
}

export type MultiSelectSummarySource = string | ((counts: MultiSelectCounts) => MultiSelectSummary);

export interface MultiSelectFieldOptions<Value extends string> {
    readonly id: string;
    readonly label: string;
    readonly items: readonly MultiSelectItem<Value>[];
    readonly getSelectedValues: () => ReadonlySet<Value>;
    readonly onToggle: (value: Value, isSelected: boolean) => void;
    readonly noneLabel?: MultiSelectSummarySource;
    readonly allLabel?: MultiSelectSummarySource;
    readonly partialLabel?: MultiSelectSummarySource;
    readonly iconMarkup?: string;
}

export interface MultiSelectField {
    readonly element: HTMLElement;
    refresh(): void;
    close(): void;
}

const DEFAULT_NONE_LABEL: MultiSelectSummarySource = 'None';
const DEFAULT_ALL_LABEL: MultiSelectSummarySource = 'All';
const DEFAULT_PARTIAL_LABEL: MultiSelectSummarySource = ({ selectedLabels }) => {
    const [firstLabel, ...restLabels] = selectedLabels;
    return restLabels.length > 0 ? { value: firstLabel, suffix: `+${restLabels.length}` } : { value: firstLabel };
};

function resolveSummary(source: MultiSelectSummarySource, counts: MultiSelectCounts): MultiSelectSummary {
    return typeof source === 'string' ? { value: source } : source(counts);
}

export function createMultiSelectField<Value extends string>(
    options: MultiSelectFieldOptions<Value>,
): MultiSelectField {
    const {
        id, label, items, getSelectedValues, onToggle, iconMarkup,
        noneLabel = DEFAULT_NONE_LABEL,
        allLabel = DEFAULT_ALL_LABEL,
        partialLabel = DEFAULT_PARTIAL_LABEL,
    } = options;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = id;
    trigger.className = 'multi-select-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    const iconSpan = iconMarkup
        ? `<span class="multi-select-trigger-icon">${renderIcon(iconMarkup, TRIGGER_ICON_SIZE_PX)}</span>`
        : '';
    trigger.innerHTML = `
        ${iconSpan}
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
        const counts: MultiSelectCounts = { selectedCount: selectedLabels.length, totalCount: items.length, selectedLabels };

        const hasNoneSelected = selectedLabels.length === 0;
        const hasAllSelected = selectedLabels.length === items.length;

        let summarySource = partialLabel;
        if (hasNoneSelected) summarySource = noneLabel;
        else if (hasAllSelected) summarySource = allLabel;

        const summary = resolveSummary(summarySource, counts);

        valueElement.textContent = summary.value;
        valueElement.classList.toggle('is-placeholder', hasNoneSelected);
        counterElement.textContent = summary.suffix ?? '';

        if (selectedLabels.length > 0) {
            trigger.title = ['Selected options:', ...selectedLabels.map(selectedLabel => `• ${selectedLabel}`)].join('\n');
        } else {
            trigger.removeAttribute('title');
        }
    }

    function togglePanel(): void {
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
    }

    trigger.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        togglePanel();
    });

    // detail === 0 is a keyboard-activated click (Enter/Space); mouse clicks were handled on press.
    trigger.addEventListener('click', (event) => {
        if (event.detail === 0) togglePanel();
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
            focusableElements.at(-1)?.focus();
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
    if (!isSheet) positionPanelBelowAnchor(panelElement, anchor);
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

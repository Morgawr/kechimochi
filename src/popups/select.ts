import { escapeHTML } from '../html';
import { CHECKMARK, renderIcon } from '../icons';
import { shouldCloseOnWindowBlur, positionPanelBelowAnchor } from './anchoring';

const CUSTOM_POPUP_MEDIA_QUERY = '(pointer: fine)';
const TYPEAHEAD_RESET_MS = 500;
const CHECKMARK_ICON_SIZE_PX = 14;
const OPEN_KEYS = new Set(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'F4']);

export type SelectPopupEntry =
    | { kind: 'group'; label: string }
    | { kind: 'option'; value: string; label: string; isDisabled: boolean; isSelected: boolean; optionIndex: number };

type SelectPopupOptionEntry = Extract<SelectPopupEntry, { kind: 'option' }>;

export function readSelectEntries(select: HTMLSelectElement): SelectPopupEntry[] {
    const entries: SelectPopupEntry[] = [];
    let optionIndex = 0;

    const readOption = (option: HTMLOptionElement, groupIsDisabled: boolean): SelectPopupOptionEntry => ({
        kind: 'option',
        value: option.value,
        label: option.label || option.text,
        isDisabled: option.disabled || groupIsDisabled,
        isSelected: option.selected,
        optionIndex: optionIndex++,
    });

    for (const child of Array.from(select.children)) {
        if (child instanceof HTMLOptGroupElement) {
            entries.push({ kind: 'group', label: child.label });
            for (const option of Array.from(child.children)) {
                if (option instanceof HTMLOptionElement) entries.push(readOption(option, child.disabled));
            }
        } else if (child instanceof HTMLOptionElement) {
            entries.push(readOption(child, false));
        }
    }

    return entries;
}

export function findTypeaheadMatch(entries: readonly SelectPopupEntry[], query: string, startIndex: number): number | null {
    if (entries.length === 0 || query.length === 0) return null;
    const lowerQuery = query.toLowerCase();

    for (let step = 1; step <= entries.length; step++) {
        const index = (((startIndex + step) % entries.length) + entries.length) % entries.length;
        const entry = entries[index];
        if (entry.kind === 'option' && !entry.isDisabled && entry.label.toLowerCase().startsWith(lowerQuery)) return index;
    }

    return null;
}

export function shouldUseCustomPopup(select: HTMLSelectElement): boolean {
    const mediaQueryList = globalThis.matchMedia?.(CUSTOM_POPUP_MEDIA_QUERY);
    return !select.multiple && !select.disabled && select.size <= 1 && (mediaQueryList?.matches ?? false);
}

function applyAccessibleName(panelElement: HTMLElement, select: HTMLSelectElement): void {
    const labelledBy = select.getAttribute('aria-labelledby');
    if (labelledBy) {
        panelElement.setAttribute('aria-labelledby', labelledBy);
        return;
    }
    const labelText = select.getAttribute('aria-label') || select.labels[0]?.textContent?.trim();
    if (labelText) panelElement.setAttribute('aria-label', labelText);
}

function generatePopupId(): string {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return `select-popup-${array[0].toString(36)}`;
}

export function openSelectPopup(select: HTMLSelectElement, onClose?: () => void): { close: () => void } {
    const entries = readSelectEntries(select);
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const anchorRectAtOpen = select.getBoundingClientRect();

    const panelElement = document.createElement('div');
    panelElement.className = 'select-popup';

    const listboxElement = document.createElement('div');
    listboxElement.id = generatePopupId();
    listboxElement.className = 'select-popup-options';
    listboxElement.setAttribute('role', 'listbox');
    applyAccessibleName(listboxElement, select);

    const rowElements: HTMLElement[] = [];
    let activeIndex = -1;

    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
        if (entry.kind === 'group') {
            const groupElement = document.createElement('div');
            groupElement.className = 'select-popup-group-label';
            groupElement.setAttribute('role', 'presentation');
            groupElement.textContent = entry.label;
            rowElements[index] = groupElement;
            fragment.appendChild(groupElement);
            return;
        }

        const optionElement = document.createElement('div');
        optionElement.className = 'select-popup-option';
        optionElement.setAttribute('role', 'option');
        optionElement.setAttribute('aria-selected', String(entry.isSelected));
        optionElement.setAttribute('aria-disabled', String(entry.isDisabled));
        optionElement.dataset.value = entry.value;
        optionElement.innerHTML = `
            <span class="select-popup-option-check">${entry.isSelected ? renderIcon(CHECKMARK, CHECKMARK_ICON_SIZE_PX) : ''}</span>
            <span>${escapeHTML(entry.label)}</span>
        `;
        optionElement.addEventListener('pointermove', () => {
            if (!entry.isDisabled) setActive(index);
        });
        optionElement.addEventListener('click', () => {
            if (!entry.isDisabled) commit(index);
        });
        rowElements[index] = optionElement;
        fragment.appendChild(optionElement);
        if (entry.isSelected) activeIndex = index;
    });
    listboxElement.appendChild(fragment);
    panelElement.appendChild(listboxElement);

    if (activeIndex === -1) activeIndex = firstActivatable();

    function setActive(index: number): void {
        if (index < 0 || index >= entries.length) return;
        if (activeIndex !== -1) rowElements[activeIndex]?.classList.remove('is-active');
        activeIndex = index;
        const rowElement = rowElements[activeIndex];
        rowElement?.classList.add('is-active');
        rowElement?.scrollIntoView({ block: 'nearest' });
    }

    function firstActivatable(): number {
        return entries.findIndex(entry => entry.kind === 'option' && !entry.isDisabled);
    }

    function lastActivatable(): number {
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index];
            if (entry.kind === 'option' && !entry.isDisabled) return index;
        }
        return -1;
    }

    function nextActivatable(fromIndex: number, direction: 1 | -1): number {
        let index = fromIndex;
        while (true) {
            index += direction;
            if (index < 0 || index >= entries.length) return fromIndex;
            const entry = entries[index];
            if (entry.kind === 'option' && !entry.isDisabled) return index;
        }
    }

    function pageStep(direction: 1 | -1): void {
        const rowHeight = rowElements[activeIndex]?.getBoundingClientRect().height || 1;
        const visibleRows = Math.max(1, Math.floor(listboxElement.clientHeight / rowHeight));
        let index = activeIndex;
        for (let step = 0; step < visibleRows; step++) {
            const next = nextActivatable(index, direction);
            if (next === index) break;
            index = next;
        }
        setActive(index);
    }

    function commit(index: number): void {
        if (!select.isConnected) return;
        const entry = entries[index];
        if (!entry || entry.kind !== 'option' || entry.isDisabled) return;
        if (select.value !== entry.value) {
            select.value = entry.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        close();
    }

    let typeaheadBuffer = '';
    let typeaheadAnchorIndex = activeIndex;
    let typeaheadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    function resetTypeahead(): void {
        typeaheadBuffer = '';
        typeaheadTimeoutId = null;
    }

    function appendTypeahead(char: string): void {
        if (typeaheadTimeoutId === null) typeaheadAnchorIndex = activeIndex;
        else clearTimeout(typeaheadTimeoutId);
        typeaheadBuffer += char.toLowerCase();
        typeaheadTimeoutId = setTimeout(resetTypeahead, TYPEAHEAD_RESET_MS);
        const match = findTypeaheadMatch(entries, typeaheadBuffer, typeaheadAnchorIndex);
        if (match !== null) setActive(match);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Tab') {
            close();
            return;
        }

        // Like a native popup, an open one takes every key; otherwise page shortcuts such as
        // MediaView's Escape / a / d handler on window still fire underneath it.
        event.stopPropagation();

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                close();
                return;
            case 'Enter':
                event.preventDefault();
                commit(activeIndex);
                return;
            case ' ':
                event.preventDefault();
                if (typeaheadBuffer.length > 0) appendTypeahead(' ');
                else commit(activeIndex);
                return;
            case 'ArrowDown':
                event.preventDefault();
                setActive(nextActivatable(activeIndex, 1));
                return;
            case 'ArrowUp':
                event.preventDefault();
                setActive(nextActivatable(activeIndex, -1));
                return;
            case 'Home':
                event.preventDefault();
                setActive(firstActivatable());
                return;
            case 'End':
                event.preventDefault();
                setActive(lastActivatable());
                return;
            case 'PageDown':
                event.preventDefault();
                pageStep(1);
                return;
            case 'PageUp':
                event.preventDefault();
                pageStep(-1);
                return;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            appendTypeahead(event.key);
        }
    };

    const handleOutsidePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panelElement.contains(target) || select.contains(target)) return;
        close();
    };

    const handleResize = () => {
        if (globalThis.innerWidth !== viewportWidth || globalThis.innerHeight !== viewportHeight) close();
    };

    const handleScroll = () => {
        const anchorRect = select.getBoundingClientRect();
        if (anchorRect.top !== anchorRectAtOpen.top || anchorRect.left !== anchorRectAtOpen.left) close();
    };

    const handleWindowBlur = () => close();
    const handleSelectBlur = () => close();

    const handlePanelMouseDown = (event: MouseEvent) => event.preventDefault();

    let isClosed = false;
    function close(): void {
        if (isClosed) return;
        isClosed = true;
        if (typeaheadTimeoutId !== null) clearTimeout(typeaheadTimeoutId);
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('scroll', handleScroll, true);
        globalThis.removeEventListener('resize', handleResize);
        globalThis.removeEventListener('blur', handleWindowBlur);
        select.removeEventListener('blur', handleSelectBlur);
        panelElement.remove();
        select.removeAttribute('aria-expanded');
        select.removeAttribute('aria-controls');
        onClose?.();
    }

    panelElement.style.minWidth = `${anchorRectAtOpen.width}px`;
    document.body.appendChild(panelElement);
    positionPanelBelowAnchor(panelElement, select);
    panelElement.addEventListener('mousedown', handlePanelMouseDown);
    setActive(activeIndex);

    select.setAttribute('aria-expanded', 'true');
    select.setAttribute('aria-controls', listboxElement.id);

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
    globalThis.addEventListener('resize', handleResize);
    select.addEventListener('blur', handleSelectBlur);
    if (shouldCloseOnWindowBlur()) globalThis.addEventListener('blur', handleWindowBlur);

    return { close };
}

export function installSelectPopups(): () => void {
    let openHandle: { select: HTMLSelectElement; close: () => void } | null = null;

    const closeOpenPopup = () => {
        const handle = openHandle;
        openHandle = null;
        handle?.close();
    };

    const open = (select: HTMLSelectElement) => {
        closeOpenPopup();
        const { close } = openSelectPopup(select, () => {
            if (openHandle?.select === select) openHandle = null;
        });
        openHandle = { select, close };
    };

    const handleMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !shouldUseCustomPopup(target)) return;

        // A native select opens its OS picker on the mousedown default action, before any
        // click fires, so suppressing that here is the only way to show ours instead. That
        // also skips the default action's own focusing, hence the explicit focus() below.
        event.preventDefault();
        target.focus();

        if (openHandle?.select === target) {
            closeOpenPopup();
            return;
        }
        open(target);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        const target = document.activeElement;
        if (!(target instanceof HTMLSelectElement) || !shouldUseCustomPopup(target)) return;
        if (openHandle?.select === target || !OPEN_KEYS.has(event.key)) return;

        event.preventDefault();
        open(target);
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
        document.removeEventListener('mousedown', handleMouseDown, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        closeOpenPopup();
    };
}

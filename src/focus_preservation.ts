export interface FocusState extends SelectionState {
    elementId: string;
}

interface SelectionState {
    selectionStart: number | null;
    selectionEnd: number | null;
}

function captureSelectionState(element: HTMLElement): SelectionState {
    return {
        selectionStart: 'selectionStart' in element ? (element as HTMLInputElement).selectionStart : null,
        selectionEnd: 'selectionEnd' in element ? (element as HTMLInputElement).selectionEnd : null,
    };
}

function focusElementWithSelection(element: HTMLElement, selectionStart: number | null, selectionEnd: number | null): void {
    element.focus({ preventScroll: true });
    if (selectionStart === null || selectionEnd === null) return;
    if (!('setSelectionRange' in element)) return;

    try {
        (element as HTMLInputElement).setSelectionRange(selectionStart, selectionEnd);
    } catch {
        // Some input types (e.g. number, email) do not support text selection.
    }
}

/**
 * Captures which element inside `root` is focused, so it can be restored after an
 * `innerHTML` replacement detaches and recreates it.
 */
export function captureFocusState(root: HTMLElement): FocusState | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return null;
    if (!root.contains(activeElement)) return null;
    if (!activeElement.id) return null;

    return {
        elementId: activeElement.id,
        ...captureSelectionState(activeElement),
    };
}

export function restoreFocusState(root: HTMLElement, state: FocusState | null): void {
    if (!state) return;

    const element = document.getElementById(state.elementId);
    if (!element || !root.contains(element)) return;

    focusElementWithSelection(element, state.selectionStart, state.selectionEnd);
}

export interface HostFocusState extends SelectionState {
    selector: string;
}

/**
 * Same idea as `captureFocusState`/`restoreFocusState`, for hosts whose patched elements have no
 * `id` (delegated-listener regions rendered from a list): the element is instead identified by its
 * `data-focus-key` plus its `data-level-index`/`data-rule-index` (and `data-direction`/`data-negated`
 * where a class has more than one control per index).
 */
export function captureHostFocusState(host: HTMLElement): HostFocusState | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !host.contains(activeElement)) return null;

    const focusKey = activeElement.dataset.focusKey;
    const index = activeElement.dataset.levelIndex ?? activeElement.dataset.ruleIndex;
    if (!focusKey || index === undefined) return null;
    const indexAttribute = activeElement.dataset.levelIndex !== undefined ? 'data-level-index' : 'data-rule-index';
    const direction = activeElement.dataset.direction;
    const directionSelector = direction === undefined ? '' : `[data-direction="${direction}"]`;
    const negated = activeElement.dataset.negated;
    const negatedSelector = negated === undefined ? '' : `[data-negated="${negated}"]`;

    return {
        selector: `[data-focus-key="${focusKey}"][${indexAttribute}="${index}"]${directionSelector}${negatedSelector}`,
        ...captureSelectionState(activeElement),
    };
}

export function restoreHostFocusState(host: HTMLElement, state: HostFocusState | null): void {
    if (!state) return;

    const element = host.querySelector<HTMLElement>(state.selector);
    if (!element) return;

    focusElementWithSelection(element, state.selectionStart, state.selectionEnd);
}

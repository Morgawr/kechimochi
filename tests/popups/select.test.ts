import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    findTypeaheadMatch,
    installSelectPopups,
    readSelectEntries,
    shouldUseCustomPopup,
    type SelectPopupEntry,
} from '../../src/popups/select';
import {createMultiSelectField} from '../../src/popups/multi_select';
import {STORAGE_KEYS} from '../../src/constants';

function stubMatchMedia(isPointerFine: boolean): void {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query === '(pointer: fine)' && isPointerFine,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })));
}

function createSelect(markup: string, value?: string): HTMLSelectElement {
    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    const select = container.querySelector('select')!;
    // happy-dom doesn't implement HTMLSelectElement.size; browsers reflect the attribute (default 0).
    const sizeAttribute = select.getAttribute('size');
    if (!('size' in select)) {
        Object.defineProperty(select, 'size', { value: Number(sizeAttribute ?? 0) });
    }
    if (value !== undefined) select.value = value;
    vi.spyOn(select, 'getBoundingClientRect').mockReturnValue({
        width: 160, height: 32, top: 100, left: 50, right: 210, bottom: 132, x: 50, y: 100, toJSON: () => ({}),
    });
    return select;
}

const FRUIT_MARKUP = `
    <span id="fruit-label">Fruit</span>
    <select id="fruit" aria-labelledby="fruit-label">
        <option value="apple">Apple</option>
        <option value="banana" disabled>Banana</option>
        <option value="cherry">Cherry</option>
        <option value="cranberry">Cranberry</option>
    </select>
`;

function pressMouse(target: Element, button = 0): MouseEvent {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button });
    target.dispatchEvent(event);
    return event;
}

function pressKey(target: EventTarget, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

function getPopup(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.select-popup');
}

function getOption(value: string): HTMLElement {
    return document.querySelector<HTMLElement>(`.select-popup-option[data-value="${value}"]`)!;
}

function getActiveOptionValue(): string | undefined {
    return document.querySelector<HTMLElement>('.select-popup-option.is-active')?.dataset.value;
}

describe('readSelectEntries', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('should list options in order with their selected and disabled state', () => {
        const select = createSelect(FRUIT_MARKUP, 'cherry');

        expect(readSelectEntries(select)).toEqual([
            { kind: 'option', value: 'apple', label: 'Apple', isDisabled: false, isSelected: false, optionIndex: 0 },
            { kind: 'option', value: 'banana', label: 'Banana', isDisabled: true, isSelected: false, optionIndex: 1 },
            { kind: 'option', value: 'cherry', label: 'Cherry', isDisabled: false, isSelected: true, optionIndex: 2 },
            { kind: 'option', value: 'cranberry', label: 'Cranberry', isDisabled: false, isSelected: false, optionIndex: 3 },
        ]);
    });

    it('should emit a group entry before each optgroup and disable the options of a disabled optgroup', () => {
        const select = createSelect(`
            <select>
                <option value="default">Default</option>
                <optgroup label="Library"><option value="title">Title</option></optgroup>
                <optgroup label="Fields" disabled><option value="custom">Custom</option></optgroup>
            </select>
        `);

        const entries = readSelectEntries(select);

        expect(entries.map(entry => entry.kind === 'group' ? `group:${entry.label}` : entry.value))
            .toEqual(['default', 'group:Library', 'title', 'group:Fields', 'custom']);
        expect(entries[4]).toMatchObject({ value: 'custom', isDisabled: true, optionIndex: 2 });
    });
});

describe('findTypeaheadMatch', () => {
    const entries: SelectPopupEntry[] = [
        { kind: 'group', label: 'Carrots' },
        { kind: 'option', value: 'apple', label: 'Apple', isDisabled: false, isSelected: false, optionIndex: 0 },
        { kind: 'option', value: 'cabbage', label: 'Cabbage', isDisabled: true, isSelected: false, optionIndex: 1 },
        { kind: 'option', value: 'cherry', label: 'Cherry', isDisabled: false, isSelected: false, optionIndex: 2 },
        { kind: 'option', value: 'cranberry', label: 'Cranberry', isDisabled: false, isSelected: false, optionIndex: 3 },
    ];

    it('should find the next enabled option starting with the query, ignoring case', () => {
        expect(findTypeaheadMatch(entries, 'CR', 1)).toBe(4);
    });

    it('should search after the start index and wrap around', () => {
        expect(findTypeaheadMatch(entries, 'c', 3)).toBe(4);
        expect(findTypeaheadMatch(entries, 'c', 4)).toBe(3);
    });

    it('should skip disabled options and group labels', () => {
        expect(findTypeaheadMatch(entries, 'ca', 1)).toBeNull();
    });

    it('should return null for an empty query or no match', () => {
        expect(findTypeaheadMatch(entries, '', 0)).toBeNull();
        expect(findTypeaheadMatch(entries, 'zucchini', 0)).toBeNull();
    });
});

describe('shouldUseCustomPopup', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should accept a plain select when the pointer is fine', () => {
        stubMatchMedia(true);

        expect(shouldUseCustomPopup(createSelect(FRUIT_MARKUP))).toBe(true);
    });

    it('should reject every select when the pointer is not fine', () => {
        stubMatchMedia(false);

        expect(shouldUseCustomPopup(createSelect(FRUIT_MARKUP))).toBe(false);
    });

    it('should reject every select when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);

        expect(shouldUseCustomPopup(createSelect(FRUIT_MARKUP))).toBe(false);
    });

    it('should reject multiple, disabled and list-box sized selects', () => {
        stubMatchMedia(true);

        expect(shouldUseCustomPopup(createSelect('<select multiple><option>A</option></select>'))).toBe(false);
        expect(shouldUseCustomPopup(createSelect('<select disabled><option>A</option></select>'))).toBe(false);
        expect(shouldUseCustomPopup(createSelect('<select size="4"><option>A</option></select>'))).toBe(false);
    });
});

describe('installSelectPopups', () => {
    let uninstall: () => void;
    let select: HTMLSelectElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        sessionStorage.clear();
        stubMatchMedia(true);
        Element.prototype.scrollIntoView = vi.fn();
        uninstall = installSelectPopups();
        select = createSelect(FRUIT_MARKUP, 'apple');
    });

    afterEach(() => {
        uninstall();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('should open the popup on a primary mousedown and suppress the native picker', () => {
        const event = pressMouse(select);

        expect(event.defaultPrevented).toBe(true);
        expect(getPopup()).not.toBeNull();
        expect(document.activeElement).toBe(select);
    });

    it('should leave the native picker alone when the pointer is not fine', () => {
        stubMatchMedia(false);

        const event = pressMouse(select);

        expect(event.defaultPrevented).toBe(false);
        expect(getPopup()).toBeNull();
    });

    it('should ignore non-primary mouse buttons', () => {
        const event = pressMouse(select, 2);

        expect(event.defaultPrevented).toBe(false);
        expect(getPopup()).toBeNull();
    });

    it('should close the popup on a second mousedown on the same select', () => {
        pressMouse(select);
        pressMouse(select);

        expect(getPopup()).toBeNull();
    });

    it('should keep only one popup open when another select is pressed', () => {
        const otherSelect = createSelect('<select id="other"><option value="x">X</option></select>');

        pressMouse(select);
        pressMouse(otherSelect);

        expect(document.querySelectorAll('.select-popup')).toHaveLength(1);
        expect(getOption('x')).not.toBeNull();
    });

    it('should render optgroup labels and check only the selected option', () => {
        const groupedSelect = createSelect(`
            <select id="sort">
                <optgroup label="Library"><option value="title">Title</option></optgroup>
                <optgroup label="Activity"><option value="last">Last Activity</option></optgroup>
            </select>
        `, 'last');

        pressMouse(groupedSelect);

        const groupLabels = Array.from(document.querySelectorAll('.select-popup-group-label')).map(element => element.textContent);
        expect(groupLabels).toEqual(['Library', 'Activity']);
        expect(getOption('last').getAttribute('aria-selected')).toBe('true');
        expect(getOption('last').querySelector('svg')).not.toBeNull();
        expect(getOption('title').getAttribute('aria-selected')).toBe('false');
        expect(getOption('title').querySelector('svg')).toBeNull();
    });

    it('should set the value and dispatch input then change when an option is clicked', () => {
        const dispatchedEvents: string[] = [];
        select.addEventListener('input', () => dispatchedEvents.push(`input:${select.value}`));
        select.addEventListener('change', () => dispatchedEvents.push(`change:${select.value}`));

        pressMouse(select);
        getOption('cherry').click();

        expect(select.value).toBe('cherry');
        expect(dispatchedEvents).toEqual(['input:cherry', 'change:cherry']);
        expect(getPopup()).toBeNull();
    });

    it('should close without dispatching events when the selected option is clicked', () => {
        const onChange = vi.fn();
        select.addEventListener('change', onChange);

        pressMouse(select);
        getOption('apple').click();

        expect(onChange).not.toHaveBeenCalled();
        expect(getPopup()).toBeNull();
    });

    it('should ignore clicks on disabled options', () => {
        pressMouse(select);
        getOption('banana').click();

        expect(select.value).toBe('apple');
        expect(getPopup()).not.toBeNull();
    });

    it('should cancel the mousedown on an option so focus stays on the select', () => {
        pressMouse(select);

        const event = pressMouse(getOption('cherry'));

        expect(event.defaultPrevented).toBe(true);
    });

    it.each(['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'])('should open the popup on %j on a focused select', key => {
        select.focus();

        const event = pressKey(select, key);

        expect(event.defaultPrevented).toBe(true);
        expect(getPopup()).not.toBeNull();
    });

    it('should not open the popup on other keys', () => {
        select.focus();

        pressKey(select, 'c');

        expect(getPopup()).toBeNull();
    });

    it('should move through enabled options with the arrow keys and commit with Enter', () => {
        select.focus();
        pressKey(select, 'Enter');
        expect(getActiveOptionValue()).toBe('apple');

        pressKey(select, 'ArrowDown');
        expect(getActiveOptionValue()).toBe('cherry');

        pressKey(select, 'End');
        expect(getActiveOptionValue()).toBe('cranberry');

        pressKey(select, 'ArrowDown');
        expect(getActiveOptionValue()).toBe('cranberry');

        pressKey(select, 'Home');
        pressKey(select, 'Enter');
        expect(select.value).toBe('apple');
        expect(getPopup()).toBeNull();
    });

    it('should jump to the typed option and reset the typeahead after a pause', () => {
        vi.useFakeTimers();
        select.focus();
        pressKey(select, 'Enter');

        pressKey(select, 'c');
        pressKey(select, 'r');
        expect(getActiveOptionValue()).toBe('cranberry');

        vi.advanceTimersByTime(500);
        pressKey(select, 'c');
        expect(getActiveOptionValue()).toBe('cherry');
    });

    it('should close without committing on Escape', () => {
        select.focus();
        pressKey(select, 'Enter');
        pressKey(select, 'ArrowDown');

        pressKey(select, 'Escape');

        expect(select.value).toBe('apple');
        expect(getPopup()).toBeNull();
    });

    it('should stop key events from reaching window listeners while open', () => {
        select.focus();
        pressKey(select, 'Enter');
        const windowListener = vi.fn();
        globalThis.addEventListener('keydown', windowListener);

        pressKey(select, 'a');
        pressKey(select, 'ArrowLeft');
        pressKey(select, 'Escape');

        expect(windowListener).not.toHaveBeenCalled();
        globalThis.removeEventListener('keydown', windowListener);
    });

    it('should close on Tab without cancelling it', () => {
        select.focus();
        pressKey(select, 'Enter');

        const event = pressKey(select, 'Tab');

        expect(event.defaultPrevented).toBe(false);
        expect(getPopup()).toBeNull();
    });

    it('should close on an outside pointerdown without cancelling it', () => {
        const outsideButton = document.createElement('button');
        document.body.appendChild(outsideButton);
        pressMouse(select);

        const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
        outsideButton.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(getPopup()).toBeNull();
    });

    it('should open a multiselect pressed while the popup is open, in the same gesture', () => {
        const multiSelectField = createMultiSelectField({
            id: 'cards',
            label: 'Cards',
            items: [{ value: 'heatmap', label: 'Heatmap' }],
            getSelectedValues: () => new Set<string>(),
            onToggle: vi.fn(),
        });
        document.body.appendChild(multiSelectField.element);
        pressMouse(select);

        multiSelectField.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        pressMouse(multiSelectField.element);

        expect(getPopup()).toBeNull();
        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('should close when the select loses focus', () => {
        pressMouse(select);

        select.blur();

        expect(getPopup()).toBeNull();
    });

    it('should close on window blur', () => {
        pressMouse(select);

        globalThis.dispatchEvent(new Event('blur'));

        expect(getPopup()).toBeNull();
    });

    it('should stay open on window blur when the E2E keep-open flag is set', () => {
        sessionStorage.setItem(STORAGE_KEYS.KEEP_POPUP_MENUS_ON_BLUR, 'true');
        pressMouse(select);

        globalThis.dispatchEvent(new Event('blur'));

        expect(getPopup()).not.toBeNull();
    });

    it('should expose the open state and listbox on the select only while open', () => {
        pressMouse(select);

        const listbox = document.querySelector('[role="listbox"]')!;
        expect(select.getAttribute('aria-expanded')).toBe('true');
        expect(select.getAttribute('aria-controls')).toBe(listbox.id);
        expect(listbox.getAttribute('aria-labelledby')).toBe('fruit-label');

        pressKey(select, 'Escape');

        expect(select.hasAttribute('aria-expanded')).toBe(false);
        expect(select.hasAttribute('aria-controls')).toBe(false);
    });

    it('should stop intercepting after uninstall', () => {
        uninstall();

        const event = pressMouse(select);

        expect(event.defaultPrevented).toBe(false);
        expect(getPopup()).toBeNull();
    });
});

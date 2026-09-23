import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createMultiSelectField, openMultiSelect} from '../../src/popups/multi_select';
import {STORAGE_KEYS} from '../../src/constants';
import {configureBackStack, resetBackStack} from '../../src/back_stack';

type Value = 'a' | 'b' | 'c';

const ITEMS = [
    { value: 'a' as Value, label: 'Alpha' },
    { value: 'b' as Value, label: 'Bravo' },
    { value: 'c' as Value, label: 'Charlie' },
];

function stubMatchMedia(matches: boolean): { fireChange: (matches: boolean) => void } {
    let changeListener: ((event: { matches: boolean }) => void) | undefined;
    const mediaQueryList = {
        matches,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => {
            changeListener = listener;
        }),
        removeEventListener: vi.fn(() => { changeListener = undefined; }),
        dispatchEvent: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList));
    return {
        fireChange: matchesValue => {
            mediaQueryList.matches = matchesValue;
            changeListener?.({ matches: matchesValue });
        },
    };
}

function createAnchor(width = 120): HTMLButtonElement {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        width, height: 32, top: 100, left: 50, right: 50 + width, bottom: 132, x: 50, y: 100, toJSON: () => ({}),
    });
    return anchor;
}

describe('openMultiSelect — popup mode', () => {
    let anchor: HTMLButtonElement;
    let onToggle: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.innerHTML = '';
        stubMatchMedia(false);
        anchor = createAnchor();
        onToggle = vi.fn();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function open(onClose?: () => void) {
        return openMultiSelect<Value>({
            anchor,
            label: 'Items',
            items: ITEMS,
            selectedValues: new Set(['a']),
            onToggle,
            onClose,
        });
    }

    it('focuses the first checkbox on open', () => {
        open();
        const firstCheckbox = document.querySelector<HTMLInputElement>('.multi-select-options input');
        expect(document.activeElement).toBe(firstCheckbox);
    });

    it('stays open across multiple toggles', () => {
        open();
        const checkboxes = document.querySelectorAll<HTMLInputElement>('.multi-select-options input');

        checkboxes[1].click();
        checkboxes[2].click();

        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
        expect(onToggle).toHaveBeenNthCalledWith(1, 'b', true);
        expect(onToggle).toHaveBeenNthCalledWith(2, 'c', true);
    });

    it('closes on Escape and restores focus to the anchor', () => {
        const anchorFocusSpy = vi.spyOn(anchor, 'focus');
        open();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(document.querySelector('.multi-select-panel')).toBeNull();
        expect(anchorFocusSpy).toHaveBeenCalled();
    });

    it('closes on an outside pointerdown without restoring focus', () => {
        const anchorFocusSpy = vi.spyOn(anchor, 'focus');
        open();

        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(document.querySelector('.multi-select-panel')).toBeNull();
        expect(anchorFocusSpy).not.toHaveBeenCalled();
    });

    it('does not close on a pointerdown inside the panel or the anchor', () => {
        open();
        const panel = document.querySelector('.multi-select-panel')!;

        panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('wraps Tab forward from the last checkbox to the first', () => {
        open();
        const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.multi-select-options input'));
        checkboxes[checkboxes.length - 1].focus();

        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        document.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(checkboxes[0]);
    });

    it('wraps Shift+Tab backward from the first checkbox to the last', () => {
        open();
        const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.multi-select-options input'));
        checkboxes[0].focus();

        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(checkboxes[checkboxes.length - 1]);
    });

    it('gives the panel at least the anchor\'s width', () => {
        open();
        const panel = document.querySelector<HTMLElement>('.multi-select-panel')!;

        expect(panel.style.minWidth).toBe('120px');
    });

    it('closes on window blur by default', () => {
        open();

        globalThis.dispatchEvent(new Event('blur'));

        expect(document.querySelector('.multi-select-panel')).toBeNull();
    });

    it('does not close on window blur when KEEP_POPUP_MENUS_ON_BLUR is set', () => {
        sessionStorage.setItem(STORAGE_KEYS.KEEP_POPUP_MENUS_ON_BLUR, 'true');
        open();

        globalThis.dispatchEvent(new Event('blur'));

        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('calls onClose exactly once when closed', () => {
        const onClose = vi.fn();
        open(onClose);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('openMultiSelect — sheet mode', () => {
    let anchor: HTMLButtonElement;
    let layoutQuery: { fireChange: (matches: boolean) => void };
    let capturedBackHandler: (() => void | Promise<void>) | null = null;

    function configureCapturingBackStack(): void {
        configureBackStack({
            subscribe: async handler => {
                capturedBackHandler = handler;
                return () => { capturedBackHandler = null; };
            },
            onEmpty: () => undefined,
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        layoutQuery = stubMatchMedia(true);
        anchor = createAnchor();
        capturedBackHandler = null;
        resetBackStack();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetBackStack();
    });

    function open() {
        return openMultiSelect<Value>({
            anchor,
            label: 'Items',
            items: ITEMS,
            selectedValues: new Set(),
            onToggle: vi.fn(),
        });
    }

    it('renders as a sheet with a scrim', () => {
        open();

        expect(document.querySelector('.multi-select-panel.is-sheet')).not.toBeNull();
        expect(document.querySelector('.multi-select-scrim')).not.toBeNull();
    });

    it('does not close on a page scroll, even one that moves the anchor', () => {
        const rectSpy = vi.spyOn(anchor, 'getBoundingClientRect');
        open();
        rectSpy.mockReturnValue({
            width: 120, height: 32, top: 40, left: 50, right: 170, bottom: 72, x: 50, y: 40, toJSON: () => ({}),
        });

        document.dispatchEvent(new Event('scroll', { bubbles: true }));

        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('does not close on a window resize, even one that changes the viewport size', () => {
        vi.stubGlobal('innerWidth', 500);
        vi.stubGlobal('innerHeight', 800);
        open();
        vi.stubGlobal('innerWidth', 320);

        globalThis.dispatchEvent(new Event('resize'));

        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('closes when the sheet/popup breakpoint changes', () => {
        open();

        layoutQuery.fireChange(false);

        expect(document.querySelector('.multi-select-panel')).toBeNull();
    });

    it('registers a back handler on open and unregisters it on close, leaving no stale stack entry', async () => {
        configureCapturingBackStack();

        const { close } = open();
        await vi.waitFor(() => expect(capturedBackHandler).not.toBeNull());

        close();

        await vi.waitFor(() => expect(capturedBackHandler).toBeNull());
    });

    it('closes through the system back button', async () => {
        configureCapturingBackStack();

        open();
        await vi.waitFor(() => expect(capturedBackHandler).not.toBeNull());

        await capturedBackHandler?.();

        expect(document.querySelector('.multi-select-panel')).toBeNull();
    });
});

describe('createMultiSelectField', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        stubMatchMedia(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function makeField(selected: Value[]) {
        const selectedValues = new Set<Value>(selected);
        return createMultiSelectField<Value>({
            id: 'test-field',
            label: 'Items',
            items: ITEMS,
            getSelectedValues: () => selectedValues,
            onToggle: (value, isSelected) => {
                if (isSelected) selectedValues.add(value); else selectedValues.delete(value);
            },
        });
    }

    it('shows the italic placeholder "None" when nothing is selected', () => {
        const field = makeField([]);
        const valueElement = field.element.querySelector('.multi-select-trigger-value')!;

        expect(valueElement.textContent).toBe('None');
        expect(valueElement.classList.contains('is-placeholder')).toBe(true);
        expect(field.element.hasAttribute('title')).toBe(false);
    });

    it('resolves an empty items list to "None", never "All"', () => {
        const field = createMultiSelectField<Value>({
            id: 'empty-field',
            label: 'Items',
            items: [],
            getSelectedValues: () => new Set(),
            onToggle: () => {},
        });

        expect(field.element.querySelector('.multi-select-trigger-value')?.textContent).toBe('None');
    });

    it('shows the non-italic label "All" when every item is selected', () => {
        const field = makeField(['a', 'b', 'c']);
        const valueElement = field.element.querySelector('.multi-select-trigger-value')!;

        expect(valueElement.textContent).toBe('All');
        expect(valueElement.classList.contains('is-placeholder')).toBe(false);
    });

    it('shows the single selected label with no counter', () => {
        const field = makeField(['b']);

        expect(field.element.querySelector('.multi-select-trigger-value')?.textContent).toBe('Bravo');
        expect(field.element.querySelector('.multi-select-trigger-counter')?.textContent).toBe('');
    });

    it('shows the first selected label plus a +N count for two or more selections', () => {
        const field = makeField(['a', 'c']);

        expect(field.element.querySelector('.multi-select-trigger-value')?.textContent).toBe('Alpha');
        expect(field.element.querySelector('.multi-select-trigger-counter')?.textContent).toBe('+1');
    });

    it('lists every selected label in item order in the tooltip', () => {
        const field = makeField(['c', 'a']);

        expect(field.element.title).toBe('Selected options:\n• Alpha\n• Charlie');
    });

    it('opens the panel on click and closes it on a second click', () => {
        const field = makeField([]);
        document.body.appendChild(field.element);

        field.element.click();
        expect(document.querySelector('.multi-select-panel')).not.toBeNull();

        field.element.click();
        expect(document.querySelector('.multi-select-panel')).toBeNull();
    });

    it('opens the panel on a primary mousedown and ignores the click that follows it', () => {
        const field = makeField([]);
        document.body.appendChild(field.element);

        const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
        field.element.dispatchEvent(mouseDown);
        field.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(document.querySelector('.multi-select-panel')).not.toBeNull();
    });

    it('ignores non-primary mouse buttons', () => {
        const field = makeField([]);
        document.body.appendChild(field.element);

        field.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }));

        expect(document.querySelector('.multi-select-panel')).toBeNull();
    });

    it('refreshes the trigger summary immediately after a panel toggle', () => {
        const field = makeField([]);
        document.body.appendChild(field.element);

        field.element.click();
        const checkbox = document.querySelector<HTMLInputElement>('.multi-select-options input[value="a"]')!;
        checkbox.click();

        expect(field.element.querySelector('.multi-select-trigger-value')?.textContent).toBe('Alpha');
    });
});

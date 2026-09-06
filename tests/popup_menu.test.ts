import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPopupMenu, type PopupMenuItem } from '../src/popup_menu';

function makeItem(overrides: Partial<PopupMenuItem> = {}): PopupMenuItem {
    return {
        actionId: 'first',
        label: 'First',
        onSelect: vi.fn(),
        ...overrides,
    };
}

function openAtPoint(items: PopupMenuItem[] = [makeItem()], onClose?: () => void) {
    return openPopupMenu({
        label: 'Test actions',
        anchor: { kind: 'point', clientX: 10, clientY: 10 },
        items,
        onClose,
    });
}

function openAnchored(anchorElement: HTMLElement, items: PopupMenuItem[] = [makeItem()]) {
    return openPopupMenu({
        label: 'Test actions',
        anchor: { kind: 'element', element: anchorElement, align: 'end' },
        items,
    });
}

function menuButtons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
}

describe('openPopupMenu', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders one menuitem per item with its action id and label', () => {
        openAtPoint([
            makeItem({ actionId: 'first', label: 'First' }),
            makeItem({ actionId: 'second', label: 'Second' }),
        ]);

        const buttons = menuButtons();
        expect(buttons.map((button) => button.dataset.actionId)).toEqual(['first', 'second']);
        expect(buttons.map((button) => button.textContent?.trim())).toEqual(['First', 'Second']);
    });

    it('labels the menu and marks it as a menu for assistive technology', () => {
        openAtPoint();
        const menu = document.querySelector('.popup-menu');

        expect(menu?.getAttribute('role')).toBe('menu');
        expect(menu?.getAttribute('aria-label')).toBe('Test actions');
    });

    it('escapes an item label rather than parsing it as markup', () => {
        openAtPoint([makeItem({ label: '<img src=x>Delete' })]);

        const span = document.querySelector('.popup-menu-item span');
        expect(span?.querySelector('img')).toBeNull();
        expect(span?.textContent).toBe('<img src=x>Delete');
    });

    it('applies the danger class only to danger items', () => {
        openAtPoint([
            makeItem({ actionId: 'plain', label: 'Plain' }),
            makeItem({ actionId: 'remove', label: 'Remove', isDanger: true }),
        ]);

        const buttons = menuButtons();
        expect(buttons[0].classList.contains('popup-menu-item-danger')).toBe(false);
        expect(buttons[1].classList.contains('popup-menu-item-danger')).toBe(true);
    });

    it('gives an item the requested element id', () => {
        openAtPoint([makeItem({ elementId: 'btn-custom-action' })]);

        expect(document.querySelector('#btn-custom-action')?.getAttribute('role')).toBe('menuitem');
    });

    it('renders a separator before an item that asks for one', () => {
        openAtPoint([
            makeItem({ actionId: 'first', label: 'First' }),
            makeItem({ actionId: 'second', label: 'Second', separatorBefore: true }),
        ]);

        const separator = document.querySelector('.popup-menu-separator');
        expect(separator?.nextElementSibling?.getAttribute('data-action-id')).toBe('second');
    });

    it('omits a leading separator on the first item', () => {
        openAtPoint([makeItem({ separatorBefore: true })]);

        expect(document.querySelector('.popup-menu-separator')).toBeNull();
    });

    it('closes before running the selected item, and reports the selection once', () => {
        const onSelect = vi.fn(() => {
            expect(document.querySelector('.popup-menu')).toBeNull();
        });
        openAtPoint([makeItem({ onSelect })]);

        menuButtons()[0].click();

        expect(onSelect).toHaveBeenCalledOnce();
    });

    it('closes on Escape', () => {
        openAtPoint();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('closes on an outside pointerdown', () => {
        openAtPoint();

        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('does not close on a pointerdown inside the menu', () => {
        openAtPoint();
        const menu = document.querySelector('.popup-menu') as HTMLElement;

        menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(document.querySelector('.popup-menu')).not.toBeNull();
    });

    it('does not close on a pointerdown on its anchor element', () => {
        const anchorElement = document.createElement('button');
        document.body.appendChild(anchorElement);
        openAnchored(anchorElement);

        anchorElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        expect(document.querySelector('.popup-menu')).not.toBeNull();
    });

    it('closes on a capture-phase scroll from any scroller', () => {
        const scroller = document.createElement('div');
        document.body.appendChild(scroller);
        openAtPoint();

        scroller.dispatchEvent(new Event('scroll'));

        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('closes on window resize and blur', () => {
        openAtPoint();
        globalThis.dispatchEvent(new Event('resize'));
        expect(document.querySelector('.popup-menu')).toBeNull();

        openAtPoint();
        globalThis.dispatchEvent(new Event('blur'));
        expect(document.querySelector('.popup-menu')).toBeNull();
    });

    it('stays open on blur when the harness has opted out of blur dismissal', () => {
        sessionStorage.setItem('kechimochi_keep_popup_menus_on_blur', 'true');
        openAtPoint();

        globalThis.dispatchEvent(new Event('blur'));
        expect(document.querySelector('.popup-menu')).not.toBeNull();

        globalThis.dispatchEvent(new Event('resize'));
        expect(document.querySelector('.popup-menu')).toBeNull();
        sessionStorage.removeItem('kechimochi_keep_popup_menus_on_blur');
    });

    it('tracks the open state on an element anchor with aria-expanded', () => {
        const anchorElement = document.createElement('button');
        document.body.appendChild(anchorElement);

        const handle = openAnchored(anchorElement);
        expect(anchorElement.getAttribute('aria-expanded')).toBe('true');

        handle.close();
        expect(anchorElement.getAttribute('aria-expanded')).toBe('false');
    });

    it('reports closing once even when close is called twice', () => {
        const onClose = vi.fn();
        const handle = openAtPoint([makeItem()], onClose);

        handle.close();
        handle.close();

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('stops listening once closed', () => {
        const onClose = vi.fn();
        const handle = openAtPoint([makeItem()], onClose);
        handle.close();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        globalThis.dispatchEvent(new Event('resize'));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('moves focus between items with ArrowDown/ArrowUp/Home/End', () => {
        openAtPoint([
            makeItem({ actionId: 'first', label: 'First' }),
            makeItem({ actionId: 'second', label: 'Second' }),
            makeItem({ actionId: 'third', label: 'Third' }),
        ]);
        const buttons = menuButtons();
        buttons[0].focus();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(document.activeElement).toBe(buttons[1]);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
        expect(document.activeElement).toBe(buttons[2]);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
        expect(document.activeElement).toBe(buttons[0]);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
        expect(document.activeElement).toBe(buttons[2]);
    });

    it('focuses the first item on ArrowDown when nothing is focused yet', () => {
        openAtPoint([
            makeItem({ actionId: 'first', label: 'First' }),
            makeItem({ actionId: 'second', label: 'Second' }),
        ]);
        const buttons = menuButtons();
        expect(document.activeElement).not.toBe(buttons[0]);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

        expect(document.activeElement).toBe(buttons[0]);
    });

    it('focuses the last item on ArrowUp when nothing is focused yet', () => {
        openAtPoint([
            makeItem({ actionId: 'first', label: 'First' }),
            makeItem({ actionId: 'second', label: 'Second' }),
        ]);
        const buttons = menuButtons();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

        expect(document.activeElement).toBe(buttons[1]);
    });
});

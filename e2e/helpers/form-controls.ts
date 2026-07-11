/**
 * Cross-platform form-control helpers.
 *
 * Value entry (text / select / checkbox) is done IN-PAGE on every platform: the
 * element is resolved by selector, its value/checked is set directly, and
 * input+change are dispatched. This path is uniform across desktop, web and
 * Android — the Android WebView's soft keyboard and native <select> control are
 * unreliable to drive, and the app reads `.value` / listens to `change`, so an
 * in-page set reproduces the app's real data flow on every platform. Interaction
 * (clicks, navigation) stays native — see helpers/common.ts.
 *
 * Resolution is overlay-aware: a selector is matched inside the topmost active
 * visible `.modal-overlay` first (so stacked modals and duplicate ids target the
 * field the user is actually looking at), falling back to the document. Each
 * settle poll re-resolves and re-applies, so a late-rendered <option> or an app
 * re-render that resets the field self-heals.
 */

export type SelectCriteria = { value: string } | { text: string };

type ApplyRequest =
    | { kind: 'text'; value: string }
    | { kind: 'selectValue'; value: string }
    | { kind: 'selectText'; text: string }
    | { kind: 'checkbox'; checked: boolean }
    | { kind: 'readSelectValue' };

type ApplyResult = boolean | string | null;

/**
 * Resolves `sel` (overlay-aware) and performs `req` against it. This runs in the
 * browser via `browser.execute`, so it must stay fully self-contained — it may not
 * reference any binding outside its own body. Write requests return whether the
 * value settled; `readSelectValue` returns the <select>'s current value (or null).
 */
function applyRequestInPage(sel: string, req: ApplyRequest): ApplyResult {
    const isVisible = (node: Element): boolean => {
        const style = globalThis.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const findTarget = (target: string): Element | null => {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay')).reverse();
        for (const overlay of overlays) {
            if (overlay instanceof HTMLElement && overlay.classList.contains('active') && isVisible(overlay)) {
                const scoped = overlay.querySelector(target);
                if (scoped) return scoped;
            }
        }
        return document.querySelector(target);
    };

    const fire = (node: HTMLElement): void => {
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const element = findTarget(sel);

    if (req.kind === 'readSelectValue') {
        return element instanceof HTMLSelectElement ? element.value : null;
    }

    if (!(element instanceof HTMLElement) || !isVisible(element)) return false;

    if (req.kind === 'text') {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
        element.value = req.value;
        fire(element);
        return element.value === req.value;
    }

    if (req.kind === 'checkbox') {
        if (!(element instanceof HTMLInputElement)) return false;
        element.checked = req.checked;
        fire(element);
        return element.checked === req.checked;
    }

    if (!(element instanceof HTMLSelectElement)) return false;
    const option = Array.from(element.options).find(opt =>
        req.kind === 'selectValue' ? opt.value === req.value : opt.text.trim() === req.text,
    );
    if (!option) return false;
    element.value = option.value;
    fire(element);
    const selected = element.selectedOptions[0];
    return req.kind === 'selectValue' ? selected?.value === req.value : selected?.text.trim() === req.text;
}

async function applyAndVerify(selector: string, request: ApplyRequest): Promise<boolean> {
    return browser.execute(applyRequestInPage, selector, request).then(result => result === true).catch(() => false);
}

export async function setText(selector: string, value: string, timeout = 5000): Promise<void> {
    await browser.waitUntil(async () => applyAndVerify(selector, { kind: 'text', value }), {
        timeout,
        interval: 100,
        timeoutMsg: `Text field "${selector}" did not accept "${value}"`,
    });
}

export async function setSelect(selector: string, criteria: SelectCriteria, timeout = 5000): Promise<void> {
    const request: ApplyRequest = 'value' in criteria
        ? { kind: 'selectValue', value: criteria.value }
        : { kind: 'selectText', text: criteria.text };
    await browser.waitUntil(async () => applyAndVerify(selector, request), {
        timeout,
        interval: 100,
        timeoutMsg: `Select "${selector}" did not settle to ${JSON.stringify(criteria)}`,
    });
}

export async function setCheckbox(selector: string, checked: boolean, timeout = 5000): Promise<void> {
    await browser.waitUntil(async () => applyAndVerify(selector, { kind: 'checkbox', checked }), {
        timeout,
        interval: 100,
        timeoutMsg: `Checkbox "${selector}" did not settle to ${checked ? 'checked' : 'unchecked'}`,
    });
}

export async function getSelectValue(selector: string): Promise<string | null> {
    const request: ApplyRequest = { kind: 'readSelectValue' };
    const result = await browser.execute(applyRequestInPage, selector, request).catch(() => null);
    return typeof result === 'string' ? result : null;
}

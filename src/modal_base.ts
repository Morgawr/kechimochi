import { escapeHTML } from './html';
import { pushBackHandler } from './back_stack';

const MODAL_VIEWPORT_PADDING = 16;
const KEYBOARD_OPEN_HEIGHT_DELTA = 80;
const DEFERRED_DATALIST_TIMEOUT_MS = 700;

function sanitizeButtonClass(input: string): string {
    if (/^[a-zA-Z0-9\-_\s]+$/.test(input)) {
        return input;
    }
    return 'btn-danger';
}

export function createOverlay(): { overlay: HTMLDivElement, cleanup: () => void } {
    const g = globalThis as unknown as Record<string, number>;
    g.__modalCounter = (g.__modalCounter || 0) + 1;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.modalId = g.__modalCounter.toString();
    
    document.body.appendChild(overlay);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    overlay.offsetWidth; // Force reflow
    overlay.classList.add('active');
    const cleanupViewportPlacement = bindOverlayToVisualViewport(overlay);

    const cleanup = () => {
        cleanupViewportPlacement();
        overlay.classList.remove('active');
        delete overlay.dataset.modalId;
        setTimeout(() => overlay.remove(), 300);
    };

    return { overlay, cleanup };
}

function bindOverlayToVisualViewport(overlay: HTMLDivElement): () => void {
    const viewport = globalThis.visualViewport;
    if (!viewport) {
        return () => undefined;
    }

    let frameId = 0;

    const updatePlacement = () => {
        frameId = 0;
        overlay.style.top = `${viewport.offsetTop}px`;
        overlay.style.height = `${viewport.height}px`;
        overlay.style.bottom = 'auto';

        const content = overlay.querySelector<HTMLElement>('.modal-content');
        if (content) {
            const availableHeight = Math.max(0, viewport.height - (MODAL_VIEWPORT_PADDING * 2));
            const contentHeight = content.getBoundingClientRect().height || content.offsetHeight;
            overlay.classList.toggle('modal-overlay--top-aligned', contentHeight > availableHeight);
        }
    };

    const schedulePlacement = () => {
        if (frameId) return;
        frameId = globalThis.requestAnimationFrame(updatePlacement);
    };

    viewport.addEventListener('resize', schedulePlacement);
    viewport.addEventListener('scroll', schedulePlacement);
    schedulePlacement();

    return () => {
        viewport.removeEventListener('resize', schedulePlacement);
        viewport.removeEventListener('scroll', schedulePlacement);
        if (frameId) {
            globalThis.cancelAnimationFrame(frameId);
        }
    };
}

function isKeyboardLikelyOpen(): boolean {
    const viewport = globalThis.visualViewport;
    if (!viewport) {
        return false;
    }
    return viewport.height < globalThis.innerHeight - KEYBOARD_OPEN_HEIGHT_DELTA;
}

export function focusInput(input: HTMLInputElement, options: { deferDatalistUntilKeyboard?: boolean } = {}): () => void {
    if (!options.deferDatalistUntilKeyboard || !input.list || !globalThis.visualViewport || isKeyboardLikelyOpen()) {
        input.focus();
        return () => undefined;
    }

    const viewport = globalThis.visualViewport;
    const listId = input.getAttribute('list');
    if (!listId) {
        input.focus();
        return () => undefined;
    }

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let rafId = 0;
    let isDone = false;

    const finish = () => {
        if (isDone) return;
        isDone = true;
        viewport.removeEventListener('resize', handleViewportChange);
        viewport.removeEventListener('scroll', handleViewportChange);
        if (timeoutId) {
            globalThis.clearTimeout(timeoutId);
        }
        if (rafId) {
            globalThis.cancelAnimationFrame(rafId);
        }
        if (!input.hasAttribute('list')) {
            input.setAttribute('list', listId);
        }
    };

    const reopenSuggestions = () => {
        finish();
        if (!document.body.contains(input) || document.activeElement !== input) return;

        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.blur();
        rafId = globalThis.requestAnimationFrame(() => {
            rafId = 0;
            if (!document.body.contains(input)) return;
            input.focus({ preventScroll: true });
            if (selectionStart !== null && selectionEnd !== null) {
                try {
                    input.setSelectionRange(selectionStart, selectionEnd);
                } catch {
                    // Some input types do not support text selection.
                }
            }
        });
    };

    const handleViewportChange = () => {
        if (isKeyboardLikelyOpen()) {
            reopenSuggestions();
        }
    };

    input.removeAttribute('list');
    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);
    timeoutId = globalThis.setTimeout(() => {
        finish();
    }, DEFERRED_DATALIST_TIMEOUT_MS);
    input.focus();

    return finish;
}

export function makeOverlayCancelable(overlay: HTMLDivElement, onDismiss: () => void): () => void {
    let isDismissed = false;
    let pointerStartedOnBackdrop = false;

    const dismiss = () => {
        if (isDismissed) return;
        isDismissed = true;
        onDismiss();
    };

    const handlePointerDown = (event: PointerEvent) => {
        pointerStartedOnBackdrop = event.target === overlay;
    };

    const handleBackdropClick = (event: MouseEvent) => {
        if (pointerStartedOnBackdrop && event.target === overlay) {
            dismiss();
        }
        pointerStartedOnBackdrop = false;
    };

    overlay.dataset.cancelable = 'true';
    overlay.addEventListener('pointerdown', handlePointerDown);
    overlay.addEventListener('click', handleBackdropClick);

    return () => {
        overlay.removeEventListener('pointerdown', handlePointerDown);
        overlay.removeEventListener('click', handleBackdropClick);
        delete overlay.dataset.cancelable;
    };
}

export interface CancelableOverlayHandle {
    overlay: HTMLDivElement;
    cleanup: () => void;
    dismiss: () => void;
}

export function createCancelableOverlay(onDismiss: () => void, options: { closeOnEscape?: boolean } = {}): CancelableOverlayHandle {
    const { overlay, cleanup: cleanupOverlay } = createOverlay();
    let isClosed = false;

    const cleanupFns: Array<() => void> = [];
    const teardownCancelable = makeOverlayCancelable(overlay, () => dismiss());
    cleanupFns.push(teardownCancelable, pushBackHandler(() => {
        dismiss();
        return true;
    }));

    if (options.closeOnEscape) {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
            }
        };
        globalThis.addEventListener('keydown', handleEscape, true);
        cleanupFns.push(() => globalThis.removeEventListener('keydown', handleEscape, true));
    }

    const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        cleanupFns.forEach(fn => fn());
        cleanupOverlay();
    };

    const dismiss = () => {
        if (isClosed) return;
        cleanup();
        onDismiss();
    };

    return { overlay, cleanup, dismiss };
}

export interface BlockingStatusHandle {
    close: () => void;
    setText?: (text: string) => void;
    setProgress?: (current: number, total: number, label?: string) => void;
}

export function showBlockingStatus(title: string, text: string): BlockingStatusHandle {
    const { overlay, cleanup } = createOverlay();
    const escapedTitle = escapeHTML(title);
    const escapedText = escapeHTML(text);
    let isClosed = false;

    overlay.innerHTML = `
        <div class="modal-content" role="alertdialog" aria-live="assertive" aria-busy="true" style="text-align: center; max-width: 420px; width: min(92vw, 420px); max-height: 80vh; overflow-y: auto;">
            <h3>${escapedTitle}</h3>
            <p id="blocking-status-text" style="margin-top: 1rem; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;">${escapedText}</p>
            <div style="margin-top: 1.5rem; display: flex; justify-content: center;">
                <div aria-hidden="true" style="width: 28px; height: 28px; border-radius: 999px; border: 3px solid var(--border-color); border-top-color: var(--accent-blue); animation: spin 0.8s linear infinite;"></div>
            </div>
            <div id="blocking-status-progress" style="display: none; margin-top: 1.25rem;">
                <div style="width: 100%; height: 10px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden;">
                    <div id="blocking-status-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent-blue), #6ee7f9); transition: width 0.18s ease;"></div>
                </div>
                <p id="blocking-status-progress-label" style="margin-top: 0.65rem; font-size: 0.84rem; color: var(--text-secondary);">0 / 0</p>
            </div>
        </div>
    `;

    const textNode = overlay.querySelector<HTMLParagraphElement>('#blocking-status-text');
    const progressWrap = overlay.querySelector<HTMLDivElement>('#blocking-status-progress');
    const progressBar = overlay.querySelector<HTMLDivElement>('#blocking-status-progress-bar');
    const progressLabel = overlay.querySelector<HTMLParagraphElement>('#blocking-status-progress-label');

    return {
        setText: (nextText: string) => {
            if (isClosed || !textNode) return;
            textNode.textContent = nextText;
        },
        setProgress: (current: number, total: number, label?: string) => {
            if (isClosed || !progressWrap || !progressBar || !progressLabel) return;
            if (total <= 0) {
                progressWrap.style.display = 'none';
                return;
            }

            const safeCurrent = Math.max(0, Math.min(current, total));
            const percent = Math.max(0, Math.min((safeCurrent / total) * 100, 100));
            progressWrap.style.display = 'block';
            progressBar.style.width = `${percent}%`;
            progressLabel.textContent = label || `${safeCurrent} / ${total}`;
        },
        close: () => {
            if (isClosed) return;
            isClosed = true;
            cleanup();
        }
    };
}

export async function customPrompt(title: string, defaultValue = "", text = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(null));
        const escapedTitle = escapeHTML(title);
        const escapedDefaultValue = escapeHTML(defaultValue);
        const escapedText = text ? escapeHTML(text) : '';
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${escapedTitle}</h3>
                <div style="margin-top: 1rem;">
                    <input type="text" id="prompt-input" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" value="${escapedDefaultValue}" autocomplete="off" />
                </div>
                ${escapedText ? `<p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">${escapedText}</p>` : ''}
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="prompt-cancel">Cancel</button>
                    <button class="btn btn-primary" id="prompt-confirm">OK</button>
                </div>
            </div>
        `;
        
        const input = overlay.querySelector<HTMLInputElement>('#prompt-input')!;
        const confirm = () => {
            cleanup();
            resolve(input.value);
        };
        
        overlay.querySelector('#prompt-cancel')?.addEventListener('click', dismiss);
        overlay.querySelector('#prompt-confirm')!.addEventListener('click', confirm);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { confirm(); }
            if (e.key === 'Escape') { dismiss(); }
        });
        
        input.focus();
    });
}

export async function customConfirm(title: string, text: string, confirmButtonClass = "btn-danger", confirmButtonText = "Yes"): Promise<boolean> {
    return new Promise((resolve) => {
        const { overlay, cleanup, dismiss } = createCancelableOverlay(() => resolve(false));
        const escapedTitle = escapeHTML(title);
        const escapedText = escapeHTML(text);
        const safeConfirmButtonClass = sanitizeButtonClass(confirmButtonClass);
        const escapedConfirmButtonText = escapeHTML(confirmButtonText);
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${escapedTitle}</h3>
                <p style="margin-top: 1rem; color: var(--text-secondary);">${escapedText}</p>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
                    <button class="btn ${safeConfirmButtonClass}" id="confirm-ok">${escapedConfirmButtonText}</button>
                </div>
            </div>
        `;
        
        overlay.querySelector('#confirm-cancel')!.addEventListener('click', dismiss);
        overlay.querySelector('#confirm-ok')!.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
    });
}

export async function customAlert(title: string, text: string): Promise<void> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createCancelableOverlay(resolve);
        const escapedTitle = escapeHTML(title);
        const escapedText = escapeHTML(text);
        
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 520px; width: min(92vw, 520px); max-height: 80vh; overflow-y: auto;">
                <h3>${escapedTitle}</h3>
                <p id="alert-body" style="margin-top: 1rem; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;">${escapedText}</p>
                <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="alert-ok">OK</button>
                </div>
            </div>
        `;

        overlay.querySelector('#alert-ok')!.addEventListener('click', () => {
            cleanup();
            resolve();
        });
    });
}

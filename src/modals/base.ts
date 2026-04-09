import { escapeHTML } from '../core/html';

function sanitizeButtonClass(input: string): string {
    if (/^[a-zA-Z0-9\-_\s]+$/.test(input)) {
        return input;
    }
    return 'btn-danger';
}

export function createOverlay(): { overlay: HTMLDivElement, cleanup: () => Promise<void> } {
    const g = globalThis as unknown as Record<string, number>;
    g.__modalCounter = (g.__modalCounter || 0) + 1;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.modalId = g.__modalCounter.toString();
    
    document.body.appendChild(overlay);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    overlay.offsetWidth; // Force reflow
    overlay.classList.add('active');

    const cleanup = () => {
        overlay.classList.remove('active');
        delete overlay.dataset.modalId;
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 300);
        });
    };

    return { overlay, cleanup };
}

export interface BlockingStatusHandle {
    close: () => Promise<void>;
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
        close: async () => {
            if (isClosed) return;
            isClosed = true;
            await cleanup();
        }
    };
}

export async function customPrompt(title: string, defaultValue = "", text = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
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
        
        overlay.querySelector('#prompt-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#prompt-confirm')!.addEventListener('click', () => { cleanup(); resolve(input.value); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { cleanup(); resolve(input.value); }
            if (e.key === 'Escape') { cleanup(); resolve(null); }
        });
        
        input.focus();
    });
}

export async function customConfirm(title: string, text: string, confirmButtonClass = "btn-danger", confirmButtonText = "Yes"): Promise<boolean> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
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
        
        overlay.querySelector('#confirm-cancel')!.addEventListener('click', () => { cleanup(); resolve(false); });
        overlay.querySelector('#confirm-ok')!.addEventListener('click', () => { cleanup(); resolve(true); });
    });
}

export async function customAlert(title: string, text: string): Promise<void> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
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
        
        overlay.querySelector('#alert-ok')!.addEventListener('click', () => { cleanup(); resolve(); });
    });
}

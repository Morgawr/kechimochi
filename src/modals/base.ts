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

    const cleanup = () => {
        overlay.classList.remove('active');
        // Clear IDs immediately so E2E selectors don't find dying modals
        overlay.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        delete overlay.dataset.modalId;
        setTimeout(() => overlay.remove(), 300);
    };

    return { overlay, cleanup };
}

export async function customPrompt(title: string, defaultValue = "", text = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <div style="margin-top: 1rem;">
                    <input type="text" id="prompt-input" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" value="${defaultValue}" autocomplete="off" />
                </div>
                ${text ? `<p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">${text}</p>` : ''}
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
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <p style="margin-top: 1rem; color: var(--text-secondary);">${text}</p>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
                    <button class="btn ${confirmButtonClass}" id="confirm-ok">${confirmButtonText}</button>
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
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <p id="alert-body" style="margin-top: 1rem; color: var(--text-secondary);">${text}</p>
                <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="alert-ok">OK</button>
                </div>
            </div>
        `;
        
        overlay.querySelector('#alert-ok')!.addEventListener('click', () => { cleanup(); resolve(); });
    });
}

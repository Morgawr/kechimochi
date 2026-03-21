import { createOverlay } from './base';

export async function initialProfilePrompt(defaultName: string = "User"): Promise<string> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        
        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center;">
                <h3 style="margin-bottom: 0.5rem;">Welcome to Kechimochi!</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">Please enter your name to get started.</p>
                <div style="margin-top: 1rem; text-align: left;">
                    <input type="text" id="initial-prompt-input" placeholder="e.g. ${defaultName}" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" autocomplete="off" />
                </div>
                <div style="display: flex; justify-content: center; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="initial-prompt-confirm" disabled>Start</button>
                </div>
            </div>
        `;
        
        const input = overlay.querySelector<HTMLInputElement>('#initial-prompt-input')!;
        const confirmBtn = overlay.querySelector<HTMLButtonElement>('#initial-prompt-confirm')!;
        
        const checkInput = () => {
            confirmBtn.disabled = input.value.trim().length === 0;
        };

        input.addEventListener('input', checkInput);

        confirmBtn.addEventListener('click', () => { 
            const val = input.value.trim();
            if (val) {
                cleanup(); 
                resolve(val); 
            }
        });
        
        input.addEventListener('keydown', (e) => {
            const val = input.value.trim();
            if (e.key === 'Enter' && val) { 
                cleanup(); 
                resolve(val); 
            }
        });
        
        input.focus();
    });
}

export async function initialProfilePrompt(defaultName: string = "User"): Promise<string> {
    return new Promise((resolve) => {
        (window as any).__modalCounter = ((window as any).__modalCounter || 0) + 1;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('data-overlay-id', (window as any).__modalCounter.toString());
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center;">
                <h3 style="margin-bottom: 0.5rem;">Welcome to Kechimochi!</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">Please enter a name for your first profile to get started.</p>
                <div style="margin-top: 1rem; text-align: left;">
                    <input type="text" id="initial-prompt-input" placeholder="e.g. ${defaultName}" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" autocomplete="off" />
                </div>
                <div style="display: flex; justify-content: center; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="initial-prompt-confirm" disabled>Start</button>
                </div>
            </div>
        `;
        
        const input = overlay.querySelector('#initial-prompt-input') as HTMLInputElement;
        const confirmBtn = overlay.querySelector('#initial-prompt-confirm') as HTMLButtonElement;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             overlay.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
             overlay.removeAttribute('data-overlay-id');
             setTimeout(() => overlay.remove(), 300);
        };
        
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

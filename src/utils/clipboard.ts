import { Logger } from '../core/logger';

/**
 * Sets up a copy button with an icon and success animation.
 * @param btn The button element to attach the listener to.
 * @param textToCopy The text to be copied to the clipboard.
 */
export function setupCopyButton(btn: HTMLElement, textToCopy: string) {
    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent potential parent click events
        try {
            await navigator.clipboard.writeText(textToCopy);
            btn.classList.add('success');
            const originalSvg = btn.innerHTML;
            // Success checkmark icon
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            
            setTimeout(() => {
                btn.classList.remove('success');
                btn.innerHTML = originalSvg;
            }, 2000);
        } catch (err) {
            Logger.error('Failed to copy text: ', err);
        }
    });
}

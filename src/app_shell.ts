export function syncAppShell(
    isDesktop: boolean,
    supportsWindowControls: boolean = isDesktop,
    doc: Document = document,
): void {
    doc.body.dataset.runtime = isDesktop ? 'desktop' : 'web';

    if (supportsWindowControls) {
        return;
    }

    doc.getElementById('desktop-title-bar')?.remove();
}

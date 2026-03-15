export function syncAppShell(isDesktop: boolean, doc: Document = document): void {
    doc.body.dataset.runtime = isDesktop ? 'desktop' : 'web';

    if (isDesktop) {
        return;
    }

    doc.getElementById('desktop-title-bar')?.remove();
}
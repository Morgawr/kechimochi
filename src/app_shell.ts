export function syncAppShell(
    isDesktop: boolean,
    supportsWindowControls: boolean = isDesktop,
    doc: Document = document,
): void {
    let runtime: string;
    if (supportsWindowControls) {
        runtime = 'desktop';
    } else if (isDesktop) {
        runtime = 'mobile-app';
    } else {
        runtime = 'web';
    }
    doc.body.dataset.runtime = runtime;

    if (supportsWindowControls) {
        return;
    }

    doc.getElementById('desktop-title-bar')?.remove();
}

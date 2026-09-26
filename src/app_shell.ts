import { renderIcon, DASHBOARD, LIBRARY, PLUS, SYNC, TIMELINE } from './icons';
import { VIEW_NAMES } from './constants';

type NonProfileView = Exclude<typeof VIEW_NAMES[keyof typeof VIEW_NAMES], typeof VIEW_NAMES.PROFILE>;

const NAV_LINK_ICONS: Record<NonProfileView, string> = {
    [VIEW_NAMES.DASHBOARD]: DASHBOARD,
    [VIEW_NAMES.MEDIA]: LIBRARY,
    [VIEW_NAMES.TIMELINE]: TIMELINE,
};

const NAV_LINK_ICON_SIZE_PX = 18;
export const NAVIGATION_BUTTON_ICON_SIZE_PX = 14;

export function renderNavigationIcons(doc: Document = document): void {
    for (const [view, iconMarkup] of Object.entries(NAV_LINK_ICONS)) {
        const iconSpan = doc.querySelector(`.nav-link[data-view="${view}"] .nav-link-icon`);
        if (iconSpan) iconSpan.innerHTML = renderIcon(iconMarkup, NAV_LINK_ICON_SIZE_PX);
    }

    doc.querySelectorAll('.nav-sync-status-btn, .mobile-sync-status-btn').forEach(button => {
        button.insertAdjacentHTML('afterbegin', renderIcon(SYNC, NAVIGATION_BUTTON_ICON_SIZE_PX));
    });

    doc.querySelectorAll('.activity-btn-icon').forEach(iconSpan => {
        iconSpan.innerHTML = renderIcon(PLUS, NAVIGATION_BUTTON_ICON_SIZE_PX);
    });
}

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

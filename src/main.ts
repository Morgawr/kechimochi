import { Dashboard } from './components/dashboard';
import { MediaView } from './components/media_view';
import { ProfileView } from './components/profile';
import {
    initializeUserDb, getUsername, getSetting, setSetting
} from './api';
import {
    initialProfilePrompt, showLogActivityModal
} from './modals';
import { syncAppShell } from './app_shell';
import { initServices, getServices } from './services';
import { Logger } from './core/logger';
import { STORAGE_KEYS, SETTING_KEYS, VIEW_NAMES, EVENTS, DEFAULTS } from './constants';

// Support global date mocking for E2E tests
let mockDateStr: string | null = null;
try {
    mockDateStr = sessionStorage.getItem(STORAGE_KEYS.MOCK_DATE);
    if (localStorage.getItem(STORAGE_KEYS.MOCK_DATE)) {
        localStorage.removeItem(STORAGE_KEYS.MOCK_DATE);
    }
} catch (e) {
    Logger.warn('[kechimochi] Failed to access storage for mock date:', e);
}

if (mockDateStr) {
    Logger.info(`[kechimochi] Mocking system date to: ${mockDateStr}`);
    const originalDate = Date;
    const frozenTimestamp = new Date(mockDateStr + "T12:00:00Z").getTime();

    // @ts-expect-error - overriding global Date for testing
    globalThis.Date = class extends originalDate {
        constructor(...args: unknown[]) {
            if (args.length === 0) {
                super(frozenTimestamp);
            } else {
                // @ts-expect-error - passing args to original Date
                super(...args);
            }
        }
        static now() {
            return frozenTimestamp;
        }
    };
}
type ViewType = typeof VIEW_NAMES[keyof typeof VIEW_NAMES];

class App {
    private currentView: ViewType = VIEW_NAMES.DASHBOARD;
    private currentProfile: string = '';

    private readonly dashboard: Dashboard;
    private readonly mediaView: MediaView;
    private readonly profileView: ProfileView;

    private readonly viewContainer: HTMLElement;
    private readonly dashboardContainer: HTMLElement;
    private readonly mediaContainer: HTMLElement;
    private readonly profileContainer: HTMLElement;

    private readonly navUserNameEl: HTMLElement;
    private readonly devBuildBadgeEl: HTMLElement | null;
    private readonly navLinks: NodeListOf<HTMLElement>;

    constructor() {
        this.viewContainer = document.getElementById('view-container')!;
        this.navUserNameEl = document.getElementById('nav-user-name')!;
        this.devBuildBadgeEl = document.getElementById('dev-build-badge');
        this.navLinks = document.querySelectorAll('.nav-link');

        this.dashboardContainer = document.createElement('div');
        this.dashboardContainer.style.height = '100%';
        this.mediaContainer = document.createElement('div');
        this.mediaContainer.style.height = '100%';
        this.profileContainer = document.createElement('div');
        this.profileContainer.style.height = '100%';

        this.viewContainer.appendChild(this.dashboardContainer);
        this.viewContainer.appendChild(this.mediaContainer);
        this.viewContainer.appendChild(this.profileContainer);

        this.dashboard = new Dashboard(this.dashboardContainer);
        this.mediaView = new MediaView(this.mediaContainer);
        this.profileView = new ProfileView(this.profileContainer);
    }

    public static async start(): Promise<App> {
        const app = new App();
        await app.init();
        return app;
    }

    private async init() {
        this.setupWindowControls();
        this.setupNavigation();
        this.setupGlobalActions();
        this.setupEventListeners();

        // Always show dev build label for now as requested
        if (this.devBuildBadgeEl) {
            this.devBuildBadgeEl.style.display = 'inline-flex';
            const appVersion = import.meta.env.VITE_APP_VERSION;
            if (appVersion) {
                this.devBuildBadgeEl.textContent = `Dev Build ${appVersion}`;
            }
        }

        await this.initProfile();
        await this.loadTheme();

        await this.switchView(this.currentView);
    }

    private setupWindowControls() {
        if (!getServices().isDesktop()) return;
        document.getElementById('win-min')?.addEventListener('click', () => getServices().minimizeWindow());
        document.getElementById('win-max')?.addEventListener('click', () => getServices().maximizeWindow());
        document.getElementById('win-close')?.addEventListener('click', () => getServices().closeWindow());
    }

    private setupNavigation() {
        this.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const view = link.dataset.view as ViewType;
                if (view) this.switchView(view);
            });
        });
    }



    private setupGlobalActions() {
        document.getElementById('btn-add-activity')?.addEventListener('click', async () => {
            const success = await showLogActivityModal();
            if (success) {
                if (this.currentView === VIEW_NAMES.DASHBOARD) await this.dashboard.loadData();
                else if (this.currentView === VIEW_NAMES.MEDIA) await this.mediaView.loadData();
                this.renderCurrentView();
            }
        });
    }

    private setupEventListeners() {
        globalThis.addEventListener(EVENTS.APP_NAVIGATE, (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.view) {
                if (detail.view === VIEW_NAMES.MEDIA && detail.focusMediaId !== undefined) {
                    this.switchView(VIEW_NAMES.MEDIA);
                    this.mediaView.jumpToMedia(detail.focusMediaId);
                }
            }
        });

        globalThis.addEventListener(EVENTS.PROFILE_UPDATED, async () => {
            this.loadTheme();
            const newName = await getSetting('profile_name');
            if (newName && newName !== this.currentProfile) {
                this.currentProfile = newName;
                this.navUserNameEl.textContent = this.currentProfile;
            }
        });
    }

    private async initProfile() {
        let profileName: string | null = null;
        try {
            profileName = await getSetting('profile_name');
        } catch (e) {
            Logger.info('[kechimochi] DB uninitialized (no settings table found), proceeding with fallback.', e);
        }
        
        if (!profileName) {
            // Check for previous user profile in localStorage to migrate it
            const oldProfile = localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE);
            if (oldProfile && oldProfile !== 'default') {
                await initializeUserDb(oldProfile);
                await setSetting('profile_name', oldProfile);
                this.currentProfile = oldProfile;
            } else {
                // Initialize default db
                const osUsername = await getUsername();
                const newName = await initialProfilePrompt(osUsername);
                await initializeUserDb(newName);
                await setSetting('profile_name', newName);
                this.currentProfile = newName;
            }
        } else {
            // DB is already initialized, just load it
            await initializeUserDb();
            this.currentProfile = profileName;
        }
        
        localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
        this.navUserNameEl.textContent = this.currentProfile;
    }

    private async loadTheme() {
        const theme = await getSetting(SETTING_KEYS.THEME) || DEFAULTS.THEME;
        document.body.dataset.theme = theme;
        localStorage.setItem(STORAGE_KEYS.THEME_CACHE, theme);
    }

    private async switchView(view: ViewType) {
        this.currentView = view;

        this.navLinks.forEach(n => {
            const dataView = n.dataset.view;
            n.classList.toggle('active', dataView === view);
        });

        // Always reload data when switching views to ensure freshness
        if (view === 'dashboard') await this.dashboard.loadData();
        else if (view === 'media') await this.mediaView.resetView();
        else if (view === 'profile') await this.profileView.loadData();

        this.renderCurrentView();
    }

    private renderCurrentView() {
        this.dashboardContainer.style.display = this.currentView === VIEW_NAMES.DASHBOARD ? 'block' : 'none';
        this.mediaContainer.style.display = this.currentView === VIEW_NAMES.MEDIA ? 'block' : 'none';
        this.profileContainer.style.display = this.currentView === VIEW_NAMES.PROFILE ? 'block' : 'none';

        if (this.currentView === VIEW_NAMES.DASHBOARD) this.dashboard.render();
        else if (this.currentView === VIEW_NAMES.MEDIA) this.mediaView.render();
        else if (this.currentView === VIEW_NAMES.PROFILE) this.profileView.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    (async () => {
        await initServices();
        syncAppShell(getServices().isDesktop());
        await App.start();
    })().catch(e => {
        Logger.error('Failed to start application:', e);
    });
});

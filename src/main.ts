import { Dashboard } from './components/dashboard';
import { MediaView } from './components/media_view';
import { ProfileView } from './components/profile';
import {
    switchProfile, deleteProfile, listProfiles,
    getUsername, getSetting
} from './api';
import {
    customPrompt, customConfirm, customAlert,
    initialProfilePrompt, showLogActivityModal
} from './modals';
import { getCurrentWindow } from '@tauri-apps/api/window';
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

const appWindow = getCurrentWindow();

type ViewType = typeof VIEW_NAMES[keyof typeof VIEW_NAMES];

class App {
    private currentView: ViewType = VIEW_NAMES.DASHBOARD;
    private currentProfile: string = localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE) || DEFAULTS.PROFILE;

    private readonly dashboard: Dashboard;
    private readonly mediaView: MediaView;
    private readonly profileView: ProfileView;

    private readonly viewContainer: HTMLElement;
    private readonly dashboardContainer: HTMLElement;
    private readonly mediaContainer: HTMLElement;
    private readonly profileContainer: HTMLElement;

    private readonly selectProfileEl: HTMLSelectElement;
    private readonly devBuildBadgeEl: HTMLElement | null;
    private readonly navLinks: NodeListOf<HTMLElement>;

    constructor() {
        this.viewContainer = document.getElementById('view-container')!;
        this.selectProfileEl = document.querySelector<HTMLSelectElement>('#select-profile')!;
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
        this.setupProfileControls();
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

        await this.ensureProfilesList();

        if (this.currentProfile) {
            await switchProfile(this.currentProfile);
            await this.loadTheme();
        }

        this.renderCurrentView();
    }

    private setupWindowControls() {
        document.getElementById('win-min')?.addEventListener('click', () => appWindow.minimize());
        document.getElementById('win-max')?.addEventListener('click', () => appWindow.toggleMaximize());
        document.getElementById('win-close')?.addEventListener('click', () => appWindow.close());
    }

    private setupNavigation() {
        this.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const view = link.dataset.view as ViewType;
                if (view) this.switchView(view);
            });
        });
    }

    private setupProfileControls() {
        this.selectProfileEl.addEventListener('change', async () => {
            this.currentProfile = this.selectProfileEl.value;
            localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
            await switchProfile(this.currentProfile);
            await this.loadTheme();
            localStorage.setItem(STORAGE_KEYS.THEME_CACHE, document.body.dataset.theme || DEFAULTS.THEME);
            this.resetViews();
            this.renderCurrentView();
        });

        document.getElementById('btn-add-profile')?.addEventListener('click', async () => {
            const newProfile = await customPrompt("Enter new user profile name:");
            if (newProfile && newProfile.trim() !== '') {
                this.currentProfile = newProfile.trim();
                localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
                await switchProfile(this.currentProfile);
                await this.loadTheme();
                await this.ensureProfilesList();
                this.resetViews();
                this.renderCurrentView();
            }
        });

        document.getElementById('btn-delete-profile')?.addEventListener('click', async () => {
            const profiles = await listProfiles();
            if (profiles.length <= 1) {
                await customAlert("Error", "Cannot delete the current profile because it is the only remaining user.");
                return;
            }
            const yes = await customConfirm("Delete User", `Are you sure you want to permanently delete the user '${this.currentProfile}'?`, "btn-danger", "Delete");
            if (yes) {
                await deleteProfile(this.currentProfile);
                const updatedProfiles = await listProfiles();
                this.currentProfile = updatedProfiles.length > 0 ? updatedProfiles[0] : DEFAULTS.PROFILE;
                localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
                await switchProfile(this.currentProfile);
                await this.loadTheme();
                await this.ensureProfilesList();
                this.resetViews();
                this.renderCurrentView();
            }
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

        globalThis.addEventListener(EVENTS.PROFILE_UPDATED, () => {
            this.loadTheme();
            this.ensureProfilesList();
        });
    }

    private async ensureProfilesList() {
        let profiles = await listProfiles();

        if (profiles.length === 0) {
            const osUsername = await getUsername();
            const initialName = await initialProfilePrompt(osUsername);
            this.currentProfile = initialName;
            localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
            await switchProfile(this.currentProfile);
            profiles = await listProfiles();
        } else if (!profiles.includes(this.currentProfile)) {
            this.currentProfile = profiles[0];
            localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
        }

        this.selectProfileEl.innerHTML = profiles.map((p: string) => `<option value="${p}">${p}</option>`).join('');
        this.selectProfileEl.value = this.currentProfile;
    }

    private resetViews() {
        this.dashboard.setState({ isInitialized: false });
        this.mediaView.setState({ isInitialized: false });
        this.profileView.setState({ isInitialized: false });
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
    App.start().catch(e => {
        Logger.error('Failed to start application:', e);
    });
});

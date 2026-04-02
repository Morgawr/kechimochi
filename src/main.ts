import { Dashboard } from './components/dashboard';
import { MediaView } from './components/media_view';
import { ProfileView } from './components/profile';
import { TimelineView } from './components/timeline';
import {
    initializeUserDb, getUsername, getSetting, setSetting, getProfilePicture, getStartupError
} from './api';
import {
    initialProfilePrompt, showLogActivityModal
} from './modals';
import { syncAppShell } from './app_shell';
import { initServices, getServices } from './services';
import { Logger } from './core/logger';
import { formatBuildBadge } from './app_version';
import { escapeHTML } from './core/html';
import { getProfileInitials, profilePictureToDataUrl } from './utils/profile_picture';
import { STORAGE_KEYS, SETTING_KEYS, VIEW_NAMES, EVENTS, DEFAULTS } from './constants';
import type { ProfilePicture } from './types';
import { UpdateManager } from './updates';

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

function renderStartupErrorScreen(message: string): void {
    const appRoot = document.getElementById('app');
    if (!appRoot) return;
    const escapedMessage = escapeHTML(message);

    appRoot.innerHTML = `
        <main style="min-height: 100vh; display: grid; place-items: center; padding: 2rem; background: linear-gradient(180deg, var(--bg-darkest), var(--bg-dark));">
            <section style="width: min(92vw, 720px); border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--bg-dark) 92%, black); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); padding: 2rem;" role="alertdialog" aria-live="assertive">
                <p style="margin: 0; color: var(--accent-red, #ff7b7b); font-size: 0.82rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Startup blocked</p>
                <h1 style="margin: 0.75rem 0 0; font-size: clamp(1.6rem, 3vw, 2.2rem);">Unsupported database version</h1>
                <p id="alert-body" style="margin: 1rem 0 0; color: var(--text-secondary); line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;">${escapedMessage}</p>
                <p id="startup-error-message" style="display: none;">${escapedMessage}</p>
                <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="alert-ok">OK</button>
                </div>
            </section>
        </main>
    `;

    appRoot.querySelector('#alert-ok')?.addEventListener('click', () => {
        (appRoot.querySelector('#alert-ok') as HTMLButtonElement | null)?.blur();
    });
}

function renderBootstrapFailureScreen(error: unknown): void {
    if (document.getElementById('startup-error-message') || document.getElementById('alert-body')) {
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const isUnsupportedSchemaError = message.includes('newer than this app supports');

    if (isUnsupportedSchemaError) {
        renderStartupErrorScreen(
            `Kechimochi could not open this database safely.\n\n${message}\n\nUse a newer version of the app that supports this database schema.`
        );
        return;
    }

    renderStartupErrorScreen(
        `Kechimochi failed to finish startup.\n\n${message}\n\nCheck the terminal logs for the full error details.`
    );
}

export class App {
    private currentView: ViewType = VIEW_NAMES.DASHBOARD;
    private currentProfile: string = '';

    private readonly dashboard: Dashboard;
    private readonly mediaView: MediaView;
    private readonly timelineView: TimelineView;
    private readonly profileView: ProfileView;
    private readonly updateManager: UpdateManager;

    private readonly viewContainer: HTMLElement;
    private readonly dashboardContainer: HTMLElement;
    private readonly mediaContainer: HTMLElement;
    private readonly timelineContainer: HTMLElement;
    private readonly profileContainer: HTMLElement;

    private readonly navUserNameEl: HTMLElement;
    private readonly navUserAvatarEl: HTMLElement | null;
    private readonly navUserAvatarImgEl: HTMLImageElement | null;
    private readonly navUserAvatarFallbackEl: HTMLElement | null;
    private readonly devBuildBadgeEl: HTMLElement | null;
    private readonly updateBadgeEl: HTMLButtonElement | null;
    private readonly navLinks: NodeListOf<HTMLElement>;

    constructor(updateManager: UpdateManager = new UpdateManager()) {
        this.updateManager = updateManager;
        this.viewContainer = document.getElementById('view-container')!;
        this.navUserNameEl = document.getElementById('nav-user-name')!;
        this.navUserAvatarEl = document.getElementById('nav-user-avatar');
        this.navUserAvatarImgEl = document.getElementById('nav-user-avatar-image') as HTMLImageElement | null;
        this.navUserAvatarFallbackEl = document.getElementById('nav-user-avatar-fallback');
        this.devBuildBadgeEl = document.getElementById('dev-build-badge');
        this.updateBadgeEl = document.getElementById('update-available-badge') as HTMLButtonElement | null;
        this.navLinks = document.querySelectorAll('.nav-link');

        this.dashboardContainer = document.createElement('div');
        this.dashboardContainer.style.height = '100%';
        this.mediaContainer = document.createElement('div');
        this.mediaContainer.style.height = '100%';
        this.timelineContainer = document.createElement('div');
        this.timelineContainer.style.height = '100%';
        this.profileContainer = document.createElement('div');
        this.profileContainer.style.height = '100%';

        this.viewContainer.appendChild(this.dashboardContainer);
        this.viewContainer.appendChild(this.mediaContainer);
        this.viewContainer.appendChild(this.timelineContainer);
        this.viewContainer.appendChild(this.profileContainer);

        this.dashboard = new Dashboard(this.dashboardContainer);
        this.mediaView = new MediaView(this.mediaContainer);
        this.timelineView = new TimelineView(this.timelineContainer);
        this.profileView = new ProfileView(this.profileContainer, this.updateManager);

        this.updateManager.subscribe(state => {
            if (!this.updateBadgeEl) return;
            const isVisible = state.isSupported && state.availableRelease !== null;
            this.updateBadgeEl.style.display = isVisible ? 'inline-flex' : 'none';
            this.updateBadgeEl.disabled = state.availableRelease === null;
            this.updateBadgeEl.textContent = state.availableRelease
                ? `New update available: ${state.availableRelease.version}`
                : 'New update available';
        });
    }

    public static async start(updateManager?: UpdateManager): Promise<App | null> {
        let startupError: string | null = null;
        try {
            startupError = await getStartupError();
        } catch (error) {
            Logger.warn('[kechimochi] Failed to read startup error state, continuing normal startup.', error);
        }
        if (startupError) {
            renderStartupErrorScreen(startupError);
            return null;
        }

        const app = new App(updateManager);
        await app.init();
        return app;
    }

    private async init() {
        this.setupWindowControls();
        this.setupNavigation();
        this.setupGlobalActions();
        this.setupEventListeners();

        if (this.devBuildBadgeEl) {
            this.devBuildBadgeEl.style.display = 'inline-flex';
            this.devBuildBadgeEl.textContent = formatBuildBadge();
        }

        const isFreshInstall = await this.initProfile();
        await this.loadTheme();

        await this.switchView(this.currentView);

        try {
            await this.updateManager.initialize({ isFreshInstall });
        } catch (e) {
            Logger.warn('[kechimochi] Failed to initialize update manager:', e);
        }
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

        this.updateBadgeEl?.addEventListener('click', async () => {
            await this.updateManager.openAvailableUpdateModal();
        });
    }



    private setupGlobalActions() {
        document.getElementById('btn-add-activity')?.addEventListener('click', async () => {
            const success = await showLogActivityModal();
            if (success) {
                if (this.currentView === VIEW_NAMES.DASHBOARD) await this.dashboard.loadData();
                else if (this.currentView === VIEW_NAMES.MEDIA) await this.mediaView.loadData();
                else if (this.currentView === VIEW_NAMES.TIMELINE) await this.timelineView.loadData();
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
            await this.loadTheme();
            await this.refreshProfileChrome();
        });
    }

    private async initProfile(): Promise<boolean> {
        let profileName: string | null = null;
        try {
            profileName = await getSetting(SETTING_KEYS.PROFILE_NAME);
        } catch (e) {
            Logger.info('[kechimochi] DB uninitialized (no settings table found), proceeding with fallback.', e);
        }
        
        if (profileName) {
            // DB is already initialized, just load it
            await initializeUserDb();
            this.currentProfile = profileName;
            localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
            await this.refreshProfileChrome();
            return false;
        } else {
            // Check for previous user profile in localStorage to migrate it
            const oldProfile = localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE);
            if (oldProfile && oldProfile !== 'default') {
                await initializeUserDb(oldProfile);
                await setSetting(SETTING_KEYS.PROFILE_NAME, oldProfile);
                this.currentProfile = oldProfile;
            } else {
                // Initialize default db
                const osUsername = await getUsername();
                const newName = await initialProfilePrompt(osUsername);
                await initializeUserDb(newName);
                await setSetting(SETTING_KEYS.PROFILE_NAME, newName);
                this.currentProfile = newName;
            }
        }

        localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
        await this.refreshProfileChrome();
        return true;
    }

    private async loadTheme() {
        const theme = await getSetting(SETTING_KEYS.THEME) || DEFAULTS.THEME;
        document.body.dataset.theme = theme;
        localStorage.setItem(STORAGE_KEYS.THEME_CACHE, theme);
    }

    private async refreshProfileChrome() {
        const newName = await getSetting(SETTING_KEYS.PROFILE_NAME) || this.currentProfile || DEFAULTS.PROFILE;
        this.currentProfile = newName;
        this.navUserNameEl.textContent = this.currentProfile;

        const initials = getProfileInitials(this.currentProfile);
        if (this.navUserAvatarFallbackEl) {
            this.navUserAvatarFallbackEl.textContent = initials;
        }

        const profilePicture = await this.loadProfilePicture();
        const profilePictureSrc = profilePictureToDataUrl(profilePicture);
        if (this.navUserAvatarImgEl) {
            if (profilePictureSrc) {
                this.navUserAvatarImgEl.src = profilePictureSrc;
                this.navUserAvatarImgEl.style.display = 'block';
                if (this.navUserAvatarFallbackEl) this.navUserAvatarFallbackEl.style.display = 'none';
            } else {
                this.navUserAvatarImgEl.removeAttribute('src');
                this.navUserAvatarImgEl.style.display = 'none';
                if (this.navUserAvatarFallbackEl) this.navUserAvatarFallbackEl.style.display = 'flex';
            }
        }
        this.navUserAvatarEl?.setAttribute('aria-label', `${this.currentProfile} profile picture`);
    }

    private async loadProfilePicture(): Promise<ProfilePicture | null> {
        try {
            return await getProfilePicture();
        } catch (e) {
            Logger.warn('[kechimochi] Failed to load profile picture, falling back to initials.', e);
            return null;
        }
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
        else if (view === 'timeline') await this.timelineView.loadData();
        else if (view === 'profile') await this.profileView.loadData();

        this.renderCurrentView();
    }

    private renderCurrentView() {
        this.dashboardContainer.style.display = this.currentView === VIEW_NAMES.DASHBOARD ? 'block' : 'none';
        this.mediaContainer.style.display = this.currentView === VIEW_NAMES.MEDIA ? 'block' : 'none';
        this.timelineContainer.style.display = this.currentView === VIEW_NAMES.TIMELINE ? 'block' : 'none';
        this.profileContainer.style.display = this.currentView === VIEW_NAMES.PROFILE ? 'block' : 'none';

        if (this.currentView === VIEW_NAMES.DASHBOARD) this.dashboard.render();
        else if (this.currentView === VIEW_NAMES.MEDIA) this.mediaView.render();
        else if (this.currentView === VIEW_NAMES.TIMELINE) this.timelineView.render();
        else if (this.currentView === VIEW_NAMES.PROFILE) this.profileView.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    (async () => {
        await initServices();
        syncAppShell(getServices().isDesktop());
        await App.start();
    })().catch(e => {
        renderBootstrapFailureScreen(e);
        Logger.error('Failed to start application:', e);
    });
});

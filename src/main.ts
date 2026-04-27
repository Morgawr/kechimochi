import { Dashboard } from './components/dashboard';
import { MediaView } from './components/media_view';
import { ProfileView } from './components/profile';
import { TimelineView } from './components/timeline';
import {
    initializeUserDb,
    getUsername,
    getSetting,
    setSetting,
    getProfilePicture,
    getStartupError,
    getSyncStatus,
    shouldSkipLegacyLocalProfileMigration,
} from './api';
import {
    showInitialSetupPrompt,
    showLogActivityModal,
    customAlert,
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
import {
    attachSelectedRemoteProfile,
    resolveSyncEnablementSelection,
    runBlockingStatus,
    runSyncProgressBlockingStatus,
    showNoCloudProfilesFoundAlert,
    stringifySyncEnablementError,
} from './sync_enablement';
import {applyTheme, resolveEffectiveTheme} from "./theme.ts";

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
const APP_BOOT_STATES = {
    LOADING: 'loading',
    READY: 'ready',
} as const;
type AppBootState = typeof APP_BOOT_STATES[keyof typeof APP_BOOT_STATES];

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

function ensureStartupLoader(appRoot: HTMLElement): void {
    if (appRoot.querySelector('#app-startup-loader')) {
        return;
    }

    const loader = document.createElement('output');
    loader.id = 'app-startup-loader';
    loader.className = 'app-startup-loader';
    loader.setAttribute('aria-label', 'Loading');
    loader.innerHTML = '<span class="app-startup-loader__spinner" aria-hidden="true"></span>';

    appRoot.appendChild(loader);
}

export class App {
    private currentView: ViewType = VIEW_NAMES.DASHBOARD;
    private currentProfile: string = '';

    private readonly dashboard: Dashboard;
    private readonly mediaView: MediaView;
    private readonly timelineView: TimelineView;
    private readonly profileView: ProfileView;
    private readonly updateManager: UpdateManager;
    private readonly appRoot: HTMLElement;

    private readonly viewContainer: HTMLElement;
    private readonly dashboardContainer: HTMLElement;
    private readonly mediaContainer: HTMLElement;
    private readonly timelineContainer: HTMLElement;
    private readonly profileContainer: HTMLElement;

    private readonly navUserNameEl: HTMLElement;
    private readonly navUserAvatarEl: HTMLElement | null;
    private readonly navUserAvatarImgEl: HTMLImageElement | null;
    private readonly navUserAvatarFallbackEl: HTMLElement | null;
    private readonly navProfileTabAvatarEl: HTMLElement | null;
    private readonly navProfileTabAvatarImgEl: HTMLImageElement | null;
    private readonly navProfileTabAvatarFallbackEl: HTMLElement | null;
    private readonly devBuildBadgeEl: HTMLElement | null;
    private readonly mobileBuildBadgeEl: HTMLElement | null;
    private readonly updateBadgeEl: HTMLButtonElement | null;
    private readonly navSyncButtonEl: HTMLButtonElement | null;
    private readonly navSyncDotEl: HTMLElement | null;
    private readonly mobileSyncButtonEl: HTMLButtonElement | null;
    private readonly mobileSyncDotEl: HTMLElement | null;
    private readonly navLinks: NodeListOf<HTMLElement>;

    constructor(updateManager: UpdateManager = new UpdateManager()) {
        this.appRoot = document.getElementById('app')!;
        ensureStartupLoader(this.appRoot);
        this.setBootState(APP_BOOT_STATES.LOADING);
        this.updateManager = updateManager;
        this.viewContainer = document.getElementById('view-container')!;
        this.navUserNameEl = document.getElementById('nav-user-name')!;
        this.navUserAvatarEl = document.getElementById('nav-user-avatar');
        this.navUserAvatarImgEl = document.getElementById('nav-user-avatar-image') as HTMLImageElement | null;
        this.navUserAvatarFallbackEl = document.getElementById('nav-user-avatar-fallback');
        this.navProfileTabAvatarEl = document.getElementById('nav-profile-tab-avatar');
        this.navProfileTabAvatarImgEl = document.getElementById('nav-profile-tab-avatar-image') as HTMLImageElement | null;
        this.navProfileTabAvatarFallbackEl = document.getElementById('nav-profile-tab-avatar-fallback');
        this.devBuildBadgeEl = document.getElementById('dev-build-badge');
        this.mobileBuildBadgeEl = document.getElementById('mobile-build-badge');
        this.updateBadgeEl = document.getElementById('update-available-badge') as HTMLButtonElement | null;
        this.navSyncButtonEl = document.getElementById('nav-sync-status-btn') as HTMLButtonElement | null;
        this.navSyncDotEl = document.getElementById('nav-sync-status-dot');
        this.mobileSyncButtonEl = document.getElementById('mobile-sync-status-btn') as HTMLButtonElement | null;
        this.mobileSyncDotEl = document.getElementById('mobile-sync-status-dot');
        this.navLinks = document.querySelectorAll('.nav-link');

        this.dashboardContainer = document.createElement('div');
        this.dashboardContainer.style.height = '100%';
        this.dashboardContainer.style.display = 'none';
        this.mediaContainer = document.createElement('div');
        this.mediaContainer.style.height = '100%';
        this.mediaContainer.style.display = 'none';
        this.timelineContainer = document.createElement('div');
        this.timelineContainer.style.height = '100%';
        this.timelineContainer.style.display = 'none';
        this.profileContainer = document.createElement('div');
        this.profileContainer.style.height = '100%';
        this.profileContainer.style.display = 'none';

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
        if (this.mobileBuildBadgeEl) {
            this.mobileBuildBadgeEl.textContent = formatBuildBadge();
        }

        const isFreshInstall = await this.initProfile();
        await this.loadTheme();
        await this.refreshSyncChrome();

        await this.switchView(this.currentView);
        this.setBootState(APP_BOOT_STATES.READY);

        try {
            await this.updateManager.initialize({ isFreshInstall });
        } catch (e) {
            Logger.warn('[kechimochi] Failed to initialize update manager:', e);
        }
    }

    private setBootState(state: AppBootState) {
        this.appRoot.dataset.bootState = state;
    }

    private setupWindowControls() {
        if (!getServices().supportsWindowControls()) return;
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
                await this.refreshSyncChrome();
            }
        });

        this.navSyncButtonEl?.addEventListener('click', async () => {
            await this.handleSyncAction();
        });
        this.mobileSyncButtonEl?.addEventListener('click', async () => {
            await this.handleSyncAction();
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
            await this.refreshSyncChrome();
        });

        globalThis.addEventListener(EVENTS.LOCAL_DATA_CHANGED, async () => {
            await this.refreshSyncChrome();
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
            const shouldSkipLegacyProfileMigration = await shouldSkipLegacyLocalProfileMigration();
            const oldProfile = shouldSkipLegacyProfileMigration
                ? null
                : localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE);
            if (oldProfile && oldProfile !== 'default') {
                await initializeUserDb(oldProfile);
                await setSetting(SETTING_KEYS.PROFILE_NAME, oldProfile);
                this.currentProfile = oldProfile;
            } else {
                const osUsername = await getUsername();
                await this.handleInitialSetup(osUsername);
            }
        }

        localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, this.currentProfile);
        await this.refreshProfileChrome();
        return true;
    }

    private async handleInitialSetup(defaultProfileName: string): Promise<void> {
        if (!getServices().isDesktop()) {
            await this.createLocalProfile(defaultProfileName);
            return;
        }

        while (true) {
            const choice = await showInitialSetupPrompt(defaultProfileName, { allowCloudSync: true });
            if (choice.action === 'create_local') {
                await this.createLocalProfile(choice.profileName);
                return;
            }

            const didAttachRemote = await this.attachRemoteProfileDuringSetup();
            if (didAttachRemote) {
                return;
            }
        }
    }

    private async createLocalProfile(profileName: string): Promise<void> {
        await initializeUserDb(profileName);
        await setSetting(SETTING_KEYS.PROFILE_NAME, profileName);
        this.currentProfile = profileName;
    }

    private async attachRemoteProfileDuringSetup(): Promise<boolean> {
        await initializeUserDb();

        try {
            const selection = await resolveSyncEnablementSelection({
                googleAuthenticated: false,
                withBlockingStatus: runBlockingStatus,
                wizardOptions: { allowCreateNew: false, title: 'Import From Google Drive' },
                onNoProfiles: showNoCloudProfilesFoundAlert,
                connectPromptText: 'Opening the Google sign-in flow for Google Drive...',
            });
            if (selection?.action !== 'attach') {
                return false;
            }

            await attachSelectedRemoteProfile(
                runSyncProgressBlockingStatus,
                selection.profileId,
                'Importing Cloud Profile',
                'Downloading remote data, applying changes on this device, and publishing the merged result...',
            );

            this.currentProfile = await getSetting(SETTING_KEYS.PROFILE_NAME) || DEFAULTS.PROFILE;
            return true;
        } catch (error) {
            await customAlert('Cloud Sync Error', `Failed to import from Google Drive: ${stringifySyncEnablementError(error)}`);
            return false;
        }
    }

    private async loadTheme() {
        const syncedTheme = await getSetting(SETTING_KEYS.THEME) || DEFAULTS.THEME;
        applyTheme(resolveEffectiveTheme(syncedTheme));
    }

    private async refreshProfileChrome() {
        const newName = await getSetting(SETTING_KEYS.PROFILE_NAME) || this.currentProfile || DEFAULTS.PROFILE;
        this.currentProfile = newName;
        this.navUserNameEl.textContent = this.currentProfile;

        const initials = getProfileInitials(this.currentProfile);
        const fallbacks = [this.navUserAvatarFallbackEl, this.navProfileTabAvatarFallbackEl];
        for (const fallback of fallbacks) {
            if (fallback) fallback.textContent = initials;
        }

        const profilePicture = await this.loadProfilePicture();
        const profilePictureSrc = profilePictureToDataUrl(profilePicture);

        const updateAvatar = (img: HTMLImageElement | null, fallback: HTMLElement | null, el: HTMLElement | null) => {
            if (img) {
                img.src = profilePictureSrc || '';
                img.style.display = profilePictureSrc ? 'block' : 'none';
                if (fallback) fallback.style.display = profilePictureSrc ? 'none' : 'flex';
            }
            el?.setAttribute('aria-label', `${this.currentProfile} profile picture`);
        };

        updateAvatar(this.navUserAvatarImgEl, this.navUserAvatarFallbackEl, this.navUserAvatarEl);
        updateAvatar(this.navProfileTabAvatarImgEl, this.navProfileTabAvatarFallbackEl, this.navProfileTabAvatarEl);
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
        await this.refreshSyncChrome();
    }

    private async refreshSyncChrome() {
        const buttons = [
            { button: this.navSyncButtonEl, dot: this.navSyncDotEl },
            { button: this.mobileSyncButtonEl, dot: this.mobileSyncDotEl },
        ].filter(entry => entry.button && entry.dot) as Array<{ button: HTMLButtonElement; dot: HTMLElement }>;

        if (buttons.length === 0) {
            return;
        }

        if (!getServices().isDesktop()) {
            buttons.forEach(({ button }) => {
                button.dataset.visible = 'false';
            });
            return;
        }

        try {
            const syncStatus = await getSyncStatus();

            let attentionState: string;
            if (syncStatus.conflict_count > 0 || syncStatus.state === 'conflict_pending') {
                attentionState = 'conflict';
            } else if (syncStatus.state === 'dirty') {
                attentionState = 'dirty';
            } else if (syncStatus.state === 'syncing') {
                attentionState = 'syncing';
            } else if (syncStatus.state === 'error' || (syncStatus.sync_profile_id && !syncStatus.google_authenticated)) {
                attentionState = 'error';
            } else {
                attentionState = 'idle';
            }

            let title: string;
            if (attentionState === 'conflict') {
                title = `Resolve ${syncStatus.conflict_count} sync conflict${syncStatus.conflict_count === 1 ? '' : 's'}`;
            } else if (attentionState === 'dirty') {
                title = 'Sync pending changes';
            } else if (attentionState === 'idle') {
                title = 'Cloud sync';
            } else {
                title = 'Cloud sync status';
            }

            buttons.forEach(({ button }) => {
                button.dataset.visible = 'true';
                button.dataset.syncState = attentionState;
                button.disabled = syncStatus.state === 'syncing';
                button.title = title;
            });
        } catch {
            buttons.forEach(({ button }) => {
                button.dataset.visible = 'true';
                button.dataset.syncState = 'error';
                button.disabled = false;
                button.title = 'Open cloud sync settings';
            });
        }
    }

    private async handleSyncAction() {
        if (!getServices().isDesktop()) {
            return;
        }

        try {
            const syncStatus = await getSyncStatus();
            const canRunSync = syncStatus.sync_profile_id && syncStatus.google_authenticated && syncStatus.state !== 'syncing';

          
            if (canRunSync) {
                await this.profileView.runSyncNowFromShell();
                if (this.currentView === VIEW_NAMES.DASHBOARD) await this.dashboard.loadData();
                else if (this.currentView === VIEW_NAMES.MEDIA) await this.mediaView.loadData();
                else if (this.currentView === VIEW_NAMES.TIMELINE) await this.timelineView.loadData();
                else if (this.currentView === VIEW_NAMES.PROFILE) await this.profileView.loadData();

                this.renderCurrentView();
                await this.refreshSyncChrome();
                return;
            }

            await this.switchView(VIEW_NAMES.PROFILE);
            return;
        } catch {
            await this.refreshSyncChrome();
            return;
        }
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
        syncAppShell(getServices().isDesktop(), getServices().supportsWindowControls());
        await App.start();
    })().catch(e => {
        renderBootstrapFailureScreen(e);
        Logger.error('Failed to start application:', e);
    });
});

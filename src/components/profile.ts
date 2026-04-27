import { Logger } from '../core/logger';
import { Component } from '../core/component';
import { html, rawHtml, escapeHTML } from '../core/html';
import {
    getAllMedia,
    getLogsForMedia,
    clearActivities,
    wipeEverything,
    applyMediaImport,
    getSetting,
    setSetting,
    getAppVersion,
    importMilestonesCsv,
    exportMilestonesCsv,
    exportFullBackup,
    importFullBackup,
    getProfilePicture,
    uploadProfilePicture,
    getSyncStatus,
    disconnectGoogleDrive,
    createRemoteSyncProfile,
    runSync,
    replaceLocalFromRemote,
    forcePublishLocalAsRemote,
    getSyncConflicts,
    resolveSyncConflict,
    clearSyncBackups,
    isDesktop,
} from '../api';
import {
    customPrompt,
    showExportCsvModal,
    customAlert,
    customConfirm,
    showMediaCsvConflictModal,
    showBlockingStatus,
} from '../modals';
import { getServices } from '../services';
import { formatProductVersionLabel, getAppVersionInfo } from '../app_version';
import type {
    MergeSide,
    ProfilePicture,
    SyncActionResult,
    SyncAttachPreview,
    SyncConflict,
    SyncConflictProfilePicture,
    SyncConflictResolution,
    SyncConnectionState,
    SyncProgressUpdate,
    SyncStatus,
    UpdateState,
} from '../types';
import { getProfileInitials, profilePictureToDataUrl } from '../utils/profile_picture';
import { getCharacterCountFromExtraData } from '../utils/extra_data';
import { STORAGE_KEYS, SETTING_KEYS, DEFAULTS, EVENTS } from '../constants';
import type { UpdateManager } from '../updates';
import {
    attachSelectedRemoteProfile,
    connectGoogleDriveForSync,
    ENABLE_SYNC_AUTH_TIMEOUT_ERROR,
    resolveSyncEnablementSelection,
    runBlockingStatus,
    runSyncProgressBlockingStatus,
} from '../sync_enablement';
import {
    isThemeOverrideEnabled,
    getThemeOverrideValue,
    setThemeOverrideEnabled,
    setThemeOverrideValue,
    applyTheme,
} from "../theme.ts";

const THEME_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'pastel-pink', label: 'Pastel Pink (Default)' },
    { value: 'light', label: 'Light Theme' },
    { value: 'dark', label: 'Dark Theme' },
    { value: 'light-greyscale', label: 'Light Greyscale' },
    { value: 'dark-greyscale', label: 'Dark Greyscale' },
    { value: 'molokai', label: 'Molokai' },
    { value: 'green-olive', label: 'Green Olive' },
    { value: 'deep-blue', label: 'Deep Blue' },
    { value: 'purple', label: 'Purple' },
    { value: 'fire-red', label: 'Fire Red' },
    { value: 'yellow-lime', label: 'Yellow Lime' },
    { value: 'noctua-brown', label: 'Noctua Brown' },
];

interface ProfileState {
    currentProfile: string;
    theme: string;
    profilePicture: ProfilePicture | null;
    report: {
        novelSpeed: string;
        novelCount: string;
        mangaSpeed: string;
        mangaCount: string;
        vnSpeed: string;
        vnCount: string;
        timestamp: string;
    };
    appVersion: string;
    isInitialized: boolean;
    updateState: UpdateState;
    syncSupported: boolean;
    syncStatus: SyncStatus | null;
    syncConflicts: SyncConflict[];
    syncError: string | null;
    showSyncConflicts: boolean;
    showSyncRecoveryTools: boolean;
    themeOverrideEnabled: boolean;
    themeOverrideValue: string;
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function formatSyncTimestamp(value: string | null): string {
    if (!value) return 'Never';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleString();
}

function formatSyncStateLabel(state: SyncConnectionState): string {
    switch (state) {
        case 'connected_clean':
            return 'Connected';
        case 'dirty':
            return 'Unsynced Changes';
        case 'syncing':
            return 'Syncing';
        case 'conflict_pending':
            return 'Conflicts Pending';
        case 'error':
            return 'Error';
        case 'disconnected':
        default:
            return 'Disconnected';
    }
}

function formatSyncStatusLabel(syncStatus: SyncStatus): string {
    if (syncStatus.sync_profile_id && !syncStatus.google_authenticated) {
        return 'Reconnect Needed';
    }
    return formatSyncStateLabel(syncStatus.state);
}

function syncStateColor(state: SyncConnectionState): string {
    switch (state) {
        case 'connected_clean':
            return '#2ed573';
        case 'dirty':
            return '#f59e0b';
        case 'syncing':
            return 'var(--accent-blue)';
        case 'conflict_pending':
            return '#ff7f50';
        case 'error':
            return '#ff4757';
        case 'disconnected':
        default:
            return 'var(--text-secondary)';
    }
}

function syncStatusColor(syncStatus: SyncStatus): string {
    if (syncStatus.sync_profile_id && !syncStatus.google_authenticated) {
        return '#ff4757';
    }
    return syncStateColor(syncStatus.state);
}

function formatFieldLabel(fieldName: string): string {
    return fieldName
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function formatConflictValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'None';
    }
    if (typeof value === 'string') {
        return value === '' ? '(empty)' : value;
    }
    return JSON.stringify(value, null, 2);
}

function isGenericDeviceName(value: string | null | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    return !normalized || normalized === 'device';
}

function profilePictureLabel(picture: SyncConflictProfilePicture | null): string {
    if (!picture) {
        return 'No picture';
    }
    return `${picture.width}x${picture.height} ${picture.mime_type}`;
}

function syncCardBorderColor(state: SyncConnectionState): string {
    if (state === 'error') {
        return 'rgba(255, 71, 87, 0.25)';
    }
    if (state === 'conflict_pending') {
        return 'rgba(255, 127, 80, 0.25)';
    }
    return 'var(--border-color)';
}

function isMissingGoogleOAuthConfigError(message: string): boolean {
    return message.includes('KECHIMOCHI_GOOGLE_CLIENT_ID')
        || message.includes('KECHIMOCHI_GOOGLE_ANDROID_CLIENT_ID')
        || message.includes('Google Drive sync is not configured');
}

function isMissingGoogleOAuthClientSecretError(message: string): boolean {
    return message.includes('client_secret is missing');
}

function isSyncTimeoutError(message: string): boolean {
    return message.toLowerCase().includes('timed out');
}

function isSyncAlreadyInProgressError(message: string): boolean {
    return message.includes('Another sync operation is already in progress');
}

function isGoogleDriveNotAuthenticatedError(message: string): boolean {
    return message.includes('Google Drive is not authenticated');
}

function formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = Math.max(0, decimals);
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export class ProfileView extends Component<ProfileState> {
    private isRefreshing = false;
    private removeUpdateListener: (() => void) | null = null;

    constructor(container: HTMLElement, private readonly updateManager?: UpdateManager) {
        super(container, {
            currentProfile: localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE) || DEFAULTS.PROFILE,
            theme: localStorage.getItem(STORAGE_KEYS.THEME_CACHE) || DEFAULTS.THEME,
            profilePicture: null,
            report: {
                novelSpeed: '0',
                novelCount: '0',
                mangaSpeed: '0',
                mangaCount: '0',
                vnSpeed: '0',
                vnCount: '0',
                timestamp: ''
            },
            appVersion: '',
            isInitialized: false,
            updateState: updateManager?.getState() ?? {
                checking: false,
                autoCheckEnabled: true,
                availableRelease: null,
                installedVersion: getAppVersionInfo().version,
                isSupported: false,
            },
            syncSupported: getServices().isDesktop(),
            syncStatus: null,
            syncConflicts: [],
            syncError: null,
            showSyncConflicts: false,
            showSyncRecoveryTools: false,
            themeOverrideEnabled: isThemeOverrideEnabled(),
            themeOverrideValue: getThemeOverrideValue(),
        });
    }

    protected onMount(): void {
        if (!this.updateManager) return;
        this.removeUpdateListener = this.updateManager.subscribe(updateState => {
            this.setState({ updateState });
        });
    }

    public destroy(): void {
        this.removeUpdateListener?.();
    }

    async loadData() {
        const syncSupported = getServices().isDesktop();
        const syncStatePromise = this.loadSyncState(syncSupported);

        const [
            theme,
            novelSpeed,
            novelCount,
            mangaSpeed,
            mangaCount,
            vnSpeed,
            vnCount,
            timestamp,
            appVersion,
            profilePicture,
            currentProfile,
            syncState,
        ] = await Promise.all([
            getSetting(SETTING_KEYS.THEME),
            getSetting(SETTING_KEYS.STATS_NOVEL_SPEED),
            getSetting(SETTING_KEYS.STATS_NOVEL_COUNT),
            getSetting(SETTING_KEYS.STATS_MANGA_SPEED),
            getSetting(SETTING_KEYS.STATS_MANGA_COUNT),
            getSetting(SETTING_KEYS.STATS_VN_SPEED),
            getSetting(SETTING_KEYS.STATS_VN_COUNT),
            getSetting(SETTING_KEYS.STATS_REPORT_TIMESTAMP),
            getAppVersion(),
            this.loadProfilePicture(),
            getSetting(SETTING_KEYS.PROFILE_NAME),
            syncStatePromise,
        ]);

        const resolvedTheme = theme || DEFAULTS.THEME;
        const resolvedProfileName = currentProfile || DEFAULTS.PROFILE;

        localStorage.setItem(STORAGE_KEYS.THEME_CACHE, resolvedTheme);
        this.setState({
            currentProfile: resolvedProfileName,
            theme: resolvedTheme,
            profilePicture,
            report: {
                novelSpeed: novelSpeed || '0',
                novelCount: novelCount || '0',
                mangaSpeed: mangaSpeed || '0',
                mangaCount: mangaCount || '0',
                vnSpeed: vnSpeed || '0',
                vnCount: vnCount || '0',
                timestamp: timestamp || '',
            },
            appVersion,
            isInitialized: true,
            syncSupported,
            syncStatus: syncState.syncStatus,
            syncConflicts: syncState.syncConflicts,
            syncError: syncState.syncError,
            showSyncConflicts: syncState.syncConflicts.length > 0 && this.state.showSyncConflicts,
        });
    }

    private async loadProfilePicture(): Promise<ProfilePicture | null> {
        try {
            return await getProfilePicture();
        } catch (e) {
            Logger.warn('Failed to load profile picture, falling back to initials.', e);
            return null;
        }
    }

    private async loadSyncState(syncSupported: boolean): Promise<{
        syncStatus: SyncStatus | null;
        syncConflicts: SyncConflict[];
        syncError: string | null;
    }> {
        if (!syncSupported) {
            return {
                syncStatus: null,
                syncConflicts: [],
                syncError: null,
            };
        }

        try {
            const syncStatus = await getSyncStatus();
            let syncConflicts: SyncConflict[] = [];
            let syncError: string | null = null;

            if (syncStatus.conflict_count > 0) {
                try {
                    syncConflicts = await getSyncConflicts();
                } catch (error) {
                    syncError = `Failed to load pending conflicts: ${stringifyError(error)}`;
                }
            }

            return {
                syncStatus,
                syncConflicts,
                syncError,
            };
        } catch (error) {
            return {
                syncStatus: null,
                syncConflicts: [],
                syncError: stringifyError(error),
            };
        }
    }

    render() {
        const needsLoad = !this.state.isInitialized;
        if (!this.isRefreshing && needsLoad) {
            this.isRefreshing = true;
            this.loadData()
                .catch(e => Logger.error('Failed to load profile data', e))
                .finally(() => { this.isRefreshing = false; });
            return;
        }

        this.clear();
        const { currentProfile, theme, profilePicture, appVersion, themeOverrideEnabled, themeOverrideValue } = this.state;
        const profilePictureSrc = profilePictureToDataUrl(profilePicture);
        const initials = getProfileInitials(currentProfile);

        const content = html`
            <div id="profile-root" class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem; max-width: 600px; margin: 0 auto; padding-top: 1rem; padding-bottom: 2rem;">
                <div style="text-align: center; margin-bottom: 2rem;">
                    ${this.renderAvatar(
                        profilePictureSrc,
                        currentProfile,
                        initials,
                        'profile-avatar-hero profile-avatar-clickable',
                        'profile-hero-avatar',
                        'profile picture',
                        'Double click to change picture'
                    )}
                    <h2 id="profile-name" title="Double click to rename" style="margin: 0; font-size: 2rem; color: var(--text-primary); cursor: pointer; transition: opacity 0.2s;">${currentProfile}</h2>
                    <p style="color: var(--text-secondary); margin-top: 0.5rem;">Manage your profile and data</p>
                </div>

                <div class="card" id="profile-report-card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0;">Reading Report Card</h3>
                        <button class="btn btn-primary" id="profile-btn-calculate-report" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">Calculate Report</button>
                    </div>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Aggregated reading speed for the last 12 months based on complete entries.</p>

                    <div id="profile-report-card-content" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.95rem;">
                        ${this.renderReportContent()}
                    </div>
                    ${this.renderReportTimestamp()}
                </div>

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Appearance</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Choose your preferred theme for this profile. Double click the profile picture above to change it.</p>

                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label for="profile-select-theme" style="font-size: 0.85rem; font-weight: 500;">Theme</label>
                        <select id="profile-select-theme" style="width: 100%;">
                            ${this.renderThemeOptions(theme)}
                        </select>
                    </div>

                    <div style="display: flex; align-items: center; gap: 0.6rem; margin-top: 0.5rem;">
                        <input id="profile-checkbox-theme-override" type="checkbox" ${themeOverrideEnabled ? 'checked' : ''} />
                        <label for="profile-checkbox-theme-override" style="cursor: pointer;">
                            Override remote theme on this device
                        </label>
                    </div>
                    <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;">
                        When enabled, this device uses a local theme that won't be synced or overwritten by other devices.
                    </p>

                    ${themeOverrideEnabled ? html`
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            <label for="profile-select-theme-local" style="font-size: 0.85rem; font-weight: 500;">Local theme</label>
                                <select id="profile-select-theme-local" style="width: 100%;">
                                    ${this.renderThemeOptions(themeOverrideValue)}
                                </select>
                        </div>
                    ` : ''}
                </div>

                ${this.renderUpdatesCard()}
                ${this.renderSyncCard()}

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Activity Logs</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export chronological activity logs for the current user in CSV format.</p>

                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-csv" style="flex: 1;">Import Activities (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-csv" style="flex: 1;">Export Activities (CSV)</button>
                    </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Media Library</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export the global media library. This dataset is shared across all profiles and includes embedded cover images.</p>

                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-media" style="flex: 1;">Import Media Library (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-media" style="flex: 1;">Export Media Library (CSV)</button>
                    </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Milestones</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export user-specific milestones for the current profile.</p>

                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-milestones" style="flex: 1;">Import Milestones (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-milestones" style="flex: 1;">Export Milestones (CSV)</button>
                    </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Full Backup</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export a full backup of your entire application state, including databases and local settings.</p>

                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-full-backup" style="flex: 1;">Import Full Backup</button>
                        <button class="btn btn-primary" id="profile-btn-export-full-backup" style="flex: 1;">Export Full Backup</button>
                    </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid #ff4757;">
                    <h3 style="color: #ff4757;">Danger Zone</h3>

                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);">
                            <div>
                                <strong style="color: #ff4757;">Clear User Activities</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Removes all recorded activity logs, but keeps the profile and media library intact.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-clear-activities" style="background-color: transparent !important; border: 1px solid #ff4757; color: #ff4757 !important; min-width: 140px;">Clear Activities</button>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
                            <div>
                                <strong style="color: #ff4757;">Delete Everything</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Perform a total factory reset. Deletes ALL profiles, ALL activity logs, and the ENTIRE media library along with its cover images. Irreversible.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-wipe-everything" style="background-color: darkred !important; color: #ffffff !important; border: none; min-width: 140px; font-weight: bold;">Factory Reset</button>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 1rem; font-size: 0.8rem; color: var(--text-secondary); opacity: 0.7;">
                    <div>${formatProductVersionLabel({ ...getAppVersionInfo(), version: appVersion })}</div>
                    <div style="margin-top: 0.4rem;">
                        Found a bug? File an issue on <a href="https://github.com/Morgawr/kechimochi/issues" target="_blank" style="color: var(--text-secondary); text-decoration: underline;">github</a>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(content);
        this.setupListeners(content);
    }

    private renderAvatar(
        profilePictureSrc: string | null,
        currentProfile: string,
        initials: string,
        variantClassName: string,
        id: string,
        altSuffix: string,
        title?: string,
    ) {
        return html`
            <div class="profile-avatar ${variantClassName}" id="${id}" ${title ? `title="${title}"` : ''}>
                ${profilePictureSrc
                    ? html`<img src="${profilePictureSrc}" alt="${currentProfile} ${altSuffix}" class="profile-avatar-image" />`
                    : html`<span class="profile-avatar-fallback">${initials}</span>`
                }
            </div>
        `;
    }

    private renderReportContent() {
        const { report } = this.state;
        if (!report.timestamp) {
            return html`<div style="color: var(--text-secondary); text-align: center; padding: 1rem;">No report calculated yet.</div>`;
        }

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                    <span>Average Novel Reading Speed: <strong>${Number.parseInt(report.novelSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.novelCount} books)</span>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                    <span>Average Manga Reading Speed: <strong>${Number.parseInt(report.mangaSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.mangaCount} manga)</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Average Visual Novel Reading Speed: <strong>${Number.parseInt(report.vnSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.vnCount} VNs)</span>
                </div>
            </div>
        `;
    }

    private renderThemeOptions(currentValue: string) {
        const optionsHtml = THEME_OPTIONS.map(({ value, label }) => {
            const selected = value === currentValue ? ' selected' : '';
            return `<option value="${escapeHTML(value)}"${selected}>${escapeHTML(label)}</option>`;
        }).join('');
        return rawHtml(optionsHtml);
    }

    private renderReportTimestamp() {
        const { timestamp } = this.state.report;
        if (!timestamp) return '';

        return html`
            <div id="profile-report-timestamp" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;">
                Since ${new Date(timestamp).toISOString().split('T')[0]}
            </div>
        `;
    }

    private renderUpdatesCard() {
        const { updateState } = this.state;
        if (!updateState.isSupported) {
            return '';
        }

        return html`
            <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                <h3>Updates</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">Check for new releases and control whether Kechimochi checks automatically on startup.</p>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <label for="profile-updates-auto-check" style="display: inline-flex; align-items: center; gap: 0.6rem; color: var(--text-primary); cursor: pointer;">
                        <input id="profile-updates-auto-check" type="checkbox" ${updateState.autoCheckEnabled ? 'checked' : ''} />
                        Automatically check for updates on startup
                    </label>
                    <button class="btn btn-primary" id="profile-btn-check-updates" ${updateState.checking ? 'disabled' : ''}>
                        ${updateState.checking ? 'Checking...' : 'Check for updates'}
                    </button>
                </div>
                ${updateState.availableRelease
                    ? html`<p id="profile-update-summary" style="margin: 0; color: var(--text-secondary);">Latest available version: <strong style="color: var(--text-primary);">${updateState.availableRelease.version}</strong></p>`
                    : html`<p id="profile-update-summary" style="margin: 0; color: var(--text-secondary);">No newer release has been found in this session yet.</p>`}
            </div>
        `;
    }
    public async runSyncNowFromShell(): Promise<void> {
        await this.loadData();
        await this.handleRunSync();
    }

    private renderSyncCard() {
        if (!this.state.syncSupported) {
            return this.renderSyncDesktopOnlyCard();
        }

        const syncStatus = this.state.syncStatus;
        if (!syncStatus) {
            return this.renderSyncUnavailableCard(
                this.state.syncError || 'Cloud Sync status could not be loaded right now.'
            );
        }

        return this.renderLoadedSyncCard(syncStatus);
    }

    private renderSyncDesktopOnlyCard() {
        return html`
            <div class="card" id="profile-sync-card" style="display: flex; flex-direction: column; gap: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                    <h3 style="margin: 0;">Cloud Sync</h3>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: 999px; padding: 0.2rem 0.65rem;">App Only</span>
                </div>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;">Cloud Sync is only available in the app (not web).</p>
            </div>
        `;
    }

    private renderSyncUnavailableCard(message: string) {
        return html`
            <div class="card" id="profile-sync-card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid rgba(255, 71, 87, 0.25);">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                    <h3 style="margin: 0;">Cloud Sync</h3>
                    <span style="font-size: 0.8rem; color: #ff4757; border: 1px solid rgba(255, 71, 87, 0.35); border-radius: 999px; padding: 0.2rem 0.65rem;">Unavailable</span>
                </div>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;">${message}</p>
                <div style="display: flex; justify-content: flex-end;">
                    <button class="btn btn-primary" id="profile-btn-refresh-sync-status">Retry</button>
                </div>
            </div>
        `;
    }

    private renderLoadedSyncCard(syncStatus: SyncStatus) {
        const hasConflicts = syncStatus.conflict_count > 0;
        const isConfigured = syncStatus.sync_profile_id !== null;
        const statusColor = syncStatusColor(syncStatus);
        const chips = this.renderSyncChips(syncStatus, hasConflicts);
        const infoTiles = this.renderSyncInfoTiles(syncStatus);

        return html`
            <div class="card" id="profile-sync-card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid ${syncCardBorderColor(syncStatus.state)};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; flex-direction: column; gap: 0.45rem;">
                        <h3 style="margin: 0;">Cloud Sync</h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: center;">
                            <span style="font-size: 0.8rem; color: ${statusColor}; border: 1px solid ${statusColor}; border-radius: 999px; padding: 0.22rem 0.65rem;">
                                ${formatSyncStatusLabel(syncStatus)}
                            </span>
                            ${chips}
                        </div>
                    </div>
                    ${this.renderSyncActions(syncStatus, hasConflicts)}
                </div>

                <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;">
                    ${this.syncDescription(syncStatus)}
                </p>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem;">
                    ${infoTiles}
                </div>

                ${this.state.syncError
                    ? html`
                        <div style="padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid rgba(255, 71, 87, 0.35); background: rgba(255, 71, 87, 0.08); color: var(--text-primary);">
                            ${this.state.syncError}
                        </div>
                    `
                    : ''
                }

                ${isConfigured
                    ? html`
                        <div style="font-size: 0.82rem; color: var(--text-secondary);">
                            Renaming this profile updates the synced display name. If you want a separate cloud lineage, disconnect first and enable sync again to create a new profile.
                        </div>
                    `
                    : ''
                }

                ${isConfigured ? this.renderSyncRecoveryPanel(syncStatus) : ''}

                ${this.state.showSyncConflicts && hasConflicts ? this.renderSyncConflictPanel() : ''}
            </div>
        `;
    }

    private renderSyncChips(syncStatus: SyncStatus, hasConflicts: boolean): HTMLElement[] {
        const chips: HTMLElement[] = [];
        if (hasConflicts) {
            chips.push(html`
                <span style="font-size: 0.76rem; color: var(--text-primary); border: 1px solid rgba(255, 127, 80, 0.35); border-radius: 999px; padding: 0.22rem 0.65rem; background: rgba(255, 127, 80, 0.08);">
                    ${syncStatus.conflict_count} pending conflict${syncStatus.conflict_count === 1 ? '' : 's'}
                </span>
            `);
        }
        return chips;
    }

    private renderSyncInfoTiles(syncStatus: SyncStatus): HTMLElement[] {
        const tiles: Array<{ label: string; value: string; extra?: HTMLElement }> = [];
        if (syncStatus.google_account_email) {
            tiles.push({ label: 'Google account', value: syncStatus.google_account_email });
        }
        tiles.push({ label: 'Sync profile', value: syncStatus.profile_name || 'Not attached' });
        if (!isGenericDeviceName(syncStatus.device_name)) {
            tiles.push({ label: 'Device name', value: syncStatus.device_name!.trim() });
        }
        tiles.push({ label: 'Last sync', value: formatSyncTimestamp(syncStatus.last_sync_at) });

        if (isDesktop() && syncStatus.sync_profile_id) {
            tiles.push({
                label: 'Local backups size',
                value: formatBytes(syncStatus.backup_size_bytes),
                extra: syncStatus.backup_size_bytes > 0
                    ? html`
                        <div style="display: flex; justify-content: flex-end; margin-top: 0.2rem;">
                            <button class="btn btn-ghost" id="profile-btn-clear-sync-backups" style="padding: 0.2rem 0.5rem; font-size: 0.72rem; line-height: 1;">Clear</button>
                        </div>
                    `
                    : undefined
            });
        }

        return tiles.map((tile, index) => {
            const shouldSpanFullWidth = tiles.length % 2 === 1 && index === tiles.length - 1;
            return this.renderSyncInfoTile(tile.label, tile.value, shouldSpanFullWidth, tile.extra);
        });
    }

    private renderSyncActions(syncStatus: SyncStatus, hasConflicts: boolean) {
        if (syncStatus.state === 'disconnected') {
            return this.renderDisconnectedSyncActions(syncStatus);
        }
        return this.renderConfiguredSyncActions(syncStatus, hasConflicts);
    }

    private renderDisconnectedSyncActions(syncStatus: SyncStatus) {
        return html`
            <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                <button class="btn btn-primary" id="profile-btn-enable-sync">Enable Sync</button>
                ${syncStatus.google_authenticated
                    ? html`<button class="btn btn-ghost" id="profile-btn-disconnect-sync">Disconnect Google</button>`
                    : ''}
            </div>
        `;
    }

    private renderSyncRecoveryPanel(syncStatus: SyncStatus) {
        const disabled = !syncStatus.google_authenticated || syncStatus.state === 'syncing';
        const disabledAttr = disabled ? 'disabled' : '';
        const hint = syncStatus.google_authenticated
            ? 'An emergency local backup ZIP will be created first.'
            : 'Re-authenticate before using these recovery tools.';
        const toggleLabel = this.state.showSyncRecoveryTools ? 'Hide tools' : 'Show tools';

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.75rem; padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: rgba(255,255,255,0.02);">
                <button
                    id="profile-btn-toggle-sync-recovery"
                    type="button"
                    style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; width: 100%; padding: 0; border: none; background: transparent; color: inherit; cursor: pointer; text-align: left;"
                >
                    <span style="display: flex; flex-direction: column; gap: 0.2rem;">
                        <strong style="color: var(--text-primary);">Advanced recovery</strong>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">
                            Use only when normal sync or conflict resolution cannot recover this profile cleanly.
                        </span>
                    </span>
                    <span style="font-size: 0.82rem; color: var(--text-secondary); white-space: nowrap;">${toggleLabel}</span>
                </button>
                ${this.state.showSyncRecoveryTools
                    ? html`
                        <div style="display: flex; flex-direction: column; gap: 0.75rem; padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid rgba(255, 71, 87, 0.28); background: rgba(255, 71, 87, 0.06);">
                            <span style="color: var(--text-secondary); font-size: 0.85rem;">
                                These actions are destructive. ${hint}
                            </span>
                            <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                                <button class="btn btn-secondary" id="profile-btn-replace-local-from-remote" ${disabledAttr}>Replace Local From Remote</button>
                                <button class="btn btn-danger" id="profile-btn-force-publish-local" ${disabledAttr}>Force Publish Local</button>
                            </div>
                        </div>
                    `
                    : ''
                }
            </div>
        `;
    }

    private renderConfiguredSyncActions(syncStatus: SyncStatus, hasConflicts: boolean) {
        if (!syncStatus.google_authenticated) {
            return html`
                <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-primary" id="profile-btn-reconnect-sync">Re-authenticate</button>
                    <button class="btn btn-ghost" id="profile-btn-disconnect-sync">Disconnect</button>
                </div>
            `;
        }

        const runButtonText = this.syncRunButtonText(syncStatus.state);
        const syncButton = hasConflicts
            ? this.renderResolveConflictsButton(syncStatus.conflict_count)
            : this.renderRunSyncButton(syncStatus.state, runButtonText);

        return html`
            <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                ${syncButton}
                <button class="btn btn-ghost" id="profile-btn-disconnect-sync">Disconnect</button>
            </div>
        `;
    }

    private renderResolveConflictsButton(conflictCount: number) {
        const label = this.state.showSyncConflicts
            ? 'Hide Conflicts'
            : `Resolve Conflicts (${conflictCount})`;
        return html`<button class="btn btn-primary" id="profile-btn-toggle-sync-conflicts">${label}</button>`;
    }

    private renderRunSyncButton(state: SyncConnectionState, label: string) {
        const disabled = state === 'syncing' ? 'disabled' : '';
        return html`<button class="btn btn-primary" id="profile-btn-run-sync" ${disabled}>${label}</button>`;
    }

    private syncRunButtonText(state: SyncConnectionState): string {
        if (state === 'error') {
            return 'Retry Sync';
        }
        if (state === 'syncing') {
            return 'Syncing...';
        }
        return 'Sync Now';
    }

    private syncDescription(syncStatus: SyncStatus): string {
        if (syncStatus.sync_profile_id && !syncStatus.google_authenticated) {
            return 'This device is still attached to a cloud sync profile, but Google Drive needs to be reconnected before syncing can continue.';
        }
        if (syncStatus.state !== 'disconnected') {
            return 'Cloud Sync keeps your media library, logs, milestones, profile name, selected settings, and profile picture aligned through Google Drive.';
        }
        if (syncStatus.google_authenticated) {
            return 'Your Google account is connected, but this device is not attached to a cloud sync profile yet.';
        }
        return 'Connect this device to Google Drive to keep your library and progress in sync across installations.';
    }

    private renderSyncInfoTile(label: string, value: string, fullWidth = false, extra?: HTMLElement) {
        const spanStyle = fullWidth ? 'grid-column: 1 / -1;' : '';
        return html`
            <div style="${spanStyle} display: flex; flex-direction: column; gap: 0.25rem; padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02);">
                <span style="font-size: 0.78rem; color: var(--text-secondary);">${label}</span>
                <strong style="font-size: 0.96rem; color: var(--text-primary);">${value}</strong>
                ${extra || ''}
            </div>
        `;
    }

    private renderSyncConflictPanel() {
        return html`
            <div id="profile-sync-conflicts" style="display: flex; flex-direction: column; gap: 0.9rem; margin-top: 0.25rem;">
                <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                    <strong style="color: var(--text-primary);">Resolve pending conflicts</strong>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">Choose the winning value for each conflict. Once the queue is empty, run Sync Now to publish the merged result.</span>
                </div>
                ${this.state.syncConflicts.map((conflict, index) => this.renderSyncConflictCard(conflict, index))}
            </div>
        `;
    }

    private renderSyncConflictCard(conflict: SyncConflict, index: number) {
        switch (conflict.kind) {
            case 'media_field_conflict':
                return this.renderMediaFieldConflict(conflict, index);
            case 'extra_data_entry_conflict':
                return this.renderExtraDataConflict(conflict, index);
            case 'delete_vs_update':
                return this.renderDeleteVsUpdateConflict(conflict, index);
            case 'profile_picture_conflict':
                return this.renderProfilePictureConflict(conflict, index);
        }
    }

    private renderMediaFieldConflict(conflict: Extract<SyncConflict, { kind: 'media_field_conflict' }>, index: number) {
        const mediaLabel = conflict.field_name === 'title'
            ? conflict.local_value || conflict.remote_value || conflict.media_uid
            : conflict.media_uid;

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem; border: 1px solid rgba(255, 127, 80, 0.24); border-radius: var(--radius-md); background: rgba(255, 127, 80, 0.05);">
                <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <strong>${formatFieldLabel(conflict.field_name)} conflict</strong>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">Media: ${mediaLabel}</span>
                    </div>
                    <span style="font-size: 0.76rem; color: var(--text-secondary);">UID ${conflict.media_uid}</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                    ${this.renderSyncValueChoice('Local value', formatConflictValue(conflict.local_value))}
                    ${this.renderSyncValueChoice('Remote value', formatConflictValue(conflict.remote_value))}
                </div>
                <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-secondary" data-sync-conflict-index="${index}" data-sync-resolution-kind="media_field" data-sync-resolution-side="local">Keep Local</button>
                    <button class="btn btn-primary" data-sync-conflict-index="${index}" data-sync-resolution-kind="media_field" data-sync-resolution-side="remote">Use Remote</button>
                </div>
            </div>
        `;
    }

    private renderExtraDataConflict(conflict: Extract<SyncConflict, { kind: 'extra_data_entry_conflict' }>, index: number) {
        const remoteLabel = conflict.remote_value === null ? 'Discard entry' : 'Use Remote Entry';

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem; border: 1px solid rgba(255, 127, 80, 0.24); border-radius: var(--radius-md); background: rgba(255, 127, 80, 0.05);">
                <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <strong>Extra data entry conflict</strong>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">Key: ${conflict.entry_key}</span>
                    </div>
                    <span style="font-size: 0.76rem; color: var(--text-secondary);">UID ${conflict.media_uid}</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                    ${this.renderSyncValueChoice('Local entry', formatConflictValue(conflict.local_value), true)}
                    ${this.renderSyncValueChoice('Remote entry', formatConflictValue(conflict.remote_value), true)}
                </div>
                <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-secondary" data-sync-conflict-index="${index}" data-sync-resolution-kind="extra_data_entry" data-sync-resolution-side="local">Keep Local Entry</button>
                    <button class="btn btn-primary" data-sync-conflict-index="${index}" data-sync-resolution-kind="extra_data_entry" data-sync-resolution-side="remote">${remoteLabel}</button>
                </div>
            </div>
        `;
    }

    private renderDeleteVsUpdateConflict(conflict: Extract<SyncConflict, { kind: 'delete_vs_update' }>, index: number) {
        const deletedLabel = conflict.deleted_side === 'local' ? 'Local deleted this item' : 'Remote deleted this item';
        const restoredTitle =
            conflict.deleted_side === 'local'
                ? conflict.remote_media?.title || conflict.media_uid
                : conflict.local_media?.title || conflict.media_uid;

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem; border: 1px solid rgba(255, 127, 80, 0.24); border-radius: var(--radius-md); background: rgba(255, 127, 80, 0.05);">
                <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <strong>Delete vs update conflict</strong>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">${deletedLabel}</span>
                    </div>
                    <span style="font-size: 0.76rem; color: var(--text-secondary);">UID ${conflict.media_uid}</span>
                </div>
                <div style="padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02);">
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">Restore candidate</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${restoredTitle}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.35rem;">Deleted at ${formatSyncTimestamp(conflict.tombstone.deleted_at)}</div>
                </div>
                <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-secondary" data-sync-conflict-index="${index}" data-sync-resolution-kind="delete_vs_update" data-sync-resolution-choice="respect_delete">Respect Delete</button>
                    <button class="btn btn-primary" data-sync-conflict-index="${index}" data-sync-resolution-kind="delete_vs_update" data-sync-resolution-choice="restore">Restore Item</button>
                </div>
            </div>
        `;
    }

    private renderProfilePictureConflict(conflict: Extract<SyncConflict, { kind: 'profile_picture_conflict' }>, index: number) {
        return html`
            <div style="display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem; border: 1px solid rgba(255, 127, 80, 0.24); border-radius: var(--radius-md); background: rgba(255, 127, 80, 0.05);">
                <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                    <strong>Profile picture conflict</strong>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">Choose which picture should become the synced version.</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                    ${this.renderProfilePictureChoice('Local picture', conflict.local_picture)}
                    ${this.renderProfilePictureChoice('Remote picture', conflict.remote_picture)}
                </div>
                <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-secondary" data-sync-conflict-index="${index}" data-sync-resolution-kind="profile_picture" data-sync-resolution-side="local">Keep Local</button>
                    <button class="btn btn-primary" data-sync-conflict-index="${index}" data-sync-resolution-kind="profile_picture" data-sync-resolution-side="remote">Use Remote</button>
                </div>
            </div>
        `;
    }

    private renderSyncValueChoice(label: string, value: string, preformatted = false) {
        return html`
            <div style="display: flex; flex-direction: column; gap: 0.4rem; padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02);">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">${label}</span>
                <pre style="margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ${preformatted ? 'monospace' : 'inherit'}; font-size: 0.9rem; color: var(--text-primary);">${value}</pre>
            </div>
        `;
    }

    private renderProfilePictureChoice(label: string, picture: SyncConflictProfilePicture | null) {
        const pictureSrc = picture ? profilePictureToDataUrl(picture as ProfilePicture) : null;
        return html`
            <div style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.9rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02);">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">${label}</span>
                <div style="display: flex; justify-content: center; align-items: center; min-height: 124px; padding: 0.75rem; border-radius: var(--radius-md); background: rgba(255,255,255,0.03);">
                    ${pictureSrc
                        ? html`<img src="${pictureSrc}" alt="${label}" style="max-width: 100px; max-height: 100px; border-radius: 999px; object-fit: cover;" />`
                        : html`<span style="color: var(--text-secondary); font-size: 0.88rem;">No picture</span>`}
                </div>
                <span style="font-size: 0.82rem; color: var(--text-secondary);">${profilePictureLabel(picture)}</span>
            </div>
        `;
    }

    private setupListeners(root: HTMLElement) {
        const nameEl = root.querySelector('#profile-name') as HTMLElement;
        if (nameEl) {
            nameEl.addEventListener('dblclick', () => {
                this.handleProfileRename(nameEl).catch(error => {
                    Logger.error('Failed to rename profile', error);
                });
            });
        }

        root.querySelector('#profile-select-theme')?.addEventListener('change', async (e) => {
            const theme = (e.target as HTMLSelectElement).value;
            await setSetting(SETTING_KEYS.THEME, theme);
            if (!isThemeOverrideEnabled()) {
                applyTheme(theme);
            }
            this.setState({ theme });
        });

        root.querySelector('#profile-checkbox-theme-override')?.addEventListener('change', (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            setThemeOverrideEnabled(enabled);
            const effectiveTheme = enabled ? getThemeOverrideValue() : this.state.theme;
            applyTheme(effectiveTheme);
            this.setState({ themeOverrideEnabled: enabled });
            this.render();
        });

        root.querySelector('#profile-select-theme-local')?.addEventListener('change', (e) => {
            const localTheme = (e.target as HTMLSelectElement).value;
            setThemeOverrideValue(localTheme);
            if (isThemeOverrideEnabled()) {
                applyTheme(localTheme);
            }
            this.setState({ themeOverrideValue: localTheme });
        });

        root.querySelector('#profile-updates-auto-check')?.addEventListener('change', async (e) => {
            if (!this.updateManager) return;
            const enabled = (e.target as HTMLInputElement).checked;
            await this.updateManager.setAutoCheckEnabled(enabled);
        });

        root.querySelector('#profile-btn-check-updates')?.addEventListener('click', async () => {
            if (!this.updateManager) return;
            await this.updateManager.checkForUpdates({ manual: true });
        });

        root.querySelector('#profile-btn-enable-sync')?.addEventListener('click', () => {
            this.handleEnableSync().catch(error => {
                Logger.error('Failed to enable sync', error);
            });
        });

        root.querySelector('#profile-btn-reconnect-sync')?.addEventListener('click', () => {
            this.handleReconnectSync().catch(error => {
                Logger.error('Failed to reconnect Google Drive', error);
            });
        });

        root.querySelector('#profile-btn-run-sync')?.addEventListener('click', () => {
            this.handleRunSync().catch(error => {
                Logger.error('Failed to run sync', error);
            });
        });

        root.querySelector('#profile-btn-toggle-sync-recovery')?.addEventListener('click', () => {
            this.setState({ showSyncRecoveryTools: !this.state.showSyncRecoveryTools });
        });

        root.querySelector('#profile-btn-replace-local-from-remote')?.addEventListener('click', () => {
            this.handleReplaceLocalFromRemote().catch(error => {
                Logger.error('Failed to replace local data from remote', error);
            });
        });

        root.querySelector('#profile-btn-force-publish-local')?.addEventListener('click', () => {
            this.handleForcePublishLocalAsRemote().catch(error => {
                Logger.error('Failed to force publish local data', error);
            });
        });

        root.querySelector('#profile-btn-disconnect-sync')?.addEventListener('click', () => {
            this.handleDisconnectSync().catch(error => {
                Logger.error('Failed to disconnect sync', error);
            });
        });

        root.querySelector('#profile-btn-toggle-sync-conflicts')?.addEventListener('click', () => {
            this.setState({ showSyncConflicts: !this.state.showSyncConflicts });
        });

        root.querySelector('#profile-btn-refresh-sync-status')?.addEventListener('click', () => {
            this.refreshSyncData().catch(error => {
                Logger.error('Failed to refresh sync data', error);
            });
        });

        root.querySelector('#profile-btn-import-csv')?.addEventListener('click', async () => {
            try {
                const count = await getServices().pickAndImportActivities();
                if (count !== null) await customAlert("Success", `Successfully imported ${count} activity logs!`);
            } catch (e) {
                await customAlert("Error", `Import failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-export-csv')?.addEventListener('click', async () => {
            const modeData = await showExportCsvModal();
            if (!modeData) return;
            try {
                let count: number | null;
                if (modeData.mode === 'range') {
                    count = await getServices().exportActivities(modeData.start, modeData.end);
                } else {
                    count = await getServices().exportActivities();
                }
                if (count !== null) await customAlert("Success", `Successfully exported ${count} activity logs!`);
            } catch (e) {
                await customAlert("Error", `Export failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-import-media')?.addEventListener('click', async () => {
            try {
                const conflicts = await getServices().analyzeMediaCsvFromPick();
                if (!conflicts) return;
                if (conflicts.length === 0) {
                    await customAlert("Info", "No valid media rows found in the CSV.");
                    return;
                }
                const resolvedRecords = await showMediaCsvConflictModal(conflicts);
                if (!resolvedRecords || resolvedRecords.length === 0) return;
                const count = await applyMediaImport(resolvedRecords);
                await customAlert("Success", `Successfully imported ${count} media library entries!`);
            } catch (e) {
                await customAlert("Error", `Import failed: ${e}`);
            }
        });

        root.querySelector('#profile-hero-avatar')?.addEventListener('dblclick', async () => {
            try {
                const profilePicture = await uploadProfilePicture();
                if (!profilePicture) return;
                this.setState({ profilePicture });
                this.render();
                globalThis.dispatchEvent(new CustomEvent(EVENTS.PROFILE_UPDATED));
            } catch (e) {
                await customAlert("Error", `Profile picture upload failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-export-media')?.addEventListener('click', async () => {
            try {
                const count = await getServices().exportMediaLibrary(this.state.currentProfile);
                if (count !== null) await customAlert("Success", `Successfully exported ${count} media library entries!`);
            } catch (e) {
                await customAlert("Error", `Export failed: ${e}`);
            }
        });

        root.addEventListener('click', async (e) => {
            const target = (e.target as HTMLElement).closest('button');
            if (!target) return;

            if (target.dataset.syncConflictIndex !== undefined) {
                await this.handleResolveConflictAction(target);
                return;
            }

            if (target.id === 'profile-btn-clear-sync-backups') {
                if (await customConfirm("Clear Sync Backups", "This will delete all local emergency backups created before sync operations. Are you sure?", "btn-danger", "Clear")) {
                    try {
                        await clearSyncBackups();
                        await this.refreshSyncData();
                        await customAlert("Success", "Sync backups cleared.");
                    } catch (error) {
                        await customAlert("Error", `Failed to clear backups: ${stringifyError(error)}`);
                    }
                }
                return;
            }

            if (target.id === 'profile-btn-import-milestones') {
                try {
                    const count = await importMilestonesCsv('');
                    await customAlert("Success", `Successfully imported ${count} milestones!`);
                } catch (error) {
                    await customAlert("Error", `Import failed: ${error}`);
                }
            }

            if (target.id === 'profile-btn-export-milestones') {
                try {
                    const count = await exportMilestonesCsv('');
                    await customAlert("Success", `Successfully exported ${count} milestones!`);
                } catch (error) {
                    await customAlert("Error", `Export failed: ${error}`);
                }
            }
        });

        root.querySelector('#profile-btn-export-full-backup')?.addEventListener('click', async () => {
            const progress = showBlockingStatus("Exporting Full Backup", "Export in progress...");
            try {
                const localStorageData = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
                const version = await getAppVersion();
                const exported = await exportFullBackup(localStorageData, version);
                progress.close();
                if (exported) {
                    await customAlert("Success", "Full backup export completed.");
                }
            } catch (e) {
                progress.close();
                await customAlert("Error", `Export failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-import-full-backup')?.addEventListener('click', async () => {
            if (await customConfirm("Import Full Backup", "IMPORTING A FULL BACKUP WILL COMPLETELY REPLACE PREVIOUS DATA. Are you sure you want to proceed?", "btn-danger", "Import")) {
                try {
                    const newStorageStr = await importFullBackup();
                    if (newStorageStr) {
                        try {
                            const newStorage = JSON.parse(newStorageStr);
                            localStorage.clear();
                            for (const [key, value] of Object.entries(newStorage)) {
                                localStorage.setItem(key, value as string);
                            }
                        } catch (e) {
                            Logger.error("Failed to parse or apply local storage from backup", e);
                        }

                        await customAlert("Success", "Backup imported successfully!");
                        globalThis.location.reload();
                    }
                } catch (e) {
                    await customAlert("Error", `Import failed: ${e}`);
                }
            }
        });

        root.querySelector('#profile-btn-clear-activities')?.addEventListener('click', async () => {
            if (await customConfirm("Clear Activities", "Are you sure you want to delete all activity logs?", "btn-danger", "Clear")) {
                await clearActivities();
                await customAlert("Success", "All activity logs removed.");
            }
        });

        root.querySelector('#profile-btn-wipe-everything')?.addEventListener('click', async () => {
            if (await customPrompt("DANGER! Type 'WIPE_EVERYTHING' to confirm a total factory reset:") === 'WIPE_EVERYTHING') {
                await wipeEverything();
                localStorage.removeItem(STORAGE_KEYS.CURRENT_PROFILE);
                localStorage.removeItem(STORAGE_KEYS.THEME_OVERRIDE_ENABLED);
                localStorage.removeItem(STORAGE_KEYS.THEME_OVERRIDE);
                globalThis.location.reload();
            }
        });

        root.querySelector('#profile-btn-calculate-report')?.addEventListener('click', async () => {
            const btn = root.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = "Calculating...";
            try {
                await this.calculateReport();
                await this.loadData();
                this.render();
                await customAlert("Success", "Reading report card calculated successfully!");
            } catch {
                await customAlert("Error", "Failed to calculate report card.");
            } finally {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        });
    }

    private async handleProfileRename(nameEl: HTMLElement) {
        if (this.state.syncStatus?.sync_profile_id) {
            const confirmed = await customConfirm(
                'Rename Synced Profile',
                'This updates the synced display name for the current cloud profile. It does not create a new cloud profile.',
                'btn-primary',
                'Continue'
            );
            if (!confirmed) {
                return;
            }
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.state.currentProfile;
        input.style.fontSize = '2rem';
        input.style.fontWeight = 'bold';
        input.style.color = 'var(--text-primary)';
        input.style.background = 'transparent';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = 'var(--radius-sm)';
        input.style.padding = '0.2rem 0.5rem';
        input.style.margin = '0';
        input.style.outline = 'none';
        input.style.fontFamily = 'inherit';
        input.style.width = '100%';
        input.style.maxWidth = '400px';
        input.style.textAlign = 'center';

        const saveName = async () => {
            const newName = input.value.trim();
            if (newName && newName !== this.state.currentProfile) {
                await setSetting(SETTING_KEYS.PROFILE_NAME, newName);
                localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, newName);
                this.setState({ currentProfile: newName });
                globalThis.dispatchEvent(new CustomEvent(EVENTS.PROFILE_UPDATED));
            }
            this.render();
        };

        input.addEventListener('blur', () => {
            void saveName();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                this.render();
            }
        });

        nameEl.replaceWith(input);
        input.focus();
        input.select();
    }

    private async handleEnableSync() {
        if (!this.state.syncSupported) {
            await customAlert('Cloud Sync', 'Cloud Sync is only available in the app (not web).');
            return;
        }

        try {
            const selection = await resolveSyncEnablementSelection({
                googleAuthenticated: Boolean(this.state.syncStatus?.google_authenticated),
                googleEmail: this.state.syncStatus?.google_account_email || null,
                withBlockingStatus: this.withBlockingStatus,
            });
            if (!selection) {
                await this.refreshSyncData();
                return;
            }

            if (selection.action === 'create_new') {
                const result = await this.withSyncProgressBlockingStatus(
                    'Creating Cloud Sync Profile',
                    'Preparing your library snapshot and uploading any cover art. First sync can take longer on large libraries...',
                    'create_remote_sync_profile',
                    () => createRemoteSyncProfile()
                );
                await this.refreshSyncData();
                await customAlert('Cloud Sync Enabled', this.describeSyncActionResult(
                    result,
                    'Cloud Sync is now enabled for this profile.'
                ));
                return;
            }

            const result = await attachSelectedRemoteProfile(
                this.withSyncProgressBlockingStatus,
                selection.profileId,
                'Attaching Cloud Sync Profile',
                'Downloading remote data, applying changes on this device, and publishing the merged result...',
            );
            await this.refreshSyncData(selection.preview.conflict_count > 0);
            await customAlert('Cloud Sync Attached', this.describeAttachResult(result, selection.preview));
        } catch (error) {
            await this.showEnableSyncError(error);
            await this.refreshSyncData();
        }
    }

    private async handleReconnectSync() {
        try {
            await this.connectGoogleDriveForSync();
            await this.refreshSyncData(this.state.showSyncConflicts);
            await customAlert(
                'Google Drive Reconnected',
                'Google Drive authentication was restored for this device. You can sync again now.'
            );
        } catch (error) {
            await this.showEnableSyncError(error);
            await this.refreshSyncData(this.state.showSyncConflicts);
        }
    }

    private async handleRunSync() {
        try {
            await this.ensureGoogleDriveConnected(this.state.showSyncConflicts);

            const result = await this.withSyncProgressBlockingStatus(
                'Syncing to Google Drive',
                'Checking for local and remote changes, then publishing any merged updates...',
                'run_sync',
                () => runSync()
            );
            await this.refreshSyncData(result.sync_status.conflict_count > 0);

            if (result.sync_status.state === 'conflict_pending') {
                await customAlert(
                    'Conflicts Need Review',
                    `Sync found ${result.sync_status.conflict_count} conflict${result.sync_status.conflict_count === 1 ? '' : 's'}. Resolve them in the Cloud Sync card, then run Sync Now again to publish the merged state.`
                );
                return;
            }

            if (result.lost_race) {
                await customAlert(
                    'Sync Needs Another Pass',
                    'Another device published a newer snapshot first. Your local changes were kept safely and remain dirty, so you can run sync again.'
                );
                return;
            }

            await customAlert('Sync Complete', this.describeSyncActionResult(
                result,
                'Cloud Sync completed successfully.'
            ));
        } catch (error) {
            const message = stringifyError(error);
            if (isGoogleDriveNotAuthenticatedError(message)) {
                await customAlert(
                    'Google Drive Reconnect Needed',
                    'This device is no longer authenticated with Google Drive. Use Re-authenticate in the Cloud Sync card, then try syncing again.'
                );
                await this.refreshSyncData(this.state.showSyncConflicts);
                return;
            }
            await customAlert('Sync Error', `Sync failed: ${stringifyError(error)}`);
            await this.refreshSyncData();
        }
    }

    private async handleReplaceLocalFromRemote() {
        if (!(await customConfirm(
            'Replace Local From Remote',
            'This will create an emergency local backup ZIP, then overwrite this device\'s local media, logs, milestones, sync conflicts, and sync status from the latest Google Drive snapshot. Google Drive data will not be changed.',
            'btn-danger',
            'Replace Local'
        ))) {
            return;
        }

        try {
            await this.ensureGoogleDriveConnected(this.state.showSyncConflicts);

            const result = await this.withSyncProgressBlockingStatus(
                'Replacing Local Data From Cloud Sync',
                'Creating an emergency backup, then downloading the latest cloud snapshot and replacing this device\'s local state...',
                'replace_local_from_remote',
                () => replaceLocalFromRemote()
            );
            await this.refreshSyncData(false);
            await customAlert(
                'Local Recovery Complete',
                this.describeSyncActionResult(
                    result,
                    'This device was replaced with the latest cloud snapshot.'
                )
            );
        } catch (error) {
            await customAlert('Cloud Sync Recovery Failed', `Failed to replace local data: ${stringifyError(error)}`);
            await this.refreshSyncData();
        }
    }

    private async handleForcePublishLocalAsRemote() {
        if (!(await customConfirm(
            'Force Publish Local',
            'This will create an emergency local backup ZIP, then overwrite the Google Drive sync head with this device\'s current local state. Other devices will receive these changes the next time they sync.',
            'btn-danger',
            'Force Publish'
        ))) {
            return;
        }

        try {
            await this.ensureGoogleDriveConnected(this.state.showSyncConflicts);

            const result = await this.withSyncProgressBlockingStatus(
                'Force Publishing Local Data',
                'Creating an emergency backup, then uploading this device\'s local state as the new cloud sync head...',
                'force_publish_local_as_remote',
                () => forcePublishLocalAsRemote()
            );
            await this.refreshSyncData(false);

            if (result.lost_race) {
                await customAlert(
                    'Recovery Needs Another Attempt',
                    'Another device published a newer snapshot before this recovery write finished. Your local state and the emergency backup were preserved, so you can try the force publish again.'
                );
                return;
            }

            await customAlert(
                'Cloud Recovery Complete',
                this.describeSyncActionResult(
                    result,
                    'This device\'s current local state was published as the new cloud snapshot.'
                )
            );
        } catch (error) {
            await customAlert('Cloud Sync Recovery Failed', `Failed to force publish local data: ${stringifyError(error)}`);
            await this.refreshSyncData();
        }
    }

    private async connectGoogleDriveForSync() {
        return connectGoogleDriveForSync(
            this.withBlockingStatus,
            'Complete the Google sign-in flow to keep going.',
        );
    }

    private async ensureGoogleDriveConnected(showConflictsOnRefresh: boolean) {
        if (this.state.syncStatus?.google_authenticated) {
            return;
        }

        await this.connectGoogleDriveForSync();
        await this.refreshSyncData(showConflictsOnRefresh);
    }

    private async handleDisconnectSync() {
        const syncStatus = this.state.syncStatus;
        const message = syncStatus?.sync_profile_id
            ? 'Disconnecting will remove Google credentials and local sync metadata from this device. Your local media, logs, and milestones will stay on this installation.'
            : 'Disconnecting will remove the saved Google account from this device.';

        if (!(await customConfirm('Disconnect Cloud Sync', message, 'btn-danger', 'Disconnect'))) {
            return;
        }

        try {
            await this.withBlockingStatus(
                'Disconnecting Cloud Sync',
                'Removing local sync metadata and Google credentials from this device...',
                () => disconnectGoogleDrive()
            );
            await this.refreshSyncData(false);
            await customAlert('Cloud Sync Disconnected', 'Cloud Sync has been disconnected from this device. Your local library data is unchanged.');
        } catch (error) {
            await customAlert('Cloud Sync Error', `Failed to disconnect: ${stringifyError(error)}`);
            await this.refreshSyncData();
        }
    }

    private async handleResolveConflictAction(target: HTMLButtonElement) {
        const conflictIndex = Number.parseInt(target.dataset.syncConflictIndex || '', 10);
        if (Number.isNaN(conflictIndex)) {
            return;
        }

        const resolution = this.buildConflictResolution(target);
        if (!resolution) {
            return;
        }

        try {
            const result = await this.withBlockingStatus(
                'Resolving Conflict',
                'Applying your choice to the local merged snapshot...',
                () => resolveSyncConflict(conflictIndex, resolution)
            );
            const remaining = result.sync_status.conflict_count;
            await this.refreshSyncData(remaining > 0);

            if (remaining > 0) {
                await customAlert(
                    'Conflict Resolved',
                    `Saved your choice. ${remaining} conflict${remaining === 1 ? '' : 's'} still need review.`
                );
                return;
            }

            await customAlert(
                'All Conflicts Resolved',
                'The conflict queue is now empty. Run Sync Now to publish the merged state to Google Drive.'
            );
        } catch (error) {
            await customAlert('Conflict Resolution Failed', `Failed to resolve the conflict: ${stringifyError(error)}`);
            await this.refreshSyncData(true);
        }
    }

    private buildConflictResolution(target: HTMLButtonElement): SyncConflictResolution | null {
        const kind = target.dataset.syncResolutionKind;
        if (!kind) {
            return null;
        }

        if (kind === 'delete_vs_update') {
            const choice = target.dataset.syncResolutionChoice;
            if (choice === 'respect_delete' || choice === 'restore') {
                return {
                    kind: 'delete_vs_update',
                    choice,
                };
            }
            return null;
        }

        const side = target.dataset.syncResolutionSide;
        if (side !== 'local' && side !== 'remote') {
            return null;
        }

        if (kind === 'media_field' || kind === 'extra_data_entry' || kind === 'profile_picture') {
            return {
                kind,
                side: side as MergeSide,
            };
        }

        return null;
    }

    private async refreshSyncData(showConflictsOverride?: boolean) {
        try {
            await this.loadData();
            if (showConflictsOverride !== undefined) {
                this.setState({ showSyncConflicts: showConflictsOverride });
            }
        } catch (error) {
            Logger.error('Failed to refresh sync data', error);
        }
    }

    private async withBlockingStatus<T>(
        title: string,
        text: string,
        operation: () => Promise<T>,
        options?: {
            timeoutMs?: number;
            timeoutMessage?: string;
        },
    ): Promise<T> {
        return runBlockingStatus(title, text, operation, options);
    }

    private async withSyncProgressBlockingStatus<T>(
        title: string,
        text: string,
        operationName: SyncProgressUpdate['operation'],
        operation: () => Promise<T>,
    ): Promise<T> {
        return runSyncProgressBlockingStatus(title, text, operationName, operation);
    }

    private describeSyncActionResult(result: SyncActionResult, successMessage: string): string {
        const notes: string[] = [successMessage];

        if (result.sync_status.state === 'dirty') {
            notes.push('Local changes remain on this device and are ready for the next publish.');
        }

        if (result.remote_changed) {
            notes.push('Remote changes were incorporated into the merged local state.');
        }

        if (result.safety_backup_path) {
            notes.push(`Safety backup created at ${result.safety_backup_path}.`);
        }

        return notes.join(' ');
    }

    private describeAttachResult(result: SyncActionResult, preview: SyncAttachPreview): string {
        if (result.sync_status.conflict_count > 0) {
            return this.describeSyncActionResult(
                result,
                `The profile was attached, and ${result.sync_status.conflict_count} conflict${result.sync_status.conflict_count === 1 ? '' : 's'} need review before the merged state can be published.`
            );
        }

        const duplicateNote = preview.potential_duplicate_titles.length > 0
            ? ' Potential duplicate titles were detected, so it is worth skimming the merged library before your next sync.'
            : '';
        return this.describeSyncActionResult(
            result,
            `The profile was attached successfully.${duplicateNote}`
        );
    }

    private async showEnableSyncError(error: unknown) {
        const message = stringifyError(error);
        if (isMissingGoogleOAuthConfigError(message)) {
            await customAlert(
                'Cloud Sync Setup Needed',
                'Google Drive sign-in is unavailable right now because this app is missing required authentication settings. Please try a newer build or contact the app developer.'
            );
            return;
        }
        if (isMissingGoogleOAuthClientSecretError(message)) {
            await customAlert(
                'Cloud Sync OAuth Config Error',
                'Google Drive sign-in could not be completed because this app is missing part of its authentication setup. Please try a newer build or contact the app developer.'
            );
            return;
        }
        if (message.includes(ENABLE_SYNC_AUTH_TIMEOUT_ERROR)) {
            await customAlert(
                'Google Sign-In Timed Out',
                'The Google sign-in flow did not finish in time. Please try Enable Sync again.'
            );
            return;
        }
        if (isSyncTimeoutError(message)) {
            await customAlert(
                'Cloud Sync Timed Out',
                'Google Drive took too long to respond while enabling sync. Please try again.'
            );
            return;
        }
        if (isSyncAlreadyInProgressError(message)) {
            await customAlert(
                'Cloud Sync Busy',
                'A previous sync attempt is still finishing up. Please wait a moment and try again. If this keeps happening after restarting the app, the stale lock will now clear itself after a short timeout.'
            );
            return;
        }

        await customAlert('Cloud Sync Error', `Failed to enable sync: ${message}`);
    }

    private async calculateReport() {
        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setFullYear(now.getFullYear() - 1);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        const mediaList = await getAllMedia();
        const stats: Record<string, { totalSpeed: number, count: number }> = {
            "Novel": { totalSpeed: 0, count: 0 },
            "Manga": { totalSpeed: 0, count: 0 },
            "Visual Novel": { totalSpeed: 0, count: 0 }
        };
        for (const media of mediaList) {
            if (media.tracking_status !== 'Complete' || !stats[media.content_type ?? ""]) continue;

            let extraData: Record<string, string>;
            try { extraData = JSON.parse(media.extra_data || "{}"); } catch { continue; }

            const charCount = getCharacterCountFromExtraData(extraData);
            if (charCount === null) continue;

            const logs = await getLogsForMedia(media.id!);
            if (logs.length === 0 || logs[0].date < cutoffStr) continue;

            const totalMinutes = logs.reduce((acc, log) => acc + log.duration_minutes, 0);
            if (totalMinutes > 0) {
                stats[media.content_type ?? ""].totalSpeed += charCount / (totalMinutes / 60);
                stats[media.content_type ?? ""].count += 1;
            }
        }

        await this.saveReportStats(stats, cutoffDate);
    }

    private async saveReportStats(stats: Record<string, { totalSpeed: number, count: number }>, cutoffDate: Date): Promise<void> {
        await setSetting(SETTING_KEYS.STATS_REPORT_TIMESTAMP, cutoffDate.toISOString());
        const prefixMap: Record<string, string> = { "Novel": "novel", "Manga": "manga", "Visual Novel": "vn" };
        for (const key of ["Novel", "Manga", "Visual Novel"]) {
            const s = stats[key];
            const avgSpeed = s.count > 0 ? Math.round(s.totalSpeed / s.count) : 0;
            await setSetting(`stats_${prefixMap[key]}_speed`, avgSpeed.toString());
            await setSetting(`stats_${prefixMap[key]}_count`, s.count.toString());
        }
    }
}

import { getSetting, setSetting } from '../api';
import { getAppVersionInfo, getBundledReleaseNotes } from '../app_version';
import { Logger } from '../logger';
import { customAlert } from '../modal_base';
import { showAvailableUpdateModal, showInstalledUpdateModal } from './modal';
import { getServices } from '../services';
import { SETTING_KEYS } from '../constants';
import type { AppServices } from '../services';
import type { ReleaseInfo, UpdateState } from '../types';

const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/Morgawr/kechimochi/releases?per_page=20';
const GITHUB_HEADERS = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
} as const;
const UPDATE_CHECK_TIMEOUT_MS = 5000;

type SemverTuple = [number, number, number];
type UpdateStateListener = (state: UpdateState) => void;

interface GitHubReleasePayload {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    body?: string;
    html_url?: string;
    published_at?: string;
}

function fallbackReleaseNotes(): string {
    return '### Notes\n- No release notes were published for this release.';
}

function normalizeReleaseNotes(body: string): string {
    return body.trim().length > 0 ? body : fallbackReleaseNotes();
}

export function parseSemver(version: string): SemverTuple | null {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!match) return null;
    return [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10),
    ];
}

export function compareSemver(left: string, right: string): number {
    const leftParts = parseSemver(left);
    const rightParts = parseSemver(right);
    if (!leftParts || !rightParts) return 0;

    for (let i = 0; i < leftParts.length; i += 1) {
        if (leftParts[i] !== rightParts[i]) {
            return leftParts[i] > rightParts[i] ? 1 : -1;
        }
    }

    return 0;
}

function releaseFromPayload(payload: GitHubReleasePayload): ReleaseInfo | null {
    if (payload.draft || payload.prerelease) return null;
    const version = payload.tag_name?.startsWith('v') ? payload.tag_name.slice(1) : payload.tag_name;
    if (!version || !parseSemver(version)) return null;

    return {
        version,
        body: normalizeReleaseNotes(payload.body ?? ''),
        url: payload.html_url ?? 'https://github.com/Morgawr/kechimochi/releases',
        publishedAt: payload.published_at ?? '',
        prerelease: false,
    };
}

export function selectLatestEligibleRelease(payloads: unknown[]): ReleaseInfo | null {
    const releases = payloads
        .map(payload => releaseFromPayload(payload as GitHubReleasePayload))
        .filter((release): release is ReleaseInfo => release !== null);

    releases.sort((left, right) => compareSemver(right.version, left.version));
    return releases[0] ?? null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = globalThis.setTimeout(() => {
            reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then(value => {
                globalThis.clearTimeout(timeoutId);
                resolve(value);
            })
            .catch(error => {
                globalThis.clearTimeout(timeoutId);
                reject(error);
            });
    });
}

export class UpdateManager {
    private readonly listeners = new Set<UpdateStateListener>();
    private state: UpdateState;

    constructor(private readonly services: AppServices = getServices()) {
        this.state = {
            checking: false,
            autoCheckEnabled: true,
            availableRelease: null,
            installedVersion: getAppVersionInfo().version,
            isSupported: this.computeIsSupported(),
        };
    }

    public getState(): UpdateState {
        return { ...this.state };
    }

    public subscribe(listener: UpdateStateListener): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => {
            this.listeners.delete(listener);
        };
    }

    public async initialize(options: { isFreshInstall: boolean }): Promise<void> {
        const runtimeState = await this.resolveRuntimeState();
        this.setState({
            installedVersion: runtimeState.installedVersion,
            isSupported: runtimeState.isSupported,
        });

        if (!this.state.isSupported) {
            return;
        }

        await this.loadAutoCheckPreference();
        await this.handleInstalledVersion(options.isFreshInstall);

        if (this.state.autoCheckEnabled) {
            this.startAutomaticUpdateCheck();
        }
    }

    public async setAutoCheckEnabled(enabled: boolean): Promise<void> {
        if (!this.state.isSupported) return;
        await setSetting(SETTING_KEYS.UPDATES_AUTO_CHECK_ENABLED, String(enabled));
        this.setState({ autoCheckEnabled: enabled });
    }

    public async checkForUpdates(options: { manual?: boolean } = {}): Promise<ReleaseInfo | null> {
        const manual = options.manual === true;
        if (!this.state.isSupported || this.state.checking) {
            return this.state.availableRelease;
        }

        this.setState({ checking: true });
        try {
            const latestRelease = await withTimeout(this.fetchLatestRelease(), UPDATE_CHECK_TIMEOUT_MS);
            const availableRelease = latestRelease && compareSemver(latestRelease.version, this.state.installedVersion) > 0
                ? latestRelease
                : null;

            this.setState({ availableRelease });

            if (manual) {
                if (availableRelease) {
                    await this.openAvailableUpdateModal();
                } else {
                    await customAlert('Up to date', `Kechimochi ${this.state.installedVersion} is up to date.`);
                }
            }

            return availableRelease;
        } catch (error) {
            Logger.warn('[kechimochi] Update check failed:', error);
            if (manual) {
                await customAlert('Update Check Failed', 'Could not check for updates right now. Please try again later.');
            }
            return null;
        } finally {
            this.setState({ checking: false });
        }
    }

    public async openAvailableUpdateModal(): Promise<void> {
        if (!this.state.availableRelease) return;
        await showAvailableUpdateModal(
            this.state.installedVersion,
            this.state.availableRelease.version,
            this.state.availableRelease.body,
            this.state.availableRelease.url,
        );
    }

    private computeIsSupported(): boolean {
        const versionInfo = getAppVersionInfo();
        return this.services.isDesktop() && versionInfo.channel === 'release';
    }

    private async resolveRuntimeState(): Promise<Pick<UpdateState, 'installedVersion' | 'isSupported'>> {
        const versionInfo = getAppVersionInfo();
        const forcedVersion = await this.getForcedReleaseVersion();

        if (forcedVersion) {
            return {
                installedVersion: forcedVersion,
                isSupported: this.services.isDesktop(),
            };
        }

        return {
            installedVersion: versionInfo.version,
            isSupported: this.computeIsSupported(),
        };
    }

    private async getForcedReleaseVersion(): Promise<string | null> {
        try {
            const forcedVersion = await getSetting(SETTING_KEYS.UPDATES_E2E_RELEASE_VERSION);
            if (!forcedVersion) return null;
            return parseSemver(forcedVersion) ? forcedVersion : null;
        } catch {
            return null;
        }
    }

    private startAutomaticUpdateCheck(): void {
        this.checkForUpdates().catch(error => {
            Logger.warn('[kechimochi] Automatic update check failed unexpectedly:', error);
        });
    }

    private setState(nextState: Partial<UpdateState>): void {
        this.state = {
            ...this.state,
            ...nextState,
        };
        const snapshot = this.getState();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }

    private async loadAutoCheckPreference(): Promise<void> {
        const stored = await getSetting(SETTING_KEYS.UPDATES_AUTO_CHECK_ENABLED);
        this.setState({ autoCheckEnabled: stored !== 'false' });
    }

    private async handleInstalledVersion(isFreshInstall: boolean): Promise<void> {
        const currentVersion = this.state.installedVersion;

        if (isFreshInstall) {
            await setSetting(SETTING_KEYS.UPDATES_LAST_SEEN_RELEASE_VERSION, currentVersion);
            return;
        }

        const lastSeenVersion = await getSetting(SETTING_KEYS.UPDATES_LAST_SEEN_RELEASE_VERSION);
        const bundledNotes = normalizeReleaseNotes(getBundledReleaseNotes());

        if (!lastSeenVersion) {
            await showInstalledUpdateModal(currentVersion, bundledNotes);
            await setSetting(SETTING_KEYS.UPDATES_LAST_SEEN_RELEASE_VERSION, currentVersion);
            return;
        }

        const comparison = compareSemver(currentVersion, lastSeenVersion);
        if (comparison > 0) {
            await showInstalledUpdateModal(currentVersion, bundledNotes);
            await setSetting(SETTING_KEYS.UPDATES_LAST_SEEN_RELEASE_VERSION, currentVersion);
            return;
        }

        if (comparison < 0 || lastSeenVersion !== currentVersion) {
            await setSetting(SETTING_KEYS.UPDATES_LAST_SEEN_RELEASE_VERSION, currentVersion);
        }
    }

    private async fetchLatestRelease(): Promise<ReleaseInfo | null> {
        const response = await this.services.fetchExternalJson(
            GITHUB_RELEASES_API_URL,
            'GET',
            undefined,
            { ...GITHUB_HEADERS },
        );
        const payload = JSON.parse(response) as unknown;
        if (!Array.isArray(payload)) {
            throw new TypeError('Expected GitHub releases API to return an array');
        }
        return selectLatestEligibleRelease(payload);
    }
}

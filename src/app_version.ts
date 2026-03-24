declare const __APP_VERSION__: string;
declare const __APP_BUILD_CHANNEL__: string;
declare const __APP_RELEASE_STAGE__: string;
declare const __APP_RELEASE_NOTES__: string;
declare const __APP_RELEASES_URL__: string;

export type AppBuildChannel = 'dev' | 'release';
export type AppReleaseStage = 'beta' | 'stable';

export interface AppVersionInfo {
    version: string;
    channel: AppBuildChannel;
    releaseStage: AppReleaseStage;
}

function readBuildString(
    globalKey:
        | '__APP_VERSION__'
        | '__APP_BUILD_CHANNEL__'
        | '__APP_RELEASE_STAGE__'
        | '__APP_RELEASE_NOTES__'
        | '__APP_RELEASES_URL__',
    compileValue: string,
    fallback: string,
): string {
    const globalCandidate = (globalThis as Record<string, unknown>)[globalKey];
    if (typeof globalCandidate === 'string' && globalCandidate.trim().length > 0) {
        return globalCandidate;
    }
    if (typeof compileValue === 'string' && compileValue.trim().length > 0) {
        return compileValue;
    }
    return fallback;
}

function normalizeChannel(value: string): AppBuildChannel {
    return value === 'release' ? 'release' : 'dev';
}

function normalizeReleaseStage(value: string): AppReleaseStage {
    return value === 'stable' ? 'stable' : 'beta';
}

export function getAppVersionInfo(): AppVersionInfo {
    return {
        version: readBuildString('__APP_VERSION__', __APP_VERSION__, '0.0.0-dev.unknown'),
        channel: normalizeChannel(readBuildString('__APP_BUILD_CHANNEL__', __APP_BUILD_CHANNEL__, 'dev')),
        releaseStage: normalizeReleaseStage(readBuildString('__APP_RELEASE_STAGE__', __APP_RELEASE_STAGE__, 'beta')),
    };
}

export function getBuildVersion(): string {
    return getAppVersionInfo().version;
}

export function formatBuildBadge(versionInfo: AppVersionInfo = getAppVersionInfo()): string {
    if (versionInfo.channel === 'dev') {
        return `DEV BUILD ${versionInfo.version}`;
    }
    if (versionInfo.releaseStage === 'beta') {
        return `BETA VERSION ${versionInfo.version}`;
    }
    return `VERSION ${versionInfo.version}`;
}

export function formatProductVersionLabel(versionInfo: AppVersionInfo = getAppVersionInfo()): string {
    return `Kechimochi ${formatBuildBadge(versionInfo)}`;
}

export function getBundledReleaseNotes(): string {
    return readBuildString('__APP_RELEASE_NOTES__', __APP_RELEASE_NOTES__, '');
}

export function getReleasesUrl(): string {
    return readBuildString(
        '__APP_RELEASES_URL__',
        __APP_RELEASES_URL__,
        'https://github.com/Morgawr/kechimochi/releases',
    );
}

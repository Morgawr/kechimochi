import { describe, expect, it } from 'vitest';
import {
    formatBuildBadge,
    formatProductVersionLabel,
    formatRunningVersionSentence,
    formatShortVersion,
    getBundledReleaseNotes,
    getReleasesUrl,
} from '../src/app_version';

describe('app_version helpers', () => {
    it('formats dev build badges', () => {
        expect(formatBuildBadge({
            version: '0.1.0-dev.abc1234',
            channel: 'dev',
            releaseStage: 'beta',
        })).toBe('DEV BUILD 0.1.0-dev.abc1234');
    });

    it('formats beta release badges', () => {
        expect(formatBuildBadge({
            version: '0.1.0',
            channel: 'release',
            releaseStage: 'beta',
        })).toBe('BETA VERSION 0.1.0');
    });

    it('formats stable product labels', () => {
        expect(formatProductVersionLabel({
            version: '1.0.0',
            channel: 'release',
            releaseStage: 'stable',
        })).toBe('Kechimochi VERSION 1.0.0');
    });

    it('exposes bundled release metadata', () => {
        expect(getBundledReleaseNotes()).toContain('Bundled notes');
        expect(getReleasesUrl()).toBe('https://github.com/Morgawr/kechimochi/releases');
    });

    it('formats a dev channel short version with the dev suffix', () => {
        expect(formatShortVersion({
            version: '0.3.4-dev.84b0f04',
            channel: 'dev',
            releaseStage: 'beta',
        })).toBe('v0.3.4-dev');
    });

    it('formats a release beta short version with the beta suffix', () => {
        expect(formatShortVersion({
            version: '0.3.3-beta.2',
            channel: 'release',
            releaseStage: 'beta',
        })).toBe('v0.3.3-beta');
    });

    it('formats a release stable short version with no suffix', () => {
        expect(formatShortVersion({
            version: '0.3.3',
            channel: 'release',
            releaseStage: 'stable',
        })).toBe('v0.3.3');
    });

    it('formats a short version whose version string has no dash suffix', () => {
        expect(formatShortVersion({
            version: '1.0.0',
            channel: 'release',
            releaseStage: 'stable',
        })).toBe('v1.0.0');
    });

    it('prefers the dev suffix over beta when both apply', () => {
        expect(formatShortVersion({
            version: '0.5.0-dev.cafe123',
            channel: 'dev',
            releaseStage: 'beta',
        })).toBe('v0.5.0-dev');
    });

    it('describes a dev build in the running version sentence', () => {
        expect(formatRunningVersionSentence({
            version: '0.3.4-dev.84b0f04',
            channel: 'dev',
            releaseStage: 'beta',
        })).toBe("You're running Kechimochi v0.3.4-dev.84b0f04, a development build.");
    });

    it('describes a beta release in the running version sentence', () => {
        expect(formatRunningVersionSentence({
            version: '0.3.3-beta.2',
            channel: 'release',
            releaseStage: 'beta',
        })).toBe("You're running Kechimochi v0.3.3-beta.2, a beta release.");
    });

    it('ends the running version sentence right after the version for a stable release', () => {
        expect(formatRunningVersionSentence({
            version: '0.3.3',
            channel: 'release',
            releaseStage: 'stable',
        })).toBe("You're running Kechimochi v0.3.3.");
    });
});

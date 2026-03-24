import { describe, expect, it } from 'vitest';
import { formatBuildBadge, formatProductVersionLabel, getBundledReleaseNotes, getReleasesUrl } from '../src/app_version';

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
});

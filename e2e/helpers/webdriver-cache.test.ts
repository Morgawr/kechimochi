import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repairIncompleteWebdriverCache } from './webdriver-cache';

const temporaryDirectories: string[] = [];

function makeCache(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kechimochi-webdriver-cache-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

function makeExecutable(filePath: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'executable');
    chmodSync(filePath, 0o755);
}

describe('WebDriver cache repair', () => {
    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('removes an installation directory whose executable is missing', () => {
        const cacheDirectory = makeCache();
        const incompleteDirectory = path.join(
            cacheDirectory,
            'chrome',
            'linux-151.0.7922.34',
        );
        mkdirSync(path.join(incompleteDirectory, 'chrome-linux64'), { recursive: true });
        writeFileSync(path.join(incompleteDirectory, 'chrome-linux64', 'ABOUT'), 'partial');

        expect(repairIncompleteWebdriverCache(cacheDirectory)).toEqual([incompleteDirectory]);
        expect(existsSync(incompleteDirectory)).toBe(false);
    });

    it('preserves complete browser and driver installations', () => {
        const cacheDirectory = makeCache();
        const chromeDirectory = path.join(cacheDirectory, 'chrome', 'linux-151.0.7922.34');
        const driverDirectory = path.join(
            cacheDirectory,
            'chromedriver',
            'linux-151.0.7922.34',
        );
        makeExecutable(path.join(chromeDirectory, 'chrome-linux64', 'chrome'));
        makeExecutable(path.join(driverDirectory, 'chromedriver-linux64', 'chromedriver'));

        expect(repairIncompleteWebdriverCache(cacheDirectory)).toEqual([]);
        expect(existsSync(chromeDirectory)).toBe(true);
        expect(existsSync(driverDirectory)).toBe(true);
    });

    it('leaves archives and unrelated directories for the downloader to handle', () => {
        const cacheDirectory = makeCache();
        const chromeRoot = path.join(cacheDirectory, 'chrome');
        const archivePath = path.join(chromeRoot, '151.0.7922.34-chrome-linux64.zip');
        const unrelatedDirectory = path.join(chromeRoot, 'user-data');
        mkdirSync(unrelatedDirectory, { recursive: true });
        writeFileSync(archivePath, 'partial archive');

        expect(repairIncompleteWebdriverCache(cacheDirectory)).toEqual([]);
        expect(existsSync(archivePath)).toBe(true);
        expect(existsSync(unrelatedDirectory)).toBe(true);
    });
});

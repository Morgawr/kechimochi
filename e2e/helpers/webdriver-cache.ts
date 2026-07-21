import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

type CachedBrowser = 'chrome' | 'chromedriver';
type CachedPlatform = 'linux' | 'linux_arm' | 'mac' | 'mac_arm' | 'win32' | 'win64';

const PLATFORM_PREFIXES: CachedPlatform[] = [
  'linux_arm',
  'mac_arm',
  'linux',
  'mac',
  'win32',
  'win64',
];

const EXECUTABLE_PATHS: Record<CachedBrowser, Record<CachedPlatform, string[]>> = {
  chrome: {
    linux: ['chrome-linux64', 'chrome'],
    linux_arm: ['chrome-linux64', 'chrome'],
    mac: [
      'chrome-mac-x64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ],
    mac_arm: [
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ],
    win32: ['chrome-win32', 'chrome.exe'],
    win64: ['chrome-win64', 'chrome.exe'],
  },
  chromedriver: {
    linux: ['chromedriver-linux64', 'chromedriver'],
    linux_arm: ['chromedriver-linux64', 'chromedriver'],
    mac: ['chromedriver-mac-x64', 'chromedriver'],
    mac_arm: ['chromedriver-mac-arm64', 'chromedriver'],
    win32: ['chromedriver-win32', 'chromedriver.exe'],
    win64: ['chromedriver-win64', 'chromedriver.exe'],
  },
};

function getCachedPlatform(directoryName: string): CachedPlatform | undefined {
  return PLATFORM_PREFIXES.find(platform => directoryName.startsWith(`${platform}-`));
}

function isUsableExecutable(executablePath: string, platform: CachedPlatform): boolean {
  if (!existsSync(executablePath)) {
    return false;
  }

  try {
    const stats = statSync(executablePath);
    const hasExecutableBit = platform.startsWith('win') || (stats.mode & 0o111) !== 0;
    return stats.isFile() && stats.size > 0 && hasExecutableBit;
  } catch {
    return false;
  }
}

/**
 * Removes browser installation directories left half-extracted by an interrupted
 * WebdriverIO download. Puppeteer's installer retries a missing download, but it
 * refuses to overwrite an existing directory whose executable is absent.
 *
 * Download archives and unrelated cache files are deliberately preserved. On
 * the next setup attempt Puppeteer can reuse a complete archive, or discard and
 * re-download an invalid one itself.
 */
export function repairIncompleteWebdriverCache(cacheDirectory: string): string[] {
  const removedDirectories: string[] = [];

  for (const browser of Object.keys(EXECUTABLE_PATHS) as CachedBrowser[]) {
    const browserDirectory = path.join(cacheDirectory, browser);
    if (!existsSync(browserDirectory)) {
      continue;
    }

    for (const entry of readdirSync(browserDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const platform = getCachedPlatform(entry.name);
      if (!platform) {
        continue;
      }

      const installationDirectory = path.join(browserDirectory, entry.name);
      const executablePath = path.join(
        installationDirectory,
        ...EXECUTABLE_PATHS[browser][platform],
      );

      if (isUsableExecutable(executablePath, platform)) {
        continue;
      }

      rmSync(installationDirectory, {
        force: true,
        recursive: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      removedDirectories.push(installationDirectory);
    }
  }

  return removedDirectories;
}

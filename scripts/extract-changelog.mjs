#!/usr/bin/env node

import { extractChangelogSection, normalizeReleaseVersion } from './changelog-utils.mjs';

const rawVersion = process.argv[2];

try {
  const version = normalizeReleaseVersion(rawVersion);
  const section = extractChangelogSection(version);
  process.stdout.write(`${section}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(rawVersion ? message : 'Usage: npm run changelog:extract -- X.Y.Z');
  process.exit(1);
}

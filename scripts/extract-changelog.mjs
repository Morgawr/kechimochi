#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const rawVersion = process.argv[2];
const version = rawVersion?.startsWith('v') ? rawVersion.slice(1) : rawVersion;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run changelog:extract -- X.Y.Z');
  process.exit(1);
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const headerPattern = new RegExp(
  String.raw`^## \[${escapeRegExp(version)}\](?:\s*-\s*.+)?$`,
  'm',
);
const headerMatch = changelog.match(headerPattern);

if (headerMatch?.index === undefined) {
  console.error(`Could not find CHANGELOG.md section for version ${version}`);
  process.exit(1);
}

const sectionStart = headerMatch.index;
const remaining = changelog.slice(sectionStart + headerMatch[0].length);
const nextHeaderMatch = remaining.match(/\n## \[/);
const sectionEnd = nextHeaderMatch
  ? sectionStart + headerMatch[0].length + nextHeaderMatch.index
  : changelog.length;

const section = changelog.slice(sectionStart, sectionEnd).trim();
process.stdout.write(`${section}\n`);

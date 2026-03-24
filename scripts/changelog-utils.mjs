import { readFileSync } from 'node:fs';

export function normalizeReleaseVersion(rawVersion) {
  const version = rawVersion?.startsWith('v') ? rawVersion.slice(1) : rawVersion;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Expected a semantic version in the form X.Y.Z');
  }
  return version;
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function readChangelog() {
  return readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

export function extractChangelogSection(rawVersion) {
  const version = normalizeReleaseVersion(rawVersion);
  const changelog = readChangelog();
  const headerPattern = new RegExp(
    String.raw`^## \[${escapeRegExp(version)}\](?:\s*-\s*.+)?$`,
    'm',
  );
  const headerMatch = changelog.match(headerPattern);

  if (headerMatch?.index === undefined) {
    throw new Error(`Could not find CHANGELOG.md section for version ${version}`);
  }

  const sectionStart = headerMatch.index;
  const remaining = changelog.slice(sectionStart + headerMatch[0].length);
  const nextHeaderMatch = remaining.match(/\n## \[/);
  const sectionEnd = nextHeaderMatch
    ? sectionStart + headerMatch[0].length + nextHeaderMatch.index
    : changelog.length;

  return changelog.slice(sectionStart, sectionEnd).trim();
}

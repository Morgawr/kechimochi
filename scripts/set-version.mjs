#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run version:set -- X.Y.Z');
  process.exit(1);
}

function updateJsonFile(fileUrl, updater) {
  const current = JSON.parse(readFileSync(fileUrl, 'utf8'));
  const next = updater(current);
  writeFileSync(fileUrl, `${JSON.stringify(next, null, 2)}\n`);
}

updateJsonFile(new URL('../package.json', import.meta.url), current => ({
  ...current,
  version,
}));

updateJsonFile(new URL('../package-lock.json', import.meta.url), current => ({
  ...current,
  version,
  packages: current.packages
    ? {
        ...current.packages,
        '': {
          ...(current.packages[''] ?? {}),
          version,
        },
      }
    : current.packages,
}));

const cargoTomlUrl = new URL('../src-tauri/Cargo.toml', import.meta.url);
const cargoToml = readFileSync(cargoTomlUrl, 'utf8');
const nextCargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
  `$1${version}$3`,
);

if (nextCargoToml === cargoToml) {
  console.error('Failed to update src-tauri/Cargo.toml package version.');
  process.exit(1);
}

writeFileSync(cargoTomlUrl, nextCargoToml);

updateJsonFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), current => ({
  ...current,
  version,
}));

console.log(`Updated project version to ${version}`);

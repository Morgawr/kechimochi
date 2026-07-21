/**
 * Declarative per-spec setup registry.
 *
 * Maps a spec basename (without ".spec.ts") to the options that
 * prepareTestDir() and the sync-mock wiring need. Any spec not listed here
 * receives the plain defaults (seeded fixture DB, no sync mock, no special
 * settings).
 *
 * The keys are spec basenames, so a spec rename can leave a key pointing at
 * nothing. assertRegistryMatchesSpecs() (called once from onPrepare) turns that
 * silent reflection drift into a loud startup failure.
 */

import { readdirSync } from 'node:fs';
import { E2E_PACKAGE_VERSION } from '../helpers/setup.js';

export interface SpecSetupDescriptor {
  /**
   * Extra key/value pairs to write into the test-dir's settings table before
   * the app starts.
   */
  extraSettings?: Record<string, string>;

  /**
   * When set, both fixture databases have their user_version pragma forced to
   * this number (used by startup-schema-mismatch to simulate a future schema).
   */
  overrideSchemaVersion?: number;

  /**
   * When true, prepareTestDir() skips copying fixture data — the app sees an
   * empty data directory (first-run / fresh-install flow).
   */
  freshInstall?: boolean;

  /**
   * When true, a local sync-mock HTTP server is started and its endpoint URLs
   * are injected into the app environment.
   */
  needsSyncMock?: boolean;

  /**
   * When true, the sync-backup fixture (two pre-existing ZIP files + a
   * sync_config.json) is seeded into the test directory.
   */
  needsSyncBackupFixture?: boolean;

  /**
   * When true, the app environment gets the file-backed token store path so
   * CI does not depend on desktop keyring availability.
   */
  needsTokenStoreOverride?: boolean;

  /**
   * When true, the legacy local-profile migration is skipped via an env var
   * (only used by fresh-install flows that must not see a pre-existing profile).
   */
  skipLegacyLocalProfileMigration?: boolean;

  /**
   * Debug-only owner record used to make startup exercise the lock-contention
   * warning. The OS-level exclusion itself is covered by Rust tests.
   */
  instanceLockOwner?: string;
}

const DEFAULT_DESCRIPTOR: Required<SpecSetupDescriptor> = {
  extraSettings: {},
  overrideSchemaVersion: undefined as unknown as number,
  freshInstall: false,
  needsSyncMock: false,
  needsSyncBackupFixture: false,
  needsTokenStoreOverride: false,
  skipLegacyLocalProfileMigration: false,
  instanceLockOwner: '',
};

/**
 * Registry keyed by spec basename (the filename stem under specs/**).
 *
 * Lists only specs that need non-default setup; everything else takes the
 * defaults. When a spec is merged/renamed, update its key here — the startup
 * guard fails loudly if a key no longer matches a file.
 */
const SPEC_SETUP_REGISTRY: Record<string, SpecSetupDescriptor> = {
  // Needs the update-check settings so the app detects the seeded "newer" release.
  'update-notifications': {
    extraSettings: {
      updates_auto_check_enabled: 'true',
      updates_last_seen_release_version: '0.0.1',
      updates_e2e_release_version: E2E_PACKAGE_VERSION,
    },
  },

  // Full sync-mock server + file-backed token store.
  'cloud-sync': {
    needsSyncMock: true,
    needsTokenStoreOverride: true,
  },

  // Fresh-install (no fixture data), sync-mock, token store override, and
  // legacy-migration skip so the first-run prompt appears.
  'startup-cloud-sync': {
    freshInstall: true,
    needsSyncMock: true,
    needsTokenStoreOverride: true,
    skipLegacyLocalProfileMigration: true,
  },

  // Fixture DBs with a far-future schema version.
  'startup-schema-mismatch': {
    overrideSchemaVersion: 999,
  },

  // A readable owner record plus a debug-only forced contention signal lets
  // both desktop and web assert the user-facing diagnostic path.
  'startup-instance-lock': {
    instanceLockOwner: [
      'version=1',
      'pid=4242',
      'kind=e2e-lock-holder',
      'started_at=2026-07-21T13:42:09Z',
      '',
    ].join('\n'),
  },

  // Token store override + pre-seeded backup ZIPs.
  'sync-backup-management': {
    needsTokenStoreOverride: true,
    needsSyncBackupFixture: true,
  },

  // Android fresh-install smoke: deliberately empty data dir (first-run flow).
  // Seeded Android specs use the default (seeded) descriptor; their data is
  // pushed into the app sandbox by drivers/android-driver.ts seedSession().
  'fresh-install-smoke': {
    freshInstall: true,
  },
};

/**
 * Returns the setup descriptor for a given spec basename.
 * Falls back to plain defaults when the spec is not in the registry.
 */
export function getSpecSetup(specBasename: string): Required<SpecSetupDescriptor> {
  const entry = SPEC_SETUP_REGISTRY[specBasename];
  if (!entry) return { ...DEFAULT_DESCRIPTOR };
  return { ...DEFAULT_DESCRIPTOR, ...entry };
}

/**
 * Throws if a registry key has no matching "<key>.spec.ts" under specsRoot —
 * catches a spec rename/deletion that left a stale key behind. Called once from
 * onPrepare: WDIO logs the throw as a launcher-hook error and the run exits
 * non-zero (reds the CI job), so the drift surfaces loudly. Note WDIO does not
 * abort on an onPrepare throw — the specs still run, the affected one with its
 * default setup; the protection is the failed exit code, not a hard halt.
 */
export function assertRegistryMatchesSpecs(specsRoot: string): void {
  const specBasenames = new Set(
    readdirSync(specsRoot, { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .map(entry => entry.name.slice(0, -'.spec.ts'.length)),
  );

  const staleKeys = Object.keys(SPEC_SETUP_REGISTRY).filter(key => !specBasenames.has(key));
  if (staleKeys.length > 0) {
    throw new Error(
      `[e2e] spec-setup registry key(s) with no matching .spec.ts file: ${staleKeys.join(', ')}. ` +
      `Rename the key to match the spec, or remove the entry.`,
    );
  }
}

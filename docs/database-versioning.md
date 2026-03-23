# Database Versioning and Migration Policy

This document defines how Kechimochi versions its persisted data and how schema upgrades must be implemented going forward.

## Version Types

Kechimochi now tracks three different version concepts:

1. App version
Semantic version used for releases such as `1.0.0`, `1.1.2`, or `2.0.0`.

2. Database schema version
Integer version stored in SQLite via `PRAGMA user_version`.
This tracks changes to persisted database structure or persisted-data meaning.

3. Backup format version
Integer version for the full-backup zip layout and manifest structure.
This allows backup packaging to evolve independently from the database schema.

These versions are intentionally separate.
An app release may keep the same database schema version, and a new backup format does not automatically imply a database schema change.

## Current Baseline

- Current database schema version: `1`
- Current backup format version: `1`
- First stable release schema: the current latest schema in `src-tauri`

Databases created before explicit schema versioning are treated as legacy pre-release databases.
They are upgraded by a one-time legacy upgrader and then stamped as schema version `1`.

## Storage Model

Kechimochi persists data in two SQLite files:

- `kechimochi_user.db`
- `kechimochi_shared_media.db`

These two files are treated as one logical storage bundle.
They must always end up on the same schema version.

The schema version is stored in both database files with the same integer value.

## Startup Rules

On database initialization:

1. Open `kechimochi_user.db`
2. Attach `kechimochi_shared_media.db` as `shared`
3. Apply SQLite pragmas
4. Detect schema state
5. Migrate to the latest supported schema if needed
6. Validate the final schema before the app continues

The app must behave as follows:

- If the schema version is lower than the current supported version, run migrations sequentially until current.
- If the schema version matches the current supported version, continue normally.
- If both DB files are unversioned but contain tables, treat them as legacy pre-release data and upgrade them to schema version `1`.
- If the database schema version is newer than the app supports, fail clearly and do not modify the files.
- If the two DB files disagree on version, treat that as an inconsistent state and only auto-repair it when the actual schema structure is clearly recoverable.

## Migration Rules

All schema changes must follow these rules:

1. Every persisted-data change gets a versioned migration step.
Examples:
- Adding a required column
- Renaming or splitting a table
- Changing stored record semantics
- Backfilling existing rows to new rules

2. Pure UI changes do not change the database schema version.

3. Index-only changes may stay idempotent and separate when they do not change persisted-data meaning.

4. New installs must create the latest schema directly.
They must not replay old historical migrations.

5. Shipped migrations are append-only.
After a release is published, do not rewrite old migration behavior unless absolutely necessary.
Add a new corrective migration instead.

## Migration Naming

Future migrations must be named by version transition, not by feature alone.

Good examples:

- `v1_to_v2_add_reading_goals`
- `v2_to_v3_split_profile_settings`

Avoid generic names like:

- `migrate_stuff`
- `fix_schema`
- `update_logs`

## Adding a New Schema Version

When introducing a new schema version:

1. Bump `CURRENT_SCHEMA_VERSION`
2. Add exactly one migration entry from `vN` to `vN+1`
3. Keep the migration focused on one release step
4. Update tests
5. Update this document if the policy or baseline changes

Each migration should:

- Check for the expected source state
- Apply the required DDL and data backfills
- Fail loudly on unexpected SQL errors
- Set the schema version only after the migration succeeds

## Backup Rules

Full backups must include:

- `manifest.json`
- `version.txt`
- `local_storage.json`
- `kechimochi_user.db`
- `kechimochi_shared_media.db`
- optional WAL/SHM files when present
- covers directory contents when present

`manifest.json` is the authoritative backup metadata file and must include:

- `backup_format_version`
- `app_version`
- `db_schema_version`
- `created_at`

During restore:

1. Validate the backup manifest if present
2. Reject backups using a newer unsupported backup format
3. Reject backups whose DB schema version is newer than the running app supports
4. Restore files to disk
5. Re-run normal DB initialization so schema migration uses the same startup path as a normal app launch

Older backups without a manifest remain supported through the legacy path.

## Testing Requirements

Any schema change must include tests for:

- Fresh database creation at the latest schema version
- Legacy upgrade into the latest schema
- No-op startup on the current schema
- Rejection of newer unsupported schemas
- Full-backup export metadata
- Full-backup restore for an older schema when relevant

## Release Guidance

Use this mental model:

- App `1.0.0` can use DB schema `1`
- App `1.0.1` can still use DB schema `1`
- App `1.1.0` might still use DB schema `1`
- App `1.2.0` might move to DB schema `2` if persisted storage changes

App semver communicates product release changes.
Database schema version communicates persistence compatibility.

Keep them independent.

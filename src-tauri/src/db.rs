use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Result};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

use crate::models::{
    ActivityLog, ActivitySummary, DailyHeatmap, Media, Milestone, ProfilePicture, TimelineEvent,
};

pub const CURRENT_SCHEMA_VERSION: i64 = 6;

type MigrationFn = fn(&Connection) -> Result<()>;

struct Migration {
    from: i64,
    to: i64,
    apply: MigrationFn,
}

const VERSIONED_MIGRATIONS: &[Migration] = &[
    Migration {
        from: 1,
        to: 2,
        apply: migrate_v1_to_v2_add_sync_foundation,
    },
    Migration {
        from: 2,
        to: 3,
        apply: migrate_v2_to_v3_add_activity_notes,
    },
    Migration {
        from: 3,
        to: 4,
        apply: migrate_v3_to_v4_add_media_variant,
    },
    Migration {
        from: 4,
        to: 5,
        apply: migrate_v4_to_v5_rename_default_activity_type,
    },
    Migration {
        from: 5,
        to: 6,
        apply: migrate_v5_to_v6_use_media_title_variant_identity,
    },
];

const KECHIMOCHI_SYNC_NAMESPACE: &str = "0718e147-943f-4f0a-977d-5447bb2342f2";

const SHARED_MEDIA_COLUMNS: &[&str] = &[
    "id",
    "uid",
    "title",
    "default_activity_type",
    "status",
    "language",
    "description",
    "cover_image",
    "extra_data",
    "content_type",
    "tracking_status",
    "variant",
];

const ACTIVITY_LOG_COLUMNS: &[&str] = &[
    "id",
    "media_id",
    "duration_minutes",
    "characters",
    "date",
    "activity_type",
    "notes",
];

const MILESTONE_COLUMNS: &[&str] = &[
    "id",
    "media_uid",
    "media_title",
    "name",
    "duration",
    "characters",
    "date",
];

const SETTINGS_COLUMNS: &[&str] = &["key", "value", "updated_at"];
const PROFILE_PICTURE_COLUMNS: &[&str] = &[
    "id",
    "mime_type",
    "base64_data",
    "byte_size",
    "width",
    "height",
    "updated_at",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchemaState {
    Fresh,
    LegacyUnversioned,
    Versioned(i64),
    Mixed { main: i64, shared: i64 },
}

fn migration_error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(io::Error::other(message.into())))
}

#[derive(Debug, Clone)]
struct SharedMediaRow {
    id: i64,
    title: String,
    default_activity_type: String,
    status: String,
    language: String,
    description: String,
    cover_image: String,
    extra_data: String,
    content_type: String,
    tracking_status: String,
}

fn sync_namespace_uuid() -> Result<Uuid> {
    Uuid::parse_str(KECHIMOCHI_SYNC_NAMESPACE)
        .map_err(|e| migration_error(format!("Invalid sync namespace UUID: {}", e)))
}

fn utc_now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn generate_deterministic_media_uid(title: &str) -> Result<String> {
    Ok(Uuid::new_v5(&sync_namespace_uuid()?, title.as_bytes()).to_string())
}

fn generate_random_media_uid() -> String {
    Uuid::new_v4().to_string()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub trait DataDirProvider {
    fn app_data_dir(&self) -> Option<PathBuf>;
}

impl DataDirProvider for tauri::AppHandle {
    fn app_data_dir(&self) -> Option<PathBuf> {
        self.path().app_data_dir().ok()
    }
}

pub struct StandaloneDataDirProvider;

pub const STANDALONE_DATA_DIR_PROVIDER: StandaloneDataDirProvider = StandaloneDataDirProvider;

impl DataDirProvider for StandaloneDataDirProvider {
    fn app_data_dir(&self) -> Option<PathBuf> {
        None
    }
}

fn default_data_dir_from_identifier() -> PathBuf {
    let app_id = std::env::var("KECHIMOCHI_APP_IDENTIFIER")
        .unwrap_or_else(|_| "com.morg.kechimochi".to_string());

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").expect("APPDATA env var not set");
        PathBuf::from(appdata).join(app_id)
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").expect("HOME env var not set");
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(app_id)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let data_home = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| {
                let home = std::env::var("HOME").expect("HOME env var not set");
                PathBuf::from(home).join(".local").join("share")
            });
        data_home.join(app_id)
    }
}

fn get_schema_version(conn: &Connection, schema: &str) -> Result<i64> {
    conn.query_row(&format!("PRAGMA {}.user_version", schema), [], |row| {
        row.get(0)
    })
}

fn set_schema_version(conn: &Connection, schema: &str, version: i64) -> Result<()> {
    conn.execute_batch(&format!("PRAGMA {}.user_version = {};", schema, version))?;
    Ok(())
}

fn set_bundle_schema_version(conn: &Connection, version: i64) -> Result<()> {
    set_schema_version(conn, "main", version)?;
    set_schema_version(conn, "shared", version)?;
    Ok(())
}

pub fn get_bundle_schema_version(conn: &Connection) -> Result<i64> {
    let main = get_schema_version(conn, "main")?;
    let shared = get_schema_version(conn, "shared")?;
    if main == shared {
        Ok(main)
    } else {
        Err(migration_error(format!(
            "Database schema versions are out of sync (main={}, shared={})",
            main, shared
        )))
    }
}

fn table_exists(conn: &Connection, schema: &str, table: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM {}.sqlite_master WHERE type='table' AND name=?1",
            schema
        ),
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn schema_is_attached(conn: &Connection, schema: &str) -> Result<bool> {
    let mut stmt = conn.prepare("PRAGMA database_list")?;
    let schemas = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in schemas {
        if existing? == schema {
            return Ok(true);
        }
    }
    Ok(false)
}

fn schema_has_user_tables(conn: &Connection, schema: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM {}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            schema
        ),
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn table_has_column(conn: &Connection, schema: &str, table: &str, column: &str) -> Result<bool> {
    if !table_exists(conn, schema, table)? {
        return Ok(false);
    }

    let mut stmt = conn.prepare(&format!("PRAGMA {}.table_info({})", schema, table))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_column_is_not_null(
    conn: &Connection,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool> {
    if !table_exists(conn, schema, table)? {
        return Ok(false);
    }

    let mut stmt = conn.prepare(&format!("PRAGMA {}.table_info({})", schema, table))?;
    let columns = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)? != 0))
    })?;
    for existing in columns {
        let (name, is_not_null) = existing?;
        if name == column {
            return Ok(is_not_null);
        }
    }
    Ok(false)
}

fn table_has_all_columns(
    conn: &Connection,
    schema: &str,
    table: &str,
    required_columns: &[&str],
) -> Result<bool> {
    if !table_exists(conn, schema, table)? {
        return Ok(false);
    }

    for column in required_columns {
        if !table_has_column(conn, schema, table, column)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn table_has_unique_index_on_columns(
    conn: &Connection,
    schema: &str,
    table: &str,
    expected_columns: &[&str],
) -> Result<bool> {
    if !table_exists(conn, schema, table)? {
        return Ok(false);
    }

    let escaped_table = table.replace('\'', "''");
    let mut index_stmt = conn.prepare(&format!(
        "PRAGMA {}.index_list('{}')",
        schema, escaped_table
    ))?;
    let indexes = index_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)? != 0))
    })?;

    for index in indexes {
        let (index_name, is_unique) = index?;
        if !is_unique {
            continue;
        }

        let escaped_index = index_name.replace('\'', "''");
        let mut column_stmt = conn.prepare(&format!(
            "PRAGMA {}.index_info('{}')",
            schema, escaped_index
        ))?;
        let columns = column_stmt
            .query_map([], |row| row.get::<_, String>(2))?
            .collect::<Result<Vec<_>>>()?;
        if columns == expected_columns {
            return Ok(true);
        }
    }

    Ok(false)
}

fn latest_media_identity_constraints_are_present(conn: &Connection) -> Result<bool> {
    Ok(
        table_has_unique_index_on_columns(conn, "shared", "media", &["uid"])?
            && table_has_unique_index_on_columns(conn, "shared", "media", &["title", "variant"])?
            && !table_has_unique_index_on_columns(conn, "shared", "media", &["title"])?,
    )
}

fn ensure_table_has_columns(
    conn: &Connection,
    schema: &str,
    table: &str,
    required_columns: &[&str],
) -> Result<()> {
    if !table_exists(conn, schema, table)? {
        return Err(migration_error(format!(
            "Missing required table {}.{}",
            schema, table
        )));
    }

    for column in required_columns {
        if !table_has_column(conn, schema, table, column)? {
            return Err(migration_error(format!(
                "Missing required column {}.{}.{}",
                schema, table, column
            )));
        }
    }
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    schema: &str,
    table: &str,
    column: &str,
    column_definition: &str,
) -> Result<bool> {
    if table_has_column(conn, schema, table, column)? {
        return Ok(false);
    }
    conn.execute(
        &format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            schema, table, column, column_definition
        ),
        [],
    )?;
    Ok(true)
}

fn first_blank_media_title_row(conn: &Connection) -> Result<Option<i64>> {
    if !table_exists(conn, "shared", "media")?
        || !table_has_column(conn, "shared", "media", "title")?
    {
        return Ok(None);
    }

    let mut stmt = conn.prepare("SELECT id, title FROM shared.media ORDER BY id ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, title) = row?;
        if title.trim().is_empty() {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

fn validate_media_titles(conn: &Connection) -> Result<()> {
    if let Some(id) = first_blank_media_title_row(conn)? {
        return Err(migration_error(format!(
            "Media row {id} has a blank title and cannot be assigned a stable title/variant identity"
        )));
    }
    Ok(())
}

fn latest_schema_is_present(conn: &Connection) -> Result<bool> {
    Ok(
        table_has_all_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?
            && latest_media_identity_constraints_are_present(conn)?
            && first_blank_media_title_row(conn)?.is_none()
            && table_has_all_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)?
            && table_has_all_columns(conn, "main", "milestones", MILESTONE_COLUMNS)?
            && table_column_is_not_null(conn, "main", "milestones", "media_uid")?
            && table_has_all_columns(conn, "main", "settings", SETTINGS_COLUMNS)?
            && table_has_all_columns(conn, "main", "profile_picture", PROFILE_PICTURE_COLUMNS)?,
    )
}

fn validate_latest_schema(conn: &Connection) -> Result<()> {
    ensure_table_has_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?;
    if !latest_media_identity_constraints_are_present(conn)? {
        return Err(migration_error(
            "shared.media must keep uid unique and use exact (title, variant) uniqueness",
        ));
    }
    validate_media_titles(conn)?;
    ensure_table_has_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)?;
    ensure_table_has_columns(conn, "main", "milestones", MILESTONE_COLUMNS)?;
    if !table_column_is_not_null(conn, "main", "milestones", "media_uid")? {
        return Err(migration_error(
            "main.milestones.media_uid must be required in the latest schema",
        ));
    }
    validate_milestone_media_links(conn)?;
    ensure_table_has_columns(conn, "main", "settings", SETTINGS_COLUMNS)?;
    ensure_table_has_columns(conn, "main", "profile_picture", PROFILE_PICTURE_COLUMNS)?;
    Ok(())
}

fn legacy_schema_markers_present(conn: &Connection) -> Result<bool> {
    if table_exists(conn, "main", "media")? {
        return Ok(true);
    }

    let any_tables =
        schema_has_user_tables(conn, "main")? || schema_has_user_tables(conn, "shared")?;
    if !any_tables {
        return Ok(false);
    }

    if !table_has_all_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)? {
        return Ok(true);
    }
    if !latest_media_identity_constraints_are_present(conn)? {
        return Ok(true);
    }
    if first_blank_media_title_row(conn)?.is_some() {
        return Ok(true);
    }
    if !table_has_all_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)? {
        return Ok(true);
    }
    if !table_has_all_columns(conn, "main", "milestones", MILESTONE_COLUMNS)? {
        return Ok(true);
    }
    if !table_column_is_not_null(conn, "main", "milestones", "media_uid")? {
        return Ok(true);
    }
    if !table_has_all_columns(conn, "main", "settings", SETTINGS_COLUMNS)? {
        return Ok(true);
    }
    if !table_has_all_columns(conn, "main", "profile_picture", PROFILE_PICTURE_COLUMNS)? {
        return Ok(true);
    }

    Ok(false)
}

fn detect_schema_state(conn: &Connection) -> Result<SchemaState> {
    let main_version = get_schema_version(conn, "main")?;
    let shared_version = get_schema_version(conn, "shared")?;
    let main_has_tables = schema_has_user_tables(conn, "main")?;
    let shared_has_tables = schema_has_user_tables(conn, "shared")?;

    if main_version == 0 && shared_version == 0 {
        if !main_has_tables && !shared_has_tables {
            return Ok(SchemaState::Fresh);
        }
        return Ok(SchemaState::LegacyUnversioned);
    }

    if main_version == shared_version {
        return Ok(SchemaState::Versioned(main_version));
    }

    Ok(SchemaState::Mixed {
        main: main_version,
        shared: shared_version,
    })
}

fn with_migration_transaction<T, F>(conn: &Connection, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    conn.execute_batch("BEGIN IMMEDIATE")?;
    match f(conn) {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(err)
        }
    }
}

fn with_write_savepoint<T, F>(conn: &Connection, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    conn.execute_batch("SAVEPOINT kechimochi_write")?;
    match f(conn) {
        Ok(value) => {
            conn.execute_batch("RELEASE SAVEPOINT kechimochi_write")?;
            Ok(value)
        }
        Err(err) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT kechimochi_write;
                 RELEASE SAVEPOINT kechimochi_write;",
            );
            Err(err)
        }
    }
}

/// Returns the data directory for the application.
/// If KECHIMOCHI_DATA_DIR is set, uses that path (for test isolation).
/// Otherwise uses the provider's app data dir when available, and finally
/// falls back to an identifier-based platform default.
pub fn get_data_dir<P: DataDirProvider>(provider: &P) -> PathBuf {
    if let Ok(dir) = std::env::var("KECHIMOCHI_DATA_DIR") {
        PathBuf::from(dir)
    } else if let Some(dir) = provider.app_data_dir() {
        dir
    } else {
        default_data_dir_from_identifier()
    }
}

fn migrate_shared_media_columns(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "shared", "media")? {
        return Ok(());
    }

    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "description",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "cover_image",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "extra_data",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "content_type",
        "TEXT NOT NULL DEFAULT 'Unknown'",
    )?;
    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "tracking_status",
        "TEXT NOT NULL DEFAULT 'Untracked'",
    )?;
    Ok(())
}

fn create_shared_media_table_named(conn: &Connection, table_name: &str) -> Result<()> {
    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                default_activity_type TEXT NOT NULL,
                status TEXT NOT NULL,
                language TEXT NOT NULL,
                description TEXT DEFAULT '',
                cover_image TEXT DEFAULT '',
                extra_data TEXT DEFAULT '{{}}',
                content_type TEXT DEFAULT 'Unknown',
                tracking_status TEXT DEFAULT 'Untracked',
                variant TEXT NOT NULL DEFAULT '',
                UNIQUE(title, variant)
            )",
            table_name
        ),
        [],
    )?;
    Ok(())
}

fn read_shared_media_rows(conn: &Connection) -> Result<Vec<SharedMediaRow>> {
    let activity_type_column =
        if table_has_column(conn, "shared", "media", "default_activity_type")? {
            "default_activity_type"
        } else {
            "media_type"
        };
    let mut stmt = conn.prepare(&format!(
        "SELECT id, title, {activity_type_column}, status, language,
                COALESCE(description, ''),
                COALESCE(cover_image, ''),
                COALESCE(extra_data, '{{}}'),
                COALESCE(content_type, 'Unknown'),
                COALESCE(tracking_status, 'Untracked')
         FROM shared.media
         ORDER BY id ASC"
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok(SharedMediaRow {
            id: row.get(0)?,
            title: row.get(1)?,
            default_activity_type: row.get(2)?,
            status: row.get(3)?,
            language: row.get(4)?,
            description: row.get(5)?,
            cover_image: row.get(6)?,
            extra_data: row.get(7)?,
            content_type: row.get(8)?,
            tracking_status: row.get(9)?,
        })
    })?;

    let mut collected = Vec::new();
    for row in rows {
        collected.push(row?);
    }
    Ok(collected)
}

fn recreate_shared_media_table_with_uids(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "shared", "media")? || table_has_column(conn, "shared", "media", "uid")?
    {
        return Ok(());
    }

    let rows = read_shared_media_rows(conn)?;
    create_shared_media_table_named(conn, "shared.media_new")?;

    for row in &rows {
        conn.execute(
            "INSERT INTO shared.media_new (
                id, uid, title, default_activity_type, status, language,
                description, cover_image, extra_data, content_type, tracking_status
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                row.id,
                generate_deterministic_media_uid(&row.title)?,
                row.title,
                row.default_activity_type,
                row.status,
                row.language,
                row.description,
                row.cover_image,
                row.extra_data,
                row.content_type,
                row.tracking_status,
            ],
        )?;
    }

    conn.execute("DROP TABLE shared.media", [])?;
    conn.execute("ALTER TABLE shared.media_new RENAME TO media", [])?;
    Ok(())
}

fn migrate_shared_media_uid_foundation(conn: &Connection) -> Result<()> {
    migrate_shared_media_columns(conn)?;
    recreate_shared_media_table_with_uids(conn)?;
    Ok(())
}

fn backfill_milestone_media_uid(conn: &Connection) -> Result<()> {
    if !schema_is_attached(conn, "shared")? {
        return Ok(());
    }

    if !table_exists(conn, "main", "milestones")?
        || !table_has_column(conn, "main", "milestones", "media_uid")?
        || !table_exists(conn, "shared", "media")?
        || !table_has_column(conn, "shared", "media", "uid")?
    {
        return Ok(());
    }

    conn.execute(
        "UPDATE main.milestones
         SET media_uid = (
             SELECT uid FROM shared.media
             WHERE title = main.milestones.media_title
         )
         WHERE media_uid IS NULL OR media_uid = ''",
        [],
    )?;
    Ok(())
}

fn validate_milestone_media_links(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "main", "milestones")?
        || !table_has_column(conn, "main", "milestones", "media_uid")?
        || !table_exists(conn, "shared", "media")?
        || !table_has_column(conn, "shared", "media", "uid")?
    {
        return Ok(());
    }

    let unresolved: Option<(String, String)> = conn
        .query_row(
            "SELECT ms.media_title, ms.name
             FROM main.milestones ms
             LEFT JOIN shared.media m ON m.uid = ms.media_uid
             WHERE TRIM(COALESCE(ms.media_uid, '')) = '' OR m.uid IS NULL
             ORDER BY ms.id ASC
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((media_title, milestone_name)) = unresolved {
        return Err(migration_error(format!(
            "Milestone '{milestone_name}' for media '{media_title}' is not linked to an existing media UID"
        )));
    }
    Ok(())
}

fn migrate_milestones_to_required_media_uid(conn: &Connection) -> Result<()> {
    ensure_table_has_columns(conn, "main", "milestones", MILESTONE_COLUMNS)?;
    ensure_table_has_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?;

    // Versions before v6 accepted title-only milestone writes. Repair those links
    // while media titles are still unique. A missing or stale UID is replaced only
    // when the display title has exactly one match; ambiguous/orphan rows abort the
    // migration instead of being guessed, dropped, or attached to the wrong variant.
    conn.execute(
        "UPDATE main.milestones
         SET media_uid = (
             SELECT m.uid FROM shared.media m
             WHERE m.title = main.milestones.media_title
         )
         WHERE (
             TRIM(COALESCE(media_uid, '')) = ''
             OR NOT EXISTS (
                 SELECT 1 FROM shared.media current_media
                 WHERE current_media.uid = main.milestones.media_uid
             )
         )
         AND 1 = (
             SELECT COUNT(*) FROM shared.media title_match
             WHERE title_match.title = main.milestones.media_title
         )",
        [],
    )?;
    validate_milestone_media_links(conn)?;

    // The title is denormalized display data. Once the UID is trustworthy, make
    // the linked media row authoritative before rebuilding the stricter table.
    conn.execute(
        "UPDATE main.milestones
         SET media_title = (
             SELECT m.title FROM shared.media m
             WHERE m.uid = main.milestones.media_uid
         )",
        [],
    )?;

    conn.execute("DROP TABLE IF EXISTS main.milestones_v6_new", [])?;
    create_milestones_table_named(conn, "main.milestones_v6_new")?;
    conn.execute(
        "INSERT INTO main.milestones_v6_new (
             id, media_uid, media_title, name, duration, characters, date
         )
         SELECT id, media_uid, media_title, name, duration, characters, date
         FROM main.milestones
         ORDER BY id ASC",
        [],
    )?;
    conn.execute("DROP TABLE main.milestones", [])?;
    conn.execute(
        "ALTER TABLE main.milestones_v6_new RENAME TO milestones",
        [],
    )?;
    Ok(())
}

fn migrate_settings_updated_at(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "main", "settings")? {
        return Ok(());
    }

    let added = add_column_if_missing(
        conn,
        "main",
        "settings",
        "updated_at",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    if added || table_has_column(conn, "main", "settings", "updated_at")? {
        let timestamp = utc_now_rfc3339();
        conn.execute(
            "UPDATE main.settings
             SET updated_at = ?1
             WHERE updated_at IS NULL OR updated_at = ''",
            params![timestamp],
        )?;
    }
    Ok(())
}

fn migrate_v1_to_v2_add_sync_foundation(conn: &Connection) -> Result<()> {
    migrate_shared_media_uid_foundation(conn)?;
    let _ = add_column_if_missing(conn, "main", "milestones", "media_uid", "TEXT")?;
    backfill_milestone_media_uid(conn)?;
    migrate_settings_updated_at(conn)?;
    Ok(())
}

fn migrate_v2_to_v3_add_activity_notes(conn: &Connection) -> Result<()> {
    let _ = add_column_if_missing(
        conn,
        "main",
        "activity_logs",
        "notes",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

fn migrate_v3_to_v4_add_media_variant(conn: &Connection) -> Result<()> {
    let _ = add_column_if_missing(
        conn,
        "shared",
        "media",
        "variant",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

fn migrate_v4_to_v5_rename_default_activity_type(conn: &Connection) -> Result<()> {
    let has_legacy_column = table_has_column(conn, "shared", "media", "media_type")?;
    let has_canonical_column = table_has_column(conn, "shared", "media", "default_activity_type")?;

    let default_column = match (has_legacy_column, has_canonical_column) {
        (true, false) => "media_type",
        (false, true) => "default_activity_type",
        (true, true) => {
            return Err(migration_error(
                "shared.media contains both media_type and default_activity_type",
            ));
        }
        (false, false) => {
            return Err(migration_error(
                "shared.media is missing its default activity type column",
            ));
        }
    };

    conn.execute(
        &format!(
            "UPDATE shared.media
             SET {default_column} = 'None'
             WHERE TRIM(COALESCE({default_column}, '')) = ''"
        ),
        [],
    )?;

    conn.execute(
        &format!(
            "UPDATE main.activity_logs
             SET activity_type = COALESCE(
                 (SELECT {default_column}
                  FROM shared.media
                  WHERE id = activity_logs.media_id),
                 'None'
             )
             WHERE TRIM(COALESCE(activity_type, '')) = ''"
        ),
        [],
    )?;

    let remaining_blank_logs: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM main.activity_logs
         WHERE TRIM(COALESCE(activity_type, '')) = ''",
        [],
        |row| row.get(0),
    )?;
    if remaining_blank_logs > 0 {
        return Err(migration_error(format!(
            "Could not materialize activity type for {remaining_blank_logs} log(s)"
        )));
    }

    if has_legacy_column {
        conn.execute(
            "ALTER TABLE shared.media
             RENAME COLUMN media_type TO default_activity_type",
            [],
        )?;
    }

    Ok(())
}

fn normalize_legacy_media_variants(conn: &Connection) -> Result<()> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, title, COALESCE(variant, '')
             FROM shared.media
             ORDER BY id ASC",
        )?;
        let collected = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;
        collected
    };

    let mut identities: HashMap<(String, String), i64> = HashMap::new();
    let mut normalized_variants = Vec::new();
    for (id, title, variant) in rows {
        let normalized_variant = variant.trim().to_string();
        if let Some(existing_id) =
            identities.insert((title.clone(), normalized_variant.clone()), id)
        {
            let variant_label = if normalized_variant.is_empty() {
                "(no variant)"
            } else {
                normalized_variant.as_str()
            };
            return Err(migration_error(format!(
                "Cannot normalize legacy media variants because media rows {existing_id} and {id} both use title '{title}' with variant '{variant_label}' after trimming"
            )));
        }
        if normalized_variant != variant {
            normalized_variants.push((id, normalized_variant));
        }
    }

    for (id, variant) in normalized_variants {
        conn.execute(
            "UPDATE shared.media SET variant = ?1 WHERE id = ?2",
            params![variant, id],
        )?;
    }
    Ok(())
}

fn migrate_v5_to_v6_use_media_title_variant_identity(conn: &Connection) -> Result<()> {
    ensure_table_has_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?;

    validate_media_titles(conn)?;
    normalize_legacy_media_variants(conn)?;
    migrate_milestones_to_required_media_uid(conn)?;

    conn.execute("DROP TABLE IF EXISTS shared.media_v6_new", [])?;
    create_shared_media_table_named(conn, "shared.media_v6_new")?;
    conn.execute(
        "INSERT INTO shared.media_v6_new (
             id, uid, title, default_activity_type, status, language, description,
             cover_image, extra_data, content_type, tracking_status, variant
         )
         SELECT id, uid, title, default_activity_type, status, language, description,
                cover_image, extra_data, content_type, tracking_status, variant
         FROM shared.media
         ORDER BY id ASC",
        [],
    )?;
    conn.execute("DROP TABLE shared.media", [])?;
    conn.execute("ALTER TABLE shared.media_v6_new RENAME TO media", [])?;
    Ok(())
}

fn migrate_to_shared(conn: &Connection) -> Result<()> {
    // Check if `main.media` exists
    if table_exists(conn, "main", "media")? {
        create_shared_media_table(conn)?;

        let legacy_has_description = table_has_column(conn, "main", "media", "description")?;
        let legacy_has_cover_image = table_has_column(conn, "main", "media", "cover_image")?;
        let legacy_has_extra_data = table_has_column(conn, "main", "media", "extra_data")?;
        let legacy_has_content_type = table_has_column(conn, "main", "media", "content_type")?;
        let mut stmt = conn.prepare(&format!(
            "SELECT id, title, media_type, status, language,
                    COALESCE({}, ''),
                    COALESCE({}, ''),
                    COALESCE({}, '{{}}'),
                    COALESCE({}, 'Unknown')
             FROM main.media
             ORDER BY id ASC",
            if legacy_has_description {
                "description"
            } else {
                "''"
            },
            if legacy_has_cover_image {
                "cover_image"
            } else {
                "''"
            },
            if legacy_has_extra_data {
                "extra_data"
            } else {
                "'{}'"
            },
            if legacy_has_content_type {
                "content_type"
            } else {
                "'Unknown'"
            }
        ))?;
        let legacy_media = stmt.query_map([], |row| {
            Ok(SharedMediaRow {
                id: row.get(0)?,
                title: row.get(1)?,
                default_activity_type: row.get(2)?,
                status: row.get(3)?,
                language: row.get(4)?,
                description: row.get(5)?,
                cover_image: row.get(6)?,
                extra_data: row.get(7)?,
                content_type: row.get(8)?,
                tracking_status: "Untracked".to_string(),
            })
        })?;

        let mut collected_legacy_media = Vec::new();
        for media in legacy_media {
            collected_legacy_media.push(media?);
        }

        for media in &collected_legacy_media {
            conn.execute(
                "INSERT OR IGNORE INTO shared.media (
                    id, uid, title, default_activity_type, status, language,
                    description, cover_image, extra_data, content_type, tracking_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    media.id,
                    generate_deterministic_media_uid(&media.title)?,
                    media.title,
                    media.default_activity_type,
                    media.status,
                    media.language,
                    media.description,
                    media.cover_image,
                    media.extra_data,
                    media.content_type,
                    media.tracking_status,
                ],
            )?;
        }

        let missing_media_rows: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM main.media m
             LEFT JOIN shared.media s ON s.id = m.id
             WHERE s.id IS NULL",
            [],
            |row| row.get(0),
        )?;
        if missing_media_rows > 0 {
            return Err(migration_error(format!(
                "Legacy media migration could not copy {} row(s) into shared.media",
                missing_media_rows
            )));
        }

        // Before dropping main.media, recreate activity_logs without the FOREIGN KEY
        if table_exists(conn, "main", "activity_logs")? {
            let had_characters = table_has_column(conn, "main", "activity_logs", "characters")?;
            let had_activity_type =
                table_has_column(conn, "main", "activity_logs", "activity_type")?;
            conn.execute(
                "ALTER TABLE main.activity_logs RENAME TO activity_logs_old",
                [],
            )?;
            create_activity_logs_table(conn)?;
            let characters_expr = if had_characters { "characters" } else { "0" };
            let activity_type_expr = if had_activity_type {
                "activity_type"
            } else {
                "''"
            };
            conn.execute(
               &format!(
                   "INSERT INTO main.activity_logs (id, media_id, duration_minutes, characters, date, activity_type)
                    SELECT id, media_id, duration_minutes, {}, date, {}
                    FROM main.activity_logs_old",
                   characters_expr, activity_type_expr
               ),
               [],
           )?;
            conn.execute("DROP TABLE main.activity_logs_old", [])?;
        }

        // Now drop main.media
        conn.execute("DROP TABLE main.media", [])?;
    }
    Ok(())
}

fn create_shared_media_table(conn: &Connection) -> Result<()> {
    create_shared_media_table_named(conn, "shared.media")
}

fn create_activity_logs_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT NOT NULL,
            activity_type TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT ''
        )",
        [],
    )?;
    Ok(())
}

fn create_milestones_table_named(conn: &Connection, table_name: &str) -> Result<()> {
    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_uid TEXT NOT NULL,
            media_title TEXT NOT NULL,
            name TEXT NOT NULL,
            duration INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT
        )",
            table_name
        ),
        [],
    )?;
    Ok(())
}

fn create_milestones_table(conn: &Connection) -> Result<()> {
    create_milestones_table_named(conn, "main.milestones")
}

fn migrate_milestones(conn: &Connection) -> Result<()> {
    let _ = add_column_if_missing(conn, "main", "milestones", "media_uid", "TEXT")?;
    let _ = add_column_if_missing(
        conn,
        "main",
        "milestones",
        "media_title",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let _ = add_column_if_missing(
        conn,
        "main",
        "milestones",
        "name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let _ = add_column_if_missing(
        conn,
        "main",
        "milestones",
        "duration",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    let _ = add_column_if_missing(
        conn,
        "main",
        "milestones",
        "characters",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    let _ = add_column_if_missing(conn, "main", "milestones", "date", "TEXT")?;
    backfill_milestone_media_uid(conn)?;
    Ok(())
}

fn migrate_to_character_tracking(conn: &Connection) -> Result<()> {
    let _ = add_column_if_missing(
        conn,
        "main",
        "activity_logs",
        "characters",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
}

fn migrate_activity_type_to_logs(conn: &Connection) -> Result<()> {
    let added = add_column_if_missing(
        conn,
        "main",
        "activity_logs",
        "activity_type",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    if added {
        let default_column = if table_has_column(conn, "shared", "media", "default_activity_type")?
        {
            "default_activity_type"
        } else {
            "media_type"
        };
        conn.execute(
            &format!(
                "UPDATE main.activity_logs SET activity_type = (
                    SELECT {default_column} FROM shared.media WHERE id = activity_logs.media_id
                ) WHERE activity_type = ''"
            ),
            [],
        )?;
    }
    Ok(())
}

fn create_settings_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

fn create_profile_picture_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.profile_picture (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mime_type TEXT NOT NULL,
            base64_data TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

fn reject_unsupported_future_schema(conn: &Connection) -> Result<()> {
    let main_version = get_schema_version(conn, "main")?;
    let shared_version = get_schema_version(conn, "shared")?;
    if main_version > CURRENT_SCHEMA_VERSION || shared_version > CURRENT_SCHEMA_VERSION {
        return Err(migration_error(format!(
            "Database schema versions are newer than this app supports (main={}, shared={}, supported={})",
            main_version, shared_version, CURRENT_SCHEMA_VERSION
        )));
    }
    Ok(())
}

fn reject_unsupported_future_schema_file(
    path: &std::path::Path,
    database_label: &str,
) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    // Check every existing bundle member read-only before SQLite is allowed to
    // create a missing companion file (or before legacy-profile fallback files
    // are copied into their canonical location).
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version = get_schema_version(&conn, "main")?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(migration_error(format!(
            "{database_label} database schema version {version} is newer than this app supports ({CURRENT_SCHEMA_VERSION})"
        )));
    }
    Ok(())
}

fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -20000;
         PRAGMA main.journal_mode = WAL;
         PRAGMA main.synchronous = NORMAL;
         PRAGMA shared.journal_mode = WAL;
         PRAGMA shared.synchronous = NORMAL;",
    )?;
    Ok(())
}

fn create_indexes(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_activity_logs_date_id
         ON activity_logs(date DESC, id DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_activity_logs_media_id_date_id
         ON activity_logs(media_id, date DESC, id DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_milestones_media_title_id
         ON milestones(media_title, id ASC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_milestones_media_uid_id
         ON milestones(media_uid, id ASC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS shared.idx_shared_media_status_tracking_id
         ON media(status, tracking_status, id DESC)",
        [],
    )?;
    Ok(())
}

pub fn create_tables(conn: &Connection) -> Result<()> {
    create_shared_media_table(conn)?;
    create_activity_logs_table(conn)?;
    create_milestones_table(conn)?;
    create_settings_table(conn)?;
    create_profile_picture_table(conn)?;
    Ok(())
}

fn create_latest_schema(conn: &Connection) -> Result<()> {
    create_tables(conn)?;
    create_indexes(conn)?;
    Ok(())
}

fn migrate_legacy_pre_release_to_current_schema(conn: &Connection) -> Result<()> {
    create_tables(conn)?;
    migrate_to_shared(conn)?;
    migrate_v1_to_v2_add_sync_foundation(conn)?;
    migrate_milestones(conn)?;
    migrate_to_character_tracking(conn)?;
    migrate_activity_type_to_logs(conn)?;
    migrate_settings_updated_at(conn)?;
    migrate_v2_to_v3_add_activity_notes(conn)?;
    migrate_v3_to_v4_add_media_variant(conn)?;
    migrate_v4_to_v5_rename_default_activity_type(conn)?;
    migrate_v5_to_v6_use_media_title_variant_identity(conn)?;
    create_indexes(conn)?;
    Ok(())
}

fn run_versioned_migrations(conn: &Connection, from_version: i64) -> Result<()> {
    let mut version = from_version;

    while version < CURRENT_SCHEMA_VERSION {
        let migration = VERSIONED_MIGRATIONS
            .iter()
            .find(|candidate| candidate.from == version)
            .ok_or_else(|| {
                migration_error(format!(
                    "Missing database migration from version {} to {}",
                    version,
                    version + 1
                ))
            })?;

        if migration.to != version + 1 {
            return Err(migration_error(format!(
                "Invalid migration registry entry from {} to {}",
                migration.from, migration.to
            )));
        }

        with_migration_transaction(conn, |conn| {
            (migration.apply)(conn)?;
            set_bundle_schema_version(conn, migration.to)
        })?;
        version = migration.to;
    }

    Ok(())
}

fn migrate_schema(conn: &Connection) -> Result<()> {
    match detect_schema_state(conn)? {
        SchemaState::Fresh => {
            with_migration_transaction(conn, |conn| {
                create_latest_schema(conn)?;
                set_bundle_schema_version(conn, CURRENT_SCHEMA_VERSION)
            })?;
        }
        SchemaState::LegacyUnversioned => {
            with_migration_transaction(conn, |conn| {
                migrate_legacy_pre_release_to_current_schema(conn)?;
                set_bundle_schema_version(conn, CURRENT_SCHEMA_VERSION)
            })?;
        }
        SchemaState::Versioned(version) => {
            if version > CURRENT_SCHEMA_VERSION {
                return Err(migration_error(format!(
                    "Database schema version {} is newer than this app supports ({})",
                    version, CURRENT_SCHEMA_VERSION
                )));
            }
            run_versioned_migrations(conn, version)?;
        }
        SchemaState::Mixed { main, shared } => {
            if main > CURRENT_SCHEMA_VERSION || shared > CURRENT_SCHEMA_VERSION {
                return Err(migration_error(format!(
                    "Database schema versions are newer than this app supports (main={}, shared={}, supported={})",
                    main, shared, CURRENT_SCHEMA_VERSION
                )));
            }

            if legacy_schema_markers_present(conn)? {
                with_migration_transaction(conn, |conn| {
                    migrate_legacy_pre_release_to_current_schema(conn)?;
                    set_bundle_schema_version(conn, CURRENT_SCHEMA_VERSION)
                })?;
            } else if latest_schema_is_present(conn)? {
                with_migration_transaction(conn, |conn| {
                    set_bundle_schema_version(conn, CURRENT_SCHEMA_VERSION)
                })?;
            } else {
                return Err(migration_error(format!(
                    "Database schema versions are inconsistent (main={}, shared={})",
                    main, shared
                )));
            }
        }
    }

    create_indexes(conn)?;
    validate_latest_schema(conn)?;
    Ok(())
}

pub fn init_db(app_dir: std::path::PathBuf, fallback_username: Option<&str>) -> Result<Connection> {
    fs::create_dir_all(&app_dir).expect("Failed to create app data dir");

    let shared_db_path = app_dir.join("kechimochi_shared_media.db");
    let user_db_path = app_dir.join("kechimochi_user.db");

    reject_unsupported_future_schema_file(&user_db_path, "Main")?;
    reject_unsupported_future_schema_file(&shared_db_path, "Shared")?;

    if !user_db_path.exists() {
        if let Some(username) = fallback_username {
            let fallback_path = app_dir.join(format!("kechimochi_{}.db", username));
            if fallback_path.exists() {
                reject_unsupported_future_schema_file(&fallback_path, "Fallback main")?;
                let _ = fs::copy(&fallback_path, &user_db_path);

                let fallback_wal = app_dir.join(format!("kechimochi_{}.db-wal", username));
                let user_wal = app_dir.join("kechimochi_user.db-wal");
                if fallback_wal.exists() {
                    let _ = fs::copy(&fallback_wal, &user_wal);
                }

                let fallback_shm = app_dir.join(format!("kechimochi_{}.db-shm", username));
                let user_shm = app_dir.join("kechimochi_user.db-shm");
                if fallback_shm.exists() {
                    let _ = fs::copy(&fallback_shm, &user_shm);
                }
            }
        }
    }

    let conn = Connection::open(user_db_path)?;

    // Attach shared database
    conn.execute(
        "ATTACH DATABASE ?1 AS shared",
        rusqlite::params![shared_db_path.to_string_lossy()],
    )?;

    // WAL mode is persistent. Reject a future schema before applying any
    // connection pragmas so an older app cannot alter newer database files.
    reject_unsupported_future_schema(&conn)?;
    apply_pragmas(&conn)?;

    migrate_schema(&conn)?;

    Ok(conn)
}

pub fn wipe_everything(app_dir: std::path::PathBuf) -> std::result::Result<(), String> {
    // Delete covers dir
    let covers_dir = app_dir.join("covers");
    if covers_dir.exists() {
        let _ = std::fs::remove_dir_all(&covers_dir);
    }

    // Delete all DBs
    if let Ok(entries) = std::fs::read_dir(&app_dir) {
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "db" {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }

    Ok(())
}

fn get_media_title_by_uid(conn: &Connection, uid: &str) -> Result<Option<String>> {
    if !schema_is_attached(conn, "shared")? || !table_exists(conn, "shared", "media")? {
        return Ok(None);
    }
    conn.query_row(
        "SELECT title FROM shared.media WHERE uid = ?1",
        params![uid],
        |row| row.get(0),
    )
    .optional()
}

fn resolve_milestone_media_identity(
    conn: &Connection,
    milestone: &Milestone,
) -> Result<(String, String)> {
    let media_uid = normalize_optional_string(milestone.media_uid.clone())
        .ok_or_else(|| migration_error("Milestone must specify a media_uid"))?;
    let media_title = get_media_title_by_uid(conn, &media_uid)?
        .ok_or_else(|| migration_error(format!("Media with uid '{media_uid}' was not found")))?;
    Ok((media_title, media_uid))
}

fn media_identity_collision_error(title: &str, variant: &str) -> rusqlite::Error {
    let variant = if variant.is_empty() {
        "(no variant)"
    } else {
        variant
    };
    migration_error(format!(
        "Another media entry already uses title '{title}' with variant '{variant}'"
    ))
}

fn ensure_media_identity_available(
    conn: &Connection,
    title: &str,
    variant: &str,
    excluding_media_id: Option<i64>,
) -> Result<()> {
    let collision = conn
        .query_row(
            "SELECT id
             FROM shared.media
             WHERE title = ?1
               AND variant = ?2
               AND (?3 IS NULL OR id != ?3)
             LIMIT 1",
            params![title, variant, excluding_media_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if collision.is_some() {
        return Err(media_identity_collision_error(title, variant));
    }
    Ok(())
}

// Media Operations
pub fn get_all_media(conn: &Connection) -> Result<Vec<Media>> {
    let mut stmt = conn.prepare(
        "SELECT id, uid, title, default_activity_type, status, language, description, cover_image, extra_data, content_type, tracking_status, variant
         FROM shared.media m
         ORDER BY
            (SELECT MAX(date) FROM main.activity_logs WHERE media_id = m.id) DESC,
            m.id DESC"
    )?;
    let media_iter = stmt.query_map([], |row| {
        Ok(Media {
            id: row.get(0)?,
            uid: row.get(1)?,
            title: row.get(2)?,
            default_activity_type: row.get(3)?,
            status: row.get(4)?,
            language: row.get(5)?,
            description: row.get(6).unwrap_or_default(),
            cover_image: row.get(7).unwrap_or_default(),
            extra_data: row.get(8).unwrap_or_else(|_| "{}".to_string()),
            content_type: row.get(9).unwrap_or_else(|_| "Unknown".to_string()),
            tracking_status: row.get(10).unwrap_or_else(|_| "Untracked".to_string()),
            variant: row.get(11).unwrap_or_default(),
        })
    })?;

    let mut media_list = Vec::new();
    for media in media_iter {
        media_list.push(media?);
    }
    Ok(media_list)
}

pub fn add_media_with_id(conn: &Connection, media: &Media) -> Result<i64> {
    if media.title.trim().is_empty() {
        return Err(migration_error("Media title cannot be blank"));
    }
    let uid =
        normalize_optional_string(media.uid.clone()).unwrap_or_else(generate_random_media_uid);
    let default_activity_type = media.default_activity_type.trim();
    if default_activity_type.is_empty() {
        return Err(migration_error("Default activity type cannot be blank"));
    }
    let variant = media.variant.trim();
    ensure_media_identity_available(conn, &media.title, variant, None)?;
    conn.execute(
        "INSERT INTO shared.media (uid, title, default_activity_type, status, language, description, cover_image, extra_data, content_type, tracking_status, variant) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![uid, media.title, default_activity_type, media.status, media.language, media.description, media.cover_image, media.extra_data, media.content_type, media.tracking_status, variant],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_media(conn: &Connection, media: &Media) -> Result<()> {
    if media.title.trim().is_empty() {
        return Err(migration_error("Media title cannot be blank"));
    }
    let media_id = media
        .id
        .ok_or_else(|| migration_error("Media update requires an id"))?;
    let existing_uid = conn
        .query_row(
            "SELECT uid FROM shared.media WHERE id = ?1",
            params![media_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| migration_error(format!("Media {} not found", media_id)))?;
    if let Some(requested_uid) = normalize_optional_string(media.uid.clone()) {
        if requested_uid != existing_uid {
            return Err(migration_error("A media UID cannot be changed"));
        }
    }
    let default_activity_type = media.default_activity_type.trim();
    if default_activity_type.is_empty() {
        return Err(migration_error("Default activity type cannot be blank"));
    }
    let variant = media.variant.trim();
    ensure_media_identity_available(conn, &media.title, variant, Some(media_id))?;

    with_write_savepoint(conn, |conn| {
        conn.execute(
            "UPDATE shared.media
             SET title = ?1, default_activity_type = ?2, status = ?3, language = ?4,
                 description = ?5, cover_image = ?6, extra_data = ?7, content_type = ?8,
                 tracking_status = ?9, variant = ?10
             WHERE id = ?11",
            params![
                media.title,
                default_activity_type,
                media.status,
                media.language,
                media.description,
                media.cover_image,
                media.extra_data,
                media.content_type,
                media.tracking_status,
                variant,
                media_id
            ],
        )?;

        conn.execute(
            "UPDATE main.milestones
             SET media_title = ?1
             WHERE media_uid = ?2",
            params![media.title, existing_uid],
        )?;
        Ok(())
    })
}

pub fn delete_media(conn: &Connection, id: i64) -> Result<()> {
    if let Some((cover_image, uid)) = conn
        .query_row(
            "SELECT cover_image, uid FROM shared.media WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    {
        conn.execute(
            "DELETE FROM main.milestones WHERE media_uid = ?1",
            params![uid],
        )?;

        remove_cover_file_if_unreferenced(conn, std::path::Path::new(&cover_image), Some(id))?;
    }

    // Also delete associated logs in the local main DB
    conn.execute(
        "DELETE FROM main.activity_logs WHERE media_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM shared.media WHERE id = ?1", params![id])?;
    Ok(())
}

// Activity Log Operations
fn resolve_activity_type_for_write(
    conn: &Connection,
    media_id: i64,
    activity_type: &str,
) -> Result<String> {
    let activity_type = activity_type.trim();
    if !activity_type.is_empty() {
        return Ok(activity_type.to_string());
    }

    let default_activity_type = conn
        .query_row(
            "SELECT default_activity_type FROM shared.media WHERE id = ?1",
            params![media_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| migration_error(format!("Media {media_id} not found")))?;
    let default_activity_type = default_activity_type.trim();
    if default_activity_type.is_empty() {
        return Err(migration_error(format!(
            "Media {media_id} has a blank default activity type"
        )));
    }

    Ok(default_activity_type.to_string())
}

fn invalid_activity_input(message: &'static str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    )))
}

pub fn validate_activity_metrics(duration_minutes: i64, characters: i64) -> Result<()> {
    if duration_minutes < 0 {
        return Err(invalid_activity_input(
            "Activity duration cannot be negative",
        ));
    }
    if characters < 0 {
        return Err(invalid_activity_input(
            "Activity character count cannot be negative",
        ));
    }
    if duration_minutes == 0 && characters == 0 {
        return Err(invalid_activity_input(
            "Activity must have either duration or characters",
        ));
    }
    Ok(())
}

pub fn add_log(conn: &Connection, log: &ActivityLog) -> Result<i64> {
    validate_activity_metrics(log.duration_minutes, log.characters)?;
    let activity_type = resolve_activity_type_for_write(conn, log.media_id, &log.activity_type)?;
    conn.execute(
        "INSERT INTO main.activity_logs (media_id, duration_minutes, characters, date, activity_type, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![log.media_id, log.duration_minutes, log.characters, log.date, activity_type, log.notes],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_log(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_log(conn: &Connection, log: &ActivityLog) -> Result<()> {
    validate_activity_metrics(log.duration_minutes, log.characters)?;
    let activity_type = resolve_activity_type_for_write(conn, log.media_id, &log.activity_type)?;
    conn.execute(
        "UPDATE main.activity_logs SET media_id = ?1, duration_minutes = ?2, characters = ?3, date = ?4, activity_type = ?5, notes = ?6 WHERE id = ?7",
        params![log.media_id, log.duration_minutes, log.characters, log.date, activity_type, log.notes, log.id.unwrap()],
    )?;
    Ok(())
}

pub fn clear_activities(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs", [])?;
    Ok(())
}

pub fn get_logs(conn: &Connection) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, a.activity_type, a.duration_minutes, a.characters, a.date, m.language, a.notes
         FROM main.activity_logs a
         JOIN shared.media m ON a.media_id = m.id
         ORDER BY a.date DESC, a.id DESC",
    )?;
    let logs_iter = stmt.query_map([], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            activity_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
            notes: row.get(8)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_logs_for_media(conn: &Connection, media_id: i64) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, a.activity_type, a.duration_minutes, a.characters, a.date, m.language, a.notes
         FROM main.activity_logs a
         JOIN shared.media m ON a.media_id = m.id
         WHERE a.media_id = ?1
         ORDER BY a.date DESC, a.id DESC",
    )?;
    let logs_iter = stmt.query_map(params![media_id], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            activity_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
            notes: row.get(8)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_heatmap(conn: &Connection) -> Result<Vec<DailyHeatmap>> {
    let mut stmt = conn.prepare(
        "SELECT date, SUM(duration_minutes) as total_minutes, SUM(characters) as total_characters
         FROM main.activity_logs 
         GROUP BY date 
         ORDER BY date ASC",
    )?;
    let heatmap_iter = stmt.query_map([], |row| {
        Ok(DailyHeatmap {
            date: row.get(0)?,
            total_minutes: row.get(1)?,
            total_characters: row.get(2)?,
        })
    })?;

    let mut heatmap_list = Vec::new();
    for hm in heatmap_iter {
        heatmap_list.push(hm?);
    }
    Ok(heatmap_list)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let updated_at = utc_now_rfc3339();
    conn.execute(
        "INSERT INTO main.settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
        params![key, value, updated_at],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM main.settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn get_profile_picture(conn: &Connection) -> Result<Option<ProfilePicture>> {
    let mut stmt = conn.prepare(
        "SELECT mime_type, base64_data, byte_size, width, height, updated_at
         FROM main.profile_picture
         WHERE id = 1",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        Ok(Some(ProfilePicture {
            mime_type: row.get(0)?,
            base64_data: row.get(1)?,
            byte_size: row.get(2)?,
            width: row.get(3)?,
            height: row.get(4)?,
            updated_at: row.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn upsert_profile_picture(conn: &Connection, profile_picture: &ProfilePicture) -> Result<()> {
    conn.execute(
        "INSERT INTO main.profile_picture (id, mime_type, base64_data, byte_size, width, height, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            mime_type = excluded.mime_type,
            base64_data = excluded.base64_data,
            byte_size = excluded.byte_size,
            width = excluded.width,
            height = excluded.height,
            updated_at = excluded.updated_at",
        params![
            profile_picture.mime_type,
            profile_picture.base64_data,
            profile_picture.byte_size,
            profile_picture.width,
            profile_picture.height,
            profile_picture.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_profile_picture(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM main.profile_picture WHERE id = 1", [])?;
    Ok(())
}

// Milestone Operations
pub fn get_milestones_for_media_uid(conn: &Connection, media_uid: &str) -> Result<Vec<Milestone>> {
    let mut stmt = conn.prepare(
        "SELECT ms.id,
                ms.media_uid,
                COALESCE(m.title, ms.media_title),
                ms.name,
                ms.duration,
                ms.characters,
                ms.date
         FROM main.milestones ms
         LEFT JOIN shared.media m ON ms.media_uid = m.uid
         WHERE ms.media_uid = ?1
         ORDER BY ms.id ASC",
    )?;
    let milestone_iter = stmt.query_map(params![media_uid], |row| {
        Ok(Milestone {
            id: row.get(0)?,
            media_uid: row.get(1)?,
            media_title: row.get(2)?,
            name: row.get(3)?,
            duration: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
        })
    })?;

    let mut milestone_list = Vec::new();
    for milestone in milestone_iter {
        milestone_list.push(milestone?);
    }
    Ok(milestone_list)
}

pub fn get_all_milestones(conn: &Connection) -> Result<Vec<Milestone>> {
    let mut stmt = conn.prepare(
        "SELECT ms.id,
                ms.media_uid,
                COALESCE(m.title, ms.media_title),
                ms.name,
                ms.duration,
                ms.characters,
                ms.date
         FROM main.milestones ms
         LEFT JOIN shared.media m ON ms.media_uid = m.uid
         ORDER BY ms.date DESC, ms.id ASC",
    )?;
    let milestone_iter = stmt.query_map([], |row| {
        Ok(Milestone {
            id: row.get(0)?,
            media_uid: row.get(1)?,
            media_title: row.get(2)?,
            name: row.get(3)?,
            duration: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
        })
    })?;

    let mut milestone_list = Vec::new();
    for milestone in milestone_iter {
        milestone_list.push(milestone?);
    }
    Ok(milestone_list)
}

pub fn get_timeline_events(conn: &Connection) -> Result<Vec<TimelineEvent>> {
    crate::timeline_data::get_all_timeline_events(conn)
}

pub fn add_milestone(conn: &Connection, milestone: &Milestone) -> Result<i64> {
    if milestone.duration == 0 && milestone.characters == 0 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Milestone must have either duration or characters",
            ),
        )));
    }
    let (media_title, media_uid) = resolve_milestone_media_identity(conn, milestone)?;
    conn.execute(
        "INSERT INTO main.milestones (media_uid, media_title, name, duration, characters, date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![media_uid, media_title, milestone.name, milestone.duration, milestone.characters, milestone.date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_milestone(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.milestones WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_milestones_for_media_uid(conn: &Connection, media_uid: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM main.milestones WHERE media_uid = ?1",
        params![media_uid],
    )?;
    Ok(())
}

pub fn update_milestone(conn: &Connection, milestone: &Milestone) -> Result<()> {
    let milestone_id = milestone
        .id
        .ok_or_else(|| migration_error("Milestone update requires an id"))?;
    if milestone.duration == 0 && milestone.characters == 0 {
        return Err(migration_error(
            "Milestone must have either duration or characters",
        ));
    }
    let (media_title, media_uid) = resolve_milestone_media_identity(conn, milestone)?;
    conn.execute(
        "UPDATE main.milestones
         SET media_uid = ?1, media_title = ?2, name = ?3, duration = ?4, characters = ?5, date = ?6
         WHERE id = ?7",
        params![
            media_uid,
            media_title,
            milestone.name,
            milestone.duration,
            milestone.characters,
            milestone.date,
            milestone_id
        ],
    )?;
    Ok(())
}

pub fn save_cover_image(
    conn: &rusqlite::Connection,
    covers_dir: std::path::PathBuf,
    media_id: i64,
    src_path: &std::path::Path,
) -> std::result::Result<String, String> {
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let dest_file = format!(
        "{}_{}.{}",
        media_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
        ext
    );
    let dest = covers_dir.join(&dest_file);

    let old_cover: String = conn
        .query_row(
            "SELECT cover_image FROM shared.media WHERE id = ?1",
            rusqlite::params![media_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let dest_str = dest.to_string_lossy().to_string();
    std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    )
    .map_err(|e| e.to_string())?;

    if old_cover != dest_str {
        remove_cover_file_if_unreferenced(conn, std::path::Path::new(&old_cover), Some(media_id))
            .map_err(|e| e.to_string())?;
    }

    Ok(dest_str)
}

pub fn save_cover_bytes(
    conn: &rusqlite::Connection,
    covers_dir: std::path::PathBuf,
    media_id: i64,
    bytes: Vec<u8>,
    extension: &str,
) -> std::result::Result<String, String> {
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    let dest_file = format!(
        "{}_{}.{}",
        media_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
        extension
    );
    let dest = covers_dir.join(&dest_file);

    let old_cover: String = conn
        .query_row(
            "SELECT cover_image FROM shared.media WHERE id = ?1",
            rusqlite::params![media_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let dest_str = dest.to_string_lossy().to_string();
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    )
    .map_err(|e| e.to_string())?;

    if old_cover != dest_str {
        remove_cover_file_if_unreferenced(conn, std::path::Path::new(&old_cover), Some(media_id))
            .map_err(|e| e.to_string())?;
    }

    Ok(dest_str)
}

pub fn update_media_cover_image_by_uid(
    conn: &Connection,
    media_uid: &str,
    cover_image: &str,
) -> std::result::Result<(), String> {
    let existing = conn
        .query_row(
            "SELECT id, cover_image FROM shared.media WHERE uid = ?1",
            params![media_uid],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((media_id, old_cover)) = existing else {
        return Err(format!("Media with uid '{media_uid}' was not found"));
    };

    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE uid = ?2",
        params![cover_image, media_uid],
    )
    .map_err(|e| e.to_string())?;

    if old_cover != cover_image {
        remove_cover_file_if_unreferenced(conn, std::path::Path::new(&old_cover), Some(media_id))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn remove_cover_file_if_unreferenced(
    conn: &Connection,
    path: &std::path::Path,
    excluding_media_id: Option<i64>,
) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Ok(());
    }

    let path_str = path.to_string_lossy().to_string();
    let reference_count: i64 = if let Some(media_id) = excluding_media_id {
        conn.query_row(
            "SELECT COUNT(*) FROM shared.media WHERE cover_image = ?1 AND id != ?2",
            params![path_str, media_id],
            |row| row.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM shared.media WHERE cover_image = ?1",
            params![path_str],
            |row| row.get(0),
        )?
    };

    if reference_count == 0 && path.exists() {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TimelineEventKind;
    use rusqlite::Connection;
    use std::ffi::OsString;
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock_test_environment() -> MutexGuard<'static, ()> {
        ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    struct ScopedEnvironment {
        originals: Vec<(&'static str, Option<OsString>)>,
    }

    impl ScopedEnvironment {
        fn capture(names: &[&'static str]) -> Self {
            Self {
                originals: names
                    .iter()
                    .map(|name| (*name, std::env::var_os(name)))
                    .collect(),
            }
        }
    }

    impl Drop for ScopedEnvironment {
        fn drop(&mut self) {
            for (name, value) in &self.originals {
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    fn sample_media(title: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        }
    }

    fn sample_profile_picture() -> ProfilePicture {
        ProfilePicture {
            mime_type: "image/png".to_string(),
            base64_data: "YWJj".to_string(),
            byte_size: 3,
            width: 32,
            height: 32,
            updated_at: "2026-03-23T00:00:00Z".to_string(),
        }
    }

    fn sample_log(media_id: i64, date: &str, activity_type: &str) -> ActivityLog {
        ActivityLog {
            id: None,
            media_id,
            duration_minutes: 30,
            characters: 1200,
            date: date.to_string(),
            activity_type: activity_type.to_string(),
            notes: String::new(),
        }
    }

    fn media_uid_for_id(conn: &Connection, media_id: i64) -> String {
        conn.query_row(
            "SELECT uid FROM shared.media WHERE id = ?1",
            params![media_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), ts))
    }

    #[test]
    fn test_get_data_dir_prefers_env_var() {
        let _guard = lock_test_environment();
        let _environment = ScopedEnvironment::capture(&["KECHIMOCHI_DATA_DIR"]);
        let custom =
            std::env::temp_dir().join(format!("kechimochi_data_dir_env_{}", std::process::id()));

        unsafe {
            std::env::set_var("KECHIMOCHI_DATA_DIR", &custom);
        }

        let resolved = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(resolved, custom);
    }

    #[test]
    fn test_profile_picture_crud() {
        let conn = setup_test_db();
        assert!(get_profile_picture(&conn).unwrap().is_none());

        let picture = sample_profile_picture();
        upsert_profile_picture(&conn, &picture).unwrap();

        let stored = get_profile_picture(&conn).unwrap().unwrap();
        assert_eq!(stored.mime_type, picture.mime_type);
        assert_eq!(stored.base64_data, picture.base64_data);

        delete_profile_picture(&conn).unwrap();
        assert!(get_profile_picture(&conn).unwrap().is_none());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_get_data_dir_windows_default_from_appdata() {
        let _guard = lock_test_environment();
        let _environment = ScopedEnvironment::capture(&[
            "KECHIMOCHI_DATA_DIR",
            "KECHIMOCHI_APP_IDENTIFIER",
            "APPDATA",
        ]);
        let fake_appdata =
            std::env::temp_dir().join(format!("kechimochi_appdata_{}", std::process::id()));

        unsafe {
            std::env::remove_var("KECHIMOCHI_DATA_DIR");
            std::env::remove_var("KECHIMOCHI_APP_IDENTIFIER");
            std::env::set_var("APPDATA", &fake_appdata);
        }

        let resolved = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(resolved, fake_appdata.join("com.morg.kechimochi"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_get_data_dir_linux_default_honors_xdg_data_home() {
        let _guard = lock_test_environment();
        let _environment = ScopedEnvironment::capture(&[
            "KECHIMOCHI_DATA_DIR",
            "KECHIMOCHI_APP_IDENTIFIER",
            "XDG_DATA_HOME",
        ]);
        let fake_xdg_data_home =
            std::env::temp_dir().join(format!("kechimochi_xdg_data_{}", std::process::id()));

        unsafe {
            std::env::remove_var("KECHIMOCHI_DATA_DIR");
            std::env::set_var("KECHIMOCHI_APP_IDENTIFIER", "com.example.kechimochi-test");
            std::env::set_var("XDG_DATA_HOME", &fake_xdg_data_home);
        }

        let resolved = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(
            resolved,
            fake_xdg_data_home.join("com.example.kechimochi-test")
        );
    }

    #[test]
    fn test_create_tables() {
        let conn = setup_test_db();
        // Verify tables exist by querying sqlite_master
        let count_main: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name IN ('activity_logs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let count_shared: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared.sqlite_master WHERE type='table' AND name IN ('media')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_main, 1);
        assert_eq!(count_shared, 1);
    }

    #[test]
    fn test_add_and_get_media() {
        let conn = setup_test_db();
        let media = sample_media("ある魔女が死ぬまで");
        let id = add_media_with_id(&conn, &media).unwrap();
        assert!(id > 0);

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "ある魔女が死ぬまで");
        assert_eq!(all[0].id, Some(id));
        assert!(all[0].uid.as_deref().is_some());
        assert!(uuid::Uuid::parse_str(all[0].uid.as_deref().unwrap()).is_ok());
    }

    #[test]
    fn test_add_and_update_media_reject_whitespace_only_titles_without_writes() {
        let conn = setup_test_db();
        let blank_add = add_media_with_id(&conn, &sample_media(" \t\n\u{2003} "))
            .unwrap_err()
            .to_string();
        assert!(blank_add.contains("Media title cannot be blank"));
        assert!(get_all_media(&conn).unwrap().is_empty());

        let media_id = add_media_with_id(&conn, &sample_media("Original Title")).unwrap();
        let media_uid = media_uid_for_id(&conn, media_id);
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid.clone()),
                media_title: String::new(),
                name: "Preserved checkpoint".to_string(),
                duration: 30,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        let mut media = get_all_media(&conn).unwrap().remove(0);
        media.title = " \t\u{2003} ".to_string();
        let blank_update = update_media(&conn, &media).unwrap_err().to_string();
        assert!(blank_update.contains("Media title cannot be blank"));

        assert_eq!(get_all_media(&conn).unwrap()[0].title, "Original Title");
        let milestones = get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].media_title, "Original Title");
    }

    #[test]
    fn test_add_duplicate_media_fails() {
        let conn = setup_test_db();
        let media = sample_media("薬屋のひとりごと");
        add_media_with_id(&conn, &media).unwrap();
        let result = add_media_with_id(&conn, &media);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Another media entry already uses title"));
    }

    #[test]
    fn test_same_title_different_variants_are_distinct_media() {
        let conn = setup_test_db();
        let anime = Media {
            variant: "Anime".to_string(),
            ..sample_media("Horimiya")
        };
        let manga = Media {
            variant: "Manga".to_string(),
            ..sample_media("Horimiya")
        };

        let anime_id = add_media_with_id(&conn, &anime).unwrap();
        let manga_id = add_media_with_id(&conn, &manga).unwrap();
        assert_ne!(anime_id, manga_id);

        let duplicate = add_media_with_id(&conn, &anime).unwrap_err().to_string();
        assert!(duplicate.contains("title 'Horimiya'"));
        assert!(duplicate.contains("variant 'Anime'"));

        let media = get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 2);
    }

    #[test]
    fn test_update_media_rejects_identity_collision_without_changing_media_or_milestones() {
        let conn = setup_test_db();
        let anime_id = add_media_with_id(
            &conn,
            &Media {
                variant: "Anime".to_string(),
                ..sample_media("Horimiya")
            },
        )
        .unwrap();
        add_media_with_id(
            &conn,
            &Media {
                variant: "Manga".to_string(),
                ..sample_media("Horimiya")
            },
        )
        .unwrap();
        let anime_uid = media_uid_for_id(&conn, anime_id);
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(anime_uid.clone()),
                media_title: String::new(),
                name: "Episode 6".to_string(),
                duration: 120,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        let mut anime = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(anime_id))
            .unwrap();
        anime.variant = "Manga".to_string();
        let error = update_media(&conn, &anime).unwrap_err().to_string();
        assert!(error.contains("Another media entry already uses title"));

        let stored = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(anime_id))
            .unwrap();
        assert_eq!(stored.variant, "Anime");
        let milestones = get_milestones_for_media_uid(&conn, &anime_uid).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].media_title, "Horimiya");
    }

    #[test]
    fn test_update_media_rejects_title_collision_for_blank_variants_without_changes() {
        let conn = setup_test_db();
        let first_id = add_media_with_id(&conn, &sample_media("Title A")).unwrap();
        add_media_with_id(&conn, &sample_media("Title B")).unwrap();
        let first_uid = media_uid_for_id(&conn, first_id);
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(first_uid.clone()),
                media_title: String::new(),
                name: "Title A checkpoint".to_string(),
                duration: 30,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        let mut first = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(first_id))
            .unwrap();
        assert!(first.variant.is_empty());
        first.title = "Title B".to_string();
        let error = update_media(&conn, &first).unwrap_err().to_string();
        assert!(error.contains("title 'Title B'"));
        assert!(error.contains("variant '(no variant)'"));

        let stored = get_all_media(&conn).unwrap();
        assert_eq!(stored.len(), 2);
        assert!(stored
            .iter()
            .any(|media| media.id == Some(first_id) && media.title == "Title A"));
        let milestones = get_milestones_for_media_uid(&conn, &first_uid).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].media_title, "Title A");
    }

    #[test]
    fn test_update_media_and_milestone_title_propagation_are_atomic() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Original")).unwrap();
        let media_uid = media_uid_for_id(&conn, media_id);
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid.clone()),
                media_title: String::new(),
                name: "Checkpoint".to_string(),
                duration: 10,
                characters: 0,
                date: None,
            },
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TRIGGER main.reject_milestone_title_update
             BEFORE UPDATE OF media_title ON main.milestones
             BEGIN
                 SELECT RAISE(ABORT, 'forced milestone update failure');
             END;",
        )
        .unwrap();

        let mut media = get_all_media(&conn).unwrap().remove(0);
        media.title = "Renamed".to_string();
        assert!(update_media(&conn, &media).is_err());

        assert_eq!(get_all_media(&conn).unwrap()[0].title, "Original");
        let milestones = get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones[0].media_title, "Original");
    }

    #[test]
    fn test_update_media() {
        let conn = setup_test_db();
        let media = sample_media("呪術廻戦");
        let id = add_media_with_id(&conn, &media).unwrap();

        let updated = Media {
            id: Some(id),
            uid: None,
            title: "呪術廻戦".to_string(),
            variant: "Anime".to_string(),
            default_activity_type: "Watching".to_string(),
            status: "Complete".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        update_media(&conn, &updated).unwrap();

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].default_activity_type, "Watching");
        assert_eq!(all[0].status, "Complete");
    }

    #[test]
    fn test_update_media_renames_linked_milestones() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Before Rename")).unwrap();
        let original_media = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(media_id))
            .unwrap();

        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: original_media.uid.clone(),
                media_title: "Before Rename".to_string(),
                name: "Checkpoint".to_string(),
                duration: 90,
                characters: 0,
                date: Some("2024-05-01".to_string()),
            },
        )
        .unwrap();

        let mut renamed_media = original_media.clone();
        renamed_media.title = "After Rename".to_string();
        update_media(&conn, &renamed_media).unwrap();

        let renamed_milestones =
            get_milestones_for_media_uid(&conn, original_media.uid.as_deref().unwrap()).unwrap();
        assert_eq!(renamed_milestones.len(), 1);
        assert_eq!(renamed_milestones[0].media_title, "After Rename");
        assert_eq!(renamed_milestones[0].media_uid, original_media.uid);
    }

    #[test]
    fn test_same_title_variant_milestones_are_uid_scoped_for_rename_get_and_delete() {
        let conn = setup_test_db();
        let anime_id = add_media_with_id(
            &conn,
            &Media {
                variant: "Anime".to_string(),
                ..sample_media("Shared Title")
            },
        )
        .unwrap();
        let manga_id = add_media_with_id(
            &conn,
            &Media {
                variant: "Manga".to_string(),
                ..sample_media("Shared Title")
            },
        )
        .unwrap();
        let anime_uid = media_uid_for_id(&conn, anime_id);
        let manga_uid = media_uid_for_id(&conn, manga_id);

        for (uid, name) in [
            (&anime_uid, "Anime milestone"),
            (&manga_uid, "Manga milestone"),
        ] {
            add_milestone(
                &conn,
                &Milestone {
                    id: None,
                    media_uid: Some(uid.to_string()),
                    media_title: "stale input title".to_string(),
                    name: name.to_string(),
                    duration: 30,
                    characters: 0,
                    date: None,
                },
            )
            .unwrap();
        }

        assert_eq!(
            get_milestones_for_media_uid(&conn, &anime_uid).unwrap()[0].name,
            "Anime milestone"
        );
        assert_eq!(
            get_milestones_for_media_uid(&conn, &manga_uid).unwrap()[0].name,
            "Manga milestone"
        );

        let mut anime = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(anime_id))
            .unwrap();
        anime.title = "Renamed Anime".to_string();
        update_media(&conn, &anime).unwrap();

        assert_eq!(
            get_milestones_for_media_uid(&conn, &anime_uid).unwrap()[0].media_title,
            "Renamed Anime"
        );
        assert_eq!(
            get_milestones_for_media_uid(&conn, &manga_uid).unwrap()[0].media_title,
            "Shared Title"
        );

        delete_media(&conn, anime_id).unwrap();
        assert!(get_milestones_for_media_uid(&conn, &anime_uid)
            .unwrap()
            .is_empty());
        assert_eq!(
            get_milestones_for_media_uid(&conn, &manga_uid)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn test_delete_media_cascades_logs() {
        let conn = setup_test_db();

        let dir = std::env::temp_dir();
        let cover_path = dir.join("test_cover_cleanup.png");
        std::fs::write(&cover_path, "fake data").unwrap();
        let cover_str = cover_path.to_string_lossy().to_string();

        let media = Media {
            cover_image: cover_str.clone(),
            ..sample_media("Cleanup Test")
        };
        let media_id = add_media_with_id(&conn, &media).unwrap();
        let media_uid = media_uid_for_id(&conn, media_id);

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 60,
            characters: 0,
            date: "2024-01-15".to_string(),
            activity_type: String::new(),
            notes: String::new(),
        };
        add_log(&conn, &log).unwrap();
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid),
                media_title: "Cleanup Test".to_string(),
                name: "Delete Me".to_string(),
                duration: 30,
                characters: 0,
                date: Some("2024-01-15".to_string()),
            },
        )
        .unwrap();

        assert!(cover_path.exists());

        // Delete media (should cascade logs and remove file)
        delete_media(&conn, media_id).unwrap();

        let media_list = get_all_media(&conn).unwrap();
        assert_eq!(media_list.len(), 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);
        assert_eq!(get_all_milestones(&conn).unwrap().len(), 0);

        // Verify disk cleanup
        assert!(!cover_path.exists());
    }

    #[test]
    fn test_delete_log() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Log")).unwrap();
        let log_id = add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-01-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        assert_eq!(get_logs(&conn).unwrap().len(), 1);
        delete_log(&conn, log_id).unwrap();
        assert_eq!(get_logs(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_add_and_get_logs() {
        let conn = setup_test_db();
        let media = sample_media("本好きの下剋上");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 45,
            characters: 100,
            date: "2024-03-01".to_string(),
            activity_type: String::new(),
            notes: String::new(),
        };
        let log_id = add_log(&conn, &log).unwrap();
        assert!(log_id > 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "本好きの下剋上");
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].date, "2024-03-01");
    }

    #[test]
    fn test_add_log_validation() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Validation")).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 0,
            characters: 0,
            date: "2024-03-01".to_string(),
            activity_type: String::new(),
            notes: String::new(),
        };
        let result = add_log(&conn, &log);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Activity must have either duration or characters"));

        for (duration_minutes, characters, expected) in [
            (-1, 100, "Activity duration cannot be negative"),
            (10, -1, "Activity character count cannot be negative"),
        ] {
            let invalid = ActivityLog {
                id: None,
                media_id,
                duration_minutes,
                characters,
                date: "2024-03-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            };
            let error = add_log(&conn, &invalid).unwrap_err().to_string();
            assert!(error.contains(expected));
        }

        let valid_id = add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-03-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();
        let update_error = update_log(
            &conn,
            &ActivityLog {
                id: Some(valid_id),
                media_id,
                duration_minutes: 10,
                characters: -1,
                date: "2024-03-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap_err()
        .to_string();
        assert!(update_error.contains("Activity character count cannot be negative"));
        assert_eq!(get_logs(&conn).unwrap()[0].characters, 0);
    }

    #[test]
    fn test_get_heatmap_aggregation() {
        let conn = setup_test_db();
        let media = sample_media("ハイキュー");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        // Two logs on the same day
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2024-06-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 45,
                characters: 200,
                date: "2024-06-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        // One log on a different day
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 20,
                characters: 50,
                date: "2024-06-02".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        let heatmap = get_heatmap(&conn).unwrap();
        assert_eq!(heatmap.len(), 2);
        assert_eq!(heatmap[0].date, "2024-06-01");
        assert_eq!(heatmap[0].total_minutes, 75); // 30 + 45
        assert_eq!(heatmap[0].total_characters, 300); // 100 + 200
        assert_eq!(heatmap[1].date, "2024-06-02");
        assert_eq!(heatmap[1].total_minutes, 20);
        assert_eq!(heatmap[1].total_characters, 50);
    }

    #[test]
    fn test_get_logs_for_media() {
        let conn = setup_test_db();
        let m1_id = add_media_with_id(&conn, &sample_media("Media 1")).unwrap();
        let m2_id = add_media_with_id(&conn, &sample_media("Media 2")).unwrap();

        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m1_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-03-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m2_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-03-02".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        let m1_logs = get_logs_for_media(&conn, m1_id).unwrap();
        assert_eq!(m1_logs.len(), 1);
        assert_eq!(m1_logs[0].title, "Media 1");

        let m2_logs = get_logs_for_media(&conn, m2_id).unwrap();
        assert_eq!(m2_logs.len(), 1);
        assert_eq!(m2_logs[0].title, "Media 2");
    }

    #[test]
    fn test_get_all_milestones_returns_all_rows_in_date_order() {
        let conn = setup_test_db();
        let alpha_id = add_media_with_id(&conn, &sample_media("Alpha")).unwrap();
        let beta_id = add_media_with_id(&conn, &sample_media("Beta")).unwrap();

        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, alpha_id)),
                media_title: "Alpha".to_string(),
                name: "Older".to_string(),
                duration: 10,
                characters: 0,
                date: Some("2024-01-01".to_string()),
            },
        )
        .unwrap();
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, beta_id)),
                media_title: "Beta".to_string(),
                name: "Newer".to_string(),
                duration: 20,
                characters: 0,
                date: Some("2024-02-01".to_string()),
            },
        )
        .unwrap();

        let milestones = get_all_milestones(&conn).unwrap();
        assert_eq!(milestones.len(), 2);
        assert_eq!(milestones[0].name, "Newer");
        assert_eq!(milestones[1].name, "Older");
    }

    #[test]
    fn test_get_timeline_events_builds_lifecycle_events() {
        let conn = setup_test_db();

        let complete_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Complete".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("Complete Title")
            },
        )
        .unwrap();
        let paused_id = add_media_with_id(
            &conn,
            &Media {
                default_activity_type: "Playing".to_string(),
                tracking_status: "Paused".to_string(),
                content_type: "Videogame".to_string(),
                ..sample_media("Paused Title")
            },
        )
        .unwrap();
        let dropped_id = add_media_with_id(
            &conn,
            &Media {
                default_activity_type: "Watching".to_string(),
                tracking_status: "Dropped".to_string(),
                content_type: "Anime".to_string(),
                ..sample_media("Dropped Title")
            },
        )
        .unwrap();
        let ongoing_id = add_media_with_id(
            &conn,
            &Media {
                default_activity_type: "Listening".to_string(),
                tracking_status: "Ongoing".to_string(),
                content_type: "Audio".to_string(),
                ..sample_media("Ongoing Title")
            },
        )
        .unwrap();
        let single_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Ongoing".to_string(),
                content_type: "Manga".to_string(),
                ..sample_media("Single Session")
            },
        )
        .unwrap();

        add_log(&conn, &sample_log(complete_id, "2024-03-01", "Reading")).unwrap();
        add_log(&conn, &sample_log(complete_id, "2024-03-05", "Reading")).unwrap();
        add_log(&conn, &sample_log(paused_id, "2024-03-02", "Playing")).unwrap();
        add_log(&conn, &sample_log(paused_id, "2024-03-04", "Playing")).unwrap();
        add_log(&conn, &sample_log(dropped_id, "2024-03-03", "Watching")).unwrap();
        add_log(&conn, &sample_log(dropped_id, "2024-03-07", "Watching")).unwrap();
        add_log(&conn, &sample_log(ongoing_id, "2024-02-01", "Listening")).unwrap();
        add_log(&conn, &sample_log(ongoing_id, "2024-02-08", "Listening")).unwrap();
        add_log(&conn, &sample_log(single_id, "2024-01-10", "Reading")).unwrap();

        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, complete_id)),
                media_title: "Complete Title".to_string(),
                name: "Halfway".to_string(),
                duration: 60,
                characters: 0,
                date: Some("2024-03-04".to_string()),
            },
        )
        .unwrap();
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, ongoing_id)),
                media_title: "Ongoing Title".to_string(),
                name: "Undated".to_string(),
                duration: 30,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        let events = get_timeline_events(&conn).unwrap();

        assert_eq!(events[0].kind, TimelineEventKind::Dropped);
        assert_eq!(events[0].media_title, "Dropped Title");

        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Finished
                && event.media_title == "Complete Title"
                && event.date == "2024-03-05"
        }));
        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Paused
                && event.media_title == "Paused Title"
                && event.date == "2024-03-04"
        }));
        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Dropped
                && event.media_title == "Dropped Title"
                && event.date == "2024-03-07"
        }));
        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Milestone
                && event.media_title == "Complete Title"
                && event.milestone_name.as_deref() == Some("Halfway")
                && event.milestone_minutes == 60
                && event.milestone_characters == 0
        }));
        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Started
                && event.media_title == "Ongoing Title"
                && event.date == "2024-02-01"
        }));
        assert!(events.iter().any(|event| {
            event.kind == TimelineEventKind::Started
                && event.media_title == "Single Session"
                && event.date == "2024-01-10"
        }));
        assert_eq!(
            events
                .iter()
                .filter(|event| event.media_title == "Ongoing Title")
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.media_title == "Single Session")
                .count(),
            1
        );
        assert!(!events
            .iter()
            .any(|event| event.milestone_name.as_deref() == Some("Undated")));
    }

    #[test]
    fn test_get_timeline_events_preserves_same_title_variants() {
        let conn = setup_test_db();
        let manga_id = add_media_with_id(
            &conn,
            &Media {
                variant: "Manga".to_string(),
                ..sample_media("Shared Title")
            },
        )
        .unwrap();
        let anime_id = add_media_with_id(
            &conn,
            &Media {
                variant: "Anime".to_string(),
                default_activity_type: "Watching".to_string(),
                ..sample_media("Shared Title")
            },
        )
        .unwrap();

        add_log(&conn, &sample_log(manga_id, "2024-04-01", "Reading")).unwrap();
        add_log(&conn, &sample_log(anime_id, "2024-04-02", "Watching")).unwrap();

        let events = get_timeline_events(&conn).unwrap();
        let manga = events
            .iter()
            .find(|event| event.media_id == manga_id)
            .unwrap();
        let anime = events
            .iter()
            .find(|event| event.media_id == anime_id)
            .unwrap();
        assert_eq!(manga.media_title, "Shared Title");
        assert_eq!(manga.media_variant, "Manga");
        assert_eq!(anime.media_title, "Shared Title");
        assert_eq!(anime.media_variant, "Anime");

        let serialized = serde_json::to_value(anime).unwrap();
        assert_eq!(serialized["mediaVariant"], "Anime");
        assert!(serialized.get("media_variant").is_none());
    }

    #[test]
    fn test_get_timeline_events_collapses_same_day_terminal_activity() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Complete".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("One Day Finish")
            },
        )
        .unwrap();

        add_log(&conn, &sample_log(media_id, "2024-04-01", "Reading")).unwrap();

        let events = get_timeline_events(&conn).unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, TimelineEventKind::Finished);
        assert_eq!(events[0].media_title, "One Day Finish");
        assert!(events[0].same_day_terminal);
    }

    #[test]
    fn test_get_timeline_events_orders_same_day_clusters_from_newest_to_oldest() {
        let conn = setup_test_db();

        let complete_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Complete".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("Complete Title")
            },
        )
        .unwrap();
        let same_day_complete_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Complete".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("One Day Finish")
            },
        )
        .unwrap();
        let ongoing_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Ongoing".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("Ongoing Title")
            },
        )
        .unwrap();

        add_log(&conn, &sample_log(complete_id, "2024-03-01", "Reading")).unwrap();
        add_log(&conn, &sample_log(complete_id, "2024-03-05", "Reading")).unwrap();
        add_log(
            &conn,
            &sample_log(same_day_complete_id, "2024-03-05", "Reading"),
        )
        .unwrap();
        add_log(&conn, &sample_log(ongoing_id, "2024-03-05", "Reading")).unwrap();

        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, complete_id)),
                media_title: "Complete Title".to_string(),
                name: "Final Stretch".to_string(),
                duration: 25,
                characters: 0,
                date: Some("2024-03-05".to_string()),
            },
        )
        .unwrap();
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, ongoing_id)),
                media_title: "Ongoing Title".to_string(),
                name: "Checkpoint".to_string(),
                duration: 15,
                characters: 0,
                date: Some("2024-03-05".to_string()),
            },
        )
        .unwrap();

        let same_day_events = get_timeline_events(&conn)
            .unwrap()
            .into_iter()
            .filter(|event| event.date == "2024-03-05")
            .collect::<Vec<_>>();

        assert_eq!(same_day_events.len(), 5);

        assert_eq!(same_day_events[0].kind, TimelineEventKind::Milestone);
        assert_eq!(same_day_events[0].media_title, "Ongoing Title");

        assert_eq!(same_day_events[1].kind, TimelineEventKind::Started);
        assert_eq!(same_day_events[1].media_title, "Ongoing Title");

        assert_eq!(same_day_events[2].kind, TimelineEventKind::Finished);
        assert_eq!(same_day_events[2].media_title, "One Day Finish");
        assert!(same_day_events[2].same_day_terminal);

        assert_eq!(same_day_events[3].kind, TimelineEventKind::Finished);
        assert_eq!(same_day_events[3].media_title, "Complete Title");
        assert!(!same_day_events[3].same_day_terminal);

        assert_eq!(same_day_events[4].kind, TimelineEventKind::Milestone);
        assert_eq!(same_day_events[4].media_title, "Complete Title");
    }

    #[test]
    fn test_get_timeline_events_orders_same_date_milestones_by_id_descending() {
        let conn = setup_test_db();

        let media_id = add_media_with_id(
            &conn,
            &Media {
                tracking_status: "Ongoing".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("Sorted Media")
            },
        )
        .unwrap();

        add_log(&conn, &sample_log(media_id, "2024-06-01", "Reading")).unwrap();

        // Insert milestone A first (lower id = older)
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, media_id)),
                media_title: "Sorted Media".to_string(),
                name: "Milestone A".to_string(),
                duration: 30,
                characters: 0,
                date: Some("2024-06-01".to_string()),
            },
        )
        .unwrap();

        // Insert milestone B second (higher id = newer)
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid_for_id(&conn, media_id)),
                media_title: "Sorted Media".to_string(),
                name: "Milestone B".to_string(),
                duration: 30,
                characters: 0,
                date: Some("2024-06-01".to_string()),
            },
        )
        .unwrap();

        let milestone_events = get_timeline_events(&conn)
            .unwrap()
            .into_iter()
            .filter(|event| {
                event.kind == TimelineEventKind::Milestone && event.media_title == "Sorted Media"
            })
            .collect::<Vec<_>>();

        assert_eq!(milestone_events.len(), 2);
        // Higher id (newer, Milestone B) must appear first (index 0)
        assert_eq!(
            milestone_events[0].milestone_name.as_deref(),
            Some("Milestone B")
        );
        assert_eq!(
            milestone_events[1].milestone_name.as_deref(),
            Some("Milestone A")
        );
        // Confirm id ordering matches expectation
        assert!(milestone_events[0].milestone_id > milestone_events[1].milestone_id);
    }

    #[test]
    fn test_settings_operations() {
        let conn = setup_test_db();

        // Initially none
        assert_eq!(get_setting(&conn, "theme").unwrap(), None);

        // Set and get
        set_setting(&conn, "theme", "dark").unwrap();
        assert_eq!(
            get_setting(&conn, "theme").unwrap(),
            Some("dark".to_string())
        );
        let first_updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM main.settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!first_updated_at.is_empty());

        // Update
        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(
            get_setting(&conn, "theme").unwrap(),
            Some("light".to_string())
        );
    }

    #[test]
    fn test_clear_activities() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Test")).unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-01-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        assert_eq!(get_logs(&conn).unwrap().len(), 1);

        clear_activities(&conn).unwrap();
        assert_eq!(get_logs(&conn).unwrap().len(), 0);

        // Media should still exist
        assert_eq!(get_all_media(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_media_ordering() {
        let conn = setup_test_db();

        // 1. Archived media with the second-most-recent activity
        let m1_id = add_media_with_id(
            &conn,
            &Media {
                status: "Archived".to_string(),
                ..sample_media("Archived Recent")
            },
        )
        .unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m1_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-03-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        // 2. Non-ongoing media with the most recent activity
        let m2_id = add_media_with_id(
            &conn,
            &Media {
                status: "Active".to_string(),
                tracking_status: "Complete".to_string(),
                ..sample_media("Active Complete")
            },
        )
        .unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m2_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-03-02".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        // 3. Ongoing media with the oldest activity
        let m3_id = add_media_with_id(
            &conn,
            &Media {
                status: "Active".to_string(),
                tracking_status: "Ongoing".to_string(),
                ..sample_media("Ongoing Old")
            },
        )
        .unwrap();
        add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m3_id,
                duration_minutes: 10,
                characters: 0,
                date: "2024-01-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();

        // 4. Ongoing media with no activity logs at all
        let _m4_id = add_media_with_id(
            &conn,
            &Media {
                status: "Active".to_string(),
                tracking_status: "Ongoing".to_string(),
                ..sample_media("Ongoing No Activity")
            },
        )
        .unwrap();

        // Expectation: pure recency DESC (status/tracking_status no longer matter),
        // with media that has no activity logs (NULL recency) sorting last.
        // 1. Active Complete (2024-03-02)
        // 2. Archived Recent (2024-03-01)
        // 3. Ongoing Old (2024-01-01)
        // 4. Ongoing No Activity (NULL, sorts last)

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].title, "Active Complete");
        assert_eq!(all[1].title, "Archived Recent");
        assert_eq!(all[2].title, "Ongoing Old");
        assert_eq!(all[3].title, "Ongoing No Activity");
    }

    #[test]
    fn test_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();

        // Create legacy table in 'main'
        conn.execute("CREATE TABLE main.media (id INTEGER PRIMARY KEY, title TEXT, media_type TEXT, status TEXT, language TEXT, description TEXT, cover_image TEXT, extra_data TEXT, content_type TEXT)", []).unwrap();
        conn.execute("INSERT INTO main.media (title, media_type, status, language) VALUES ('Legacy Manga', 'Reading', 'Ongoing', 'Japanese')", []).unwrap();

        // Create activity logs (old style might have had foreign keys to main.media)
        conn.execute("CREATE TABLE main.activity_logs (id INTEGER PRIMARY KEY, media_id INTEGER, duration_minutes INTEGER, date TEXT)", []).unwrap();
        conn.execute("INSERT INTO main.activity_logs (media_id, duration_minutes, date) VALUES (1, 60, '2024-01-01')", []).unwrap();

        // Run migration
        migrate_to_shared(&conn).unwrap();
        create_tables(&conn).unwrap();

        // Check shared table
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM shared.media", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Check main table is gone
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='media'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Legacy Manga");
    }

    #[test]
    fn test_save_cover_image() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Cover Test")).unwrap();

        let temp_dir = std::env::temp_dir().join(format!("covers_{}", std::process::id()));
        let src_file = temp_dir.join("src.png");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(&src_file, "fake image").unwrap();

        let covers_dir = temp_dir.join("covers");

        // 1. Save first cover
        let dest1 = save_cover_image(&conn, covers_dir.clone(), media_id, &src_file).unwrap();
        assert!(std::path::Path::new(&dest1).exists());

        // 2. Save second cover (should delete first)
        // Ensure timestamp is different
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(&src_file, "fake image 2").unwrap();
        let dest2 = save_cover_image(&conn, covers_dir.clone(), media_id, &src_file).unwrap();

        assert_ne!(dest1, dest2);
        assert!(std::path::Path::new(&dest2).exists());
        assert!(!std::path::Path::new(&dest1).exists()); // Cleaned up

        // 3. Save with missing file should error
        let result = save_cover_image(&conn, covers_dir, media_id, &temp_dir.join("missing.png"));
        assert!(result.is_err());

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_init_db_integration() {
        let temp_dir = unique_temp_dir("init_test");
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Initialize a new profile
        let conn = init_db(temp_dir.clone(), Some("test_user")).unwrap();

        // Verify tables exist in both
        let _: i64 = conn
            .query_row("SELECT COUNT(*) FROM shared.media", [], |r| r.get(0))
            .unwrap();
        let _: i64 = conn
            .query_row("SELECT COUNT(*) FROM main.activity_logs", [], |r| r.get(0))
            .unwrap();

        assert!(temp_dir.join("kechimochi_user.db").exists());
        assert!(temp_dir.join("kechimochi_shared_media.db").exists());
        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_init_db_upgrades_legacy_unversioned_database_to_current_schema() {
        let temp_dir = unique_temp_dir("legacy_upgrade_test");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let user_db = temp_dir.join("kechimochi_user.db");
        let shared_db = temp_dir.join("kechimochi_shared_media.db");

        {
            let legacy_conn = Connection::open(&user_db).unwrap();
            legacy_conn
                .execute(
                    "CREATE TABLE media (
                    id INTEGER PRIMARY KEY,
                    title TEXT,
                    media_type TEXT,
                    status TEXT,
                    language TEXT
                )",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "INSERT INTO media (id, title, media_type, status, language)
                 VALUES (1, 'Legacy Manga', 'Reading', 'Ongoing', 'Japanese')",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "CREATE TABLE activity_logs (
                    id INTEGER PRIMARY KEY,
                    media_id INTEGER,
                    duration_minutes INTEGER,
                    date TEXT
                )",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "INSERT INTO activity_logs (id, media_id, duration_minutes, date)
                 VALUES (1, 1, 60, '2024-01-01')",
                    [],
                )
                .unwrap();
        }
        Connection::open(&shared_db).unwrap();

        let conn = init_db(temp_dir.clone(), None).unwrap();
        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert!(latest_schema_is_present(&conn).unwrap());

        let media = get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "Legacy Manga");

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Legacy Manga");
        assert_eq!(logs[0].duration_minutes, 60);

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_init_db_rejects_newer_schema_version() {
        for (case, main_version, shared_version) in [
            (
                "future_main",
                CURRENT_SCHEMA_VERSION + 1,
                CURRENT_SCHEMA_VERSION,
            ),
            (
                "future_shared",
                CURRENT_SCHEMA_VERSION,
                CURRENT_SCHEMA_VERSION + 1,
            ),
        ] {
            let temp_dir = unique_temp_dir(case);
            std::fs::create_dir_all(&temp_dir).unwrap();
            let user_db = temp_dir.join("kechimochi_user.db");
            let shared_db = temp_dir.join("kechimochi_shared_media.db");

            for (path, version, marker) in [
                (&user_db, main_version, "user marker"),
                (&shared_db, shared_version, "shared marker"),
            ] {
                let conn = Connection::open(path).unwrap();
                conn.execute_batch(&format!(
                    "PRAGMA journal_mode = DELETE;
                     CREATE TABLE future_marker (value TEXT NOT NULL);
                     PRAGMA user_version = {version};"
                ))
                .unwrap();
                conn.execute("INSERT INTO future_marker (value) VALUES (?1)", [marker])
                    .unwrap();
            }

            let directory_entries = |directory: &std::path::Path| {
                let mut entries = std::fs::read_dir(directory)
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name())
                    .collect::<Vec<_>>();
                entries.sort();
                entries
            };
            let files_before = directory_entries(&temp_dir);

            let err = init_db(temp_dir.clone(), None).unwrap_err();
            assert!(err.to_string().contains("newer than this app supports"));
            assert_eq!(directory_entries(&temp_dir), files_before);

            for (path, expected_version, expected_marker) in [
                (&user_db, main_version, "user marker"),
                (&shared_db, shared_version, "shared marker"),
            ] {
                let conn = Connection::open(path).unwrap();
                assert_eq!(get_schema_version(&conn, "main").unwrap(), expected_version);
                let journal_mode: String = conn
                    .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(journal_mode, "delete");
                let marker: String = conn
                    .query_row("SELECT value FROM future_marker", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(marker, expected_marker);
                let tables: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(tables, 1);
            }

            std::fs::remove_dir_all(temp_dir).ok();
        }
    }

    #[test]
    fn test_init_db_rejects_a_lone_future_database_before_creating_or_copying_companions() {
        for (case, future_file_name, fallback_username, forbidden_file_name) in [
            (
                "future_main_without_shared",
                "kechimochi_user.db",
                None,
                "kechimochi_shared_media.db",
            ),
            (
                "future_shared_without_main",
                "kechimochi_shared_media.db",
                None,
                "kechimochi_user.db",
            ),
            (
                "future_fallback_without_main",
                "kechimochi_legacy-user.db",
                Some("legacy-user"),
                "kechimochi_user.db",
            ),
        ] {
            let temp_dir = unique_temp_dir(case);
            std::fs::create_dir_all(&temp_dir).unwrap();
            let future_path = temp_dir.join(future_file_name);
            let forbidden_path = temp_dir.join(forbidden_file_name);
            {
                let conn = Connection::open(&future_path).unwrap();
                conn.execute_batch(&format!(
                    "PRAGMA journal_mode = DELETE;
                     CREATE TABLE future_marker (value TEXT NOT NULL);
                     INSERT INTO future_marker (value) VALUES ('preserved');
                     PRAGMA user_version = {};",
                    CURRENT_SCHEMA_VERSION + 1
                ))
                .unwrap();
            }
            let files_before = std::fs::read_dir(&temp_dir)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>();

            let error = init_db(temp_dir.clone(), fallback_username)
                .unwrap_err()
                .to_string();

            assert!(error.contains("newer than this app supports"));
            assert!(!forbidden_path.exists());
            assert_eq!(
                std::fs::read_dir(&temp_dir)
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name())
                    .collect::<Vec<_>>(),
                files_before
            );
            let conn = Connection::open(&future_path).unwrap();
            assert_eq!(
                get_schema_version(&conn, "main").unwrap(),
                CURRENT_SCHEMA_VERSION + 1
            );
            assert_eq!(
                conn.query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
                    .unwrap(),
                "delete"
            );
            assert_eq!(
                conn.query_row("SELECT value FROM future_marker", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
                "preserved"
            );

            std::fs::remove_dir_all(temp_dir).ok();
        }
    }

    #[test]
    #[cfg(unix)]
    fn test_init_db_preflight_reads_an_uncheckpointed_future_version_from_wal() {
        let temp_dir = unique_temp_dir("future_version_in_wal");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let user_db = temp_dir.join("kechimochi_user.db");
        let shared_db = temp_dir.join("kechimochi_shared_media.db");
        let writer = Connection::open(&user_db).unwrap();
        writer
            .execute_batch(&format!(
                "PRAGMA journal_mode = WAL;
                 PRAGMA wal_autocheckpoint = 0;
                 CREATE TABLE future_marker (value TEXT NOT NULL);
                 INSERT INTO future_marker (value) VALUES ('only in WAL');
                 PRAGMA user_version = {};",
                CURRENT_SCHEMA_VERSION + 1
            ))
            .unwrap();
        assert!(user_db.with_extension("db-wal").exists());

        // A read-only WAL open may recreate -shm, but it must see the future
        // version in the WAL and reject before creating the missing shared DB.
        std::fs::remove_file(user_db.with_extension("db-shm")).unwrap();
        let error = init_db(temp_dir.clone(), None).unwrap_err().to_string();

        assert!(error.contains("newer than this app supports"));
        assert!(!shared_db.exists());
        assert_eq!(
            get_schema_version(&writer, "main").unwrap(),
            CURRENT_SCHEMA_VERSION + 1
        );
        assert_eq!(
            writer
                .query_row("SELECT value FROM future_marker", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "only in WAL"
        );

        drop(writer);
        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_get_data_dir_override() {
        let _guard = lock_test_environment();
        let _environment = ScopedEnvironment::capture(&["KECHIMOCHI_DATA_DIR"]);
        let temp_dir = "/tmp/kechimochi_test_dir";
        unsafe {
            std::env::set_var("KECHIMOCHI_DATA_DIR", temp_dir);
        }

        let dir = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(dir, PathBuf::from(temp_dir));
    }

    #[test]
    fn test_wipe_everything() {
        let temp_dir = std::env::temp_dir().join(format!("wipe_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::create_dir_all(temp_dir.join("covers")).unwrap();
        std::fs::write(temp_dir.join("kechimochi_user.db"), "").unwrap();
        std::fs::write(temp_dir.join("covers/test.png"), "").unwrap();
        std::fs::write(temp_dir.join("not_a_db.txt"), "").unwrap();

        wipe_everything(temp_dir.clone()).unwrap();

        assert!(!temp_dir.join("covers").exists());
        assert!(!temp_dir.join("kechimochi_user.db").exists());
        assert!(temp_dir.join("not_a_db.txt").exists()); // Should preserve non-db files

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_get_username_logic() {
        std::env::set_var("USER", "testuser");
        assert_eq!(crate::get_username_logic(), "testuser");

        std::env::remove_var("USER");
        std::env::set_var("USERNAME", "winuser");
        assert_eq!(crate::get_username_logic(), "winuser");
    }

    #[test]
    fn test_read_file_bytes() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_bytes.txt");
        std::fs::write(&file_path, "hello").unwrap();

        let bytes = std::fs::read(&file_path).unwrap();
        assert_eq!(bytes, b"hello");

        std::fs::remove_file(file_path).ok();
    }

    #[test]
    fn test_schema_evolution() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();

        // Create an "old" version of the table with missing columns
        conn.execute("CREATE TABLE shared.media (id INTEGER PRIMARY KEY, title TEXT UNIQUE, media_type TEXT, status TEXT, language TEXT)", []).unwrap();

        // This should evolve the table by adding missing columns
        migrate_shared_media_columns(&conn).unwrap();

        // Verify we can insert into the new columns
        conn.execute("INSERT INTO shared.media (title, media_type, status, language, description, tracking_status) VALUES ('Evolution', 'Reading', 'Ongoing', 'Japanese', 'Desc', 'Untracked')", []).unwrap();
    }

    #[test]
    fn test_v1_to_v2_migration_backfills_sync_foundation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();

        conn.execute(
            "CREATE TABLE shared.media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL UNIQUE,
                media_type TEXT NOT NULL,
                status TEXT NOT NULL,
                language TEXT NOT NULL,
                description TEXT DEFAULT '',
                cover_image TEXT DEFAULT '',
                extra_data TEXT DEFAULT '{}',
                content_type TEXT DEFAULT 'Unknown',
                tracking_status TEXT DEFAULT 'Untracked'
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared.media (
                id, title, media_type, status, language, description,
                cover_image, extra_data, content_type, tracking_status
            ) VALUES (1, 'Migrated Media', 'Reading', 'Active', 'Japanese', '', '', '{}', 'Novel', 'Ongoing')",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE main.milestones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_title TEXT NOT NULL,
                name TEXT NOT NULL,
                duration INTEGER NOT NULL,
                characters INTEGER NOT NULL DEFAULT 0,
                date TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO main.milestones (media_title, name, duration, characters, date)
             VALUES ('Migrated Media', 'Arc 1', 120, 0, '2024-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE main.settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE main.activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id INTEGER NOT NULL,
                duration_minutes INTEGER NOT NULL,
                characters INTEGER NOT NULL DEFAULT 0,
                date TEXT NOT NULL,
                activity_type TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE main.profile_picture (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                mime_type TEXT NOT NULL,
                base64_data TEXT NOT NULL,
                byte_size INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO main.settings (key, value) VALUES ('theme', 'molokai')",
            [],
        )
        .unwrap();
        set_bundle_schema_version(&conn, 1).unwrap();

        migrate_schema(&conn).unwrap();

        let media = get_all_media(&conn).unwrap();
        let expected_uid = generate_deterministic_media_uid("Migrated Media").unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].uid.as_deref(), Some(expected_uid.as_str()));

        let milestones =
            get_milestones_for_media_uid(&conn, media[0].uid.as_deref().unwrap()).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].media_uid, media[0].uid);

        let updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM main.settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!updated_at.is_empty());
        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn test_milestone_operations() {
        let conn = setup_test_db();
        let media_title = "Milestone Media";
        let media_id = add_media_with_id(&conn, &sample_media(media_title)).unwrap();
        let media_uid = media_uid_for_id(&conn, media_id);

        let milestone = Milestone {
            id: None,
            media_uid: Some(media_uid.clone()),
            media_title: "Ignored stale display title".to_string(),
            name: "First Quarter".to_string(),
            duration: 120,
            characters: 0,
            date: Some("2024-03-12".to_string()),
        };

        // Test add_milestone
        let id = add_milestone(&conn, &milestone).unwrap();
        assert!(id > 0);

        // Test get_milestones_for_media_uid and canonical display title materialization.
        let milestones = get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].media_title, media_title);
        assert_eq!(milestones[0].name, "First Quarter");
        assert_eq!(milestones[0].duration, 120);

        // Test update_milestone
        let mut updated = milestones[0].clone();
        updated.name = "Halfway".to_string();
        updated.duration = 240;
        updated.media_title = "stale client display title".to_string();
        update_milestone(&conn, &updated).unwrap();

        let milestones = get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones[0].name, "Halfway");
        assert_eq!(milestones[0].duration, 240);
        assert_eq!(milestones[0].media_title, media_title);

        // Test delete_milestone
        delete_milestone(&conn, id).unwrap();
        let milestones = get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones.len(), 0);
    }

    #[test]
    fn test_add_milestone_validation() {
        let conn = setup_test_db();
        let milestone = Milestone {
            id: None,
            media_uid: None,
            media_title: "Validation".to_string(),
            name: "Zero".to_string(),
            duration: 0,
            characters: 0,
            date: None,
        };
        let result = add_milestone(&conn, &milestone);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Milestone must have either duration or characters"));
    }

    #[test]
    fn test_milestone_writes_require_an_existing_media_uid_without_title_fallback() {
        let conn = setup_test_db();
        add_media_with_id(&conn, &sample_media("Title Must Not Resolve")).unwrap();
        let mut milestone = Milestone {
            id: None,
            media_uid: None,
            media_title: "Title Must Not Resolve".to_string(),
            name: "Checkpoint".to_string(),
            duration: 10,
            characters: 0,
            date: None,
        };

        let missing_uid = add_milestone(&conn, &milestone).unwrap_err().to_string();
        assert!(missing_uid.contains("Milestone must specify a media_uid"));

        milestone.media_uid = Some("does-not-exist".to_string());
        let unknown_uid = add_milestone(&conn, &milestone).unwrap_err().to_string();
        assert!(unknown_uid.contains("Media with uid 'does-not-exist' was not found"));
        assert!(get_all_milestones(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_delete_milestones_for_media() {
        let conn = setup_test_db();
        let title1 = "Media 1";
        let title2 = "Media 2";
        let media1_id = add_media_with_id(&conn, &sample_media(title1)).unwrap();
        let media2_id = add_media_with_id(&conn, &sample_media(title2)).unwrap();
        let media1_uid = media_uid_for_id(&conn, media1_id);
        let media2_uid = media_uid_for_id(&conn, media2_id);

        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media1_uid.clone()),
                media_title: title1.to_string(),
                name: "M1".to_string(),
                duration: 10,
                characters: 0,
                date: None,
            },
        )
        .unwrap();
        add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media2_uid.clone()),
                media_title: title2.to_string(),
                name: "M2".to_string(),
                duration: 20,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        assert_eq!(
            get_milestones_for_media_uid(&conn, &media1_uid)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            get_milestones_for_media_uid(&conn, &media2_uid)
                .unwrap()
                .len(),
            1
        );

        delete_milestones_for_media_uid(&conn, &media1_uid).unwrap();
        assert_eq!(
            get_milestones_for_media_uid(&conn, &media1_uid)
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            get_milestones_for_media_uid(&conn, &media2_uid)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn test_migrate_milestones() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        create_shared_media_table(&conn).unwrap();
        // Create table with only id (simulate old version if it ever missed columns)
        conn.execute(
            "CREATE TABLE main.milestones (id INTEGER PRIMARY KEY AUTOINCREMENT)",
            [],
        )
        .unwrap();

        // This should add the missing columns
        migrate_milestones(&conn).unwrap();
        let media_id = add_media_with_id(&conn, &sample_media("Migrated")).unwrap();

        // Verify we can insert
        let milestone = Milestone {
            id: None,
            media_uid: Some(media_uid_for_id(&conn, media_id)),
            media_title: "Migrated".to_string(),
            name: "Test".to_string(),
            duration: 50,
            characters: 0,
            date: None,
        };
        add_milestone(&conn, &milestone).unwrap();
    }

    #[test]
    fn test_update_log() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Update Test")).unwrap();
        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 30,
            characters: 0,
            date: "2024-01-01".to_string(),
            activity_type: String::new(),
            notes: String::new(),
        };
        let id = add_log(&conn, &log).unwrap();

        let updated_log = ActivityLog {
            id: Some(id),
            media_id,
            duration_minutes: 45,
            characters: 100,
            date: "2024-01-02".to_string(),
            activity_type: "Watching".to_string(),
            notes: String::new(),
        };
        update_log(&conn, &updated_log).unwrap();

        let logs = get_logs_for_media(&conn, media_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].characters, 100);
        assert_eq!(logs[0].date, "2024-01-02");
    }

    #[test]
    fn test_blank_activity_type_is_materialized_when_a_log_is_written() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Materialized Type")).unwrap();

        let log_id = add_log(&conn, &sample_log(media_id, "2024-01-01", "  ")).unwrap();
        let stored_type: String = conn
            .query_row(
                "SELECT activity_type FROM main.activity_logs WHERE id = ?1",
                [log_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_type, "Reading");

        let mut media = get_all_media(&conn).unwrap().remove(0);
        media.default_activity_type = "Watching".to_string();
        update_media(&conn, &media).unwrap();

        let stored_type_after_media_update: String = conn
            .query_row(
                "SELECT activity_type FROM main.activity_logs WHERE id = ?1",
                [log_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_type_after_media_update, "Reading");

        update_log(
            &conn,
            &ActivityLog {
                id: Some(log_id),
                media_id,
                duration_minutes: 30,
                characters: 1200,
                date: "2024-01-01".to_string(),
                activity_type: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();
        let stored_type_after_log_update: String = conn
            .query_row(
                "SELECT activity_type FROM main.activity_logs WHERE id = ?1",
                [log_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_type_after_log_update, "Watching");
    }

    #[test]
    fn test_fresh_db_has_latest_columns_and_is_at_schema_v6() {
        let temp_dir = unique_temp_dir("fresh_v6");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let conn = init_db(temp_dir.clone(), None).unwrap();

        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert_eq!(CURRENT_SCHEMA_VERSION, 6);
        assert!(table_has_column(&conn, "main", "activity_logs", "notes").unwrap());
        assert!(table_has_column(&conn, "shared", "media", "variant").unwrap());
        assert!(table_has_column(&conn, "shared", "media", "default_activity_type").unwrap());
        assert!(!table_has_column(&conn, "shared", "media", "media_type").unwrap());
        assert!(latest_media_identity_constraints_are_present(&conn).unwrap());
        assert!(table_column_is_not_null(&conn, "main", "milestones", "media_uid").unwrap());
        assert!(latest_schema_is_present(&conn).unwrap());
        validate_latest_schema(&conn).unwrap();

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_latest_schema_validation_rejects_a_preexisting_blank_media_title() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO shared.media (
                 uid, title, default_activity_type, status, language, variant
             ) VALUES ('blank-title-uid', ?1, 'Reading', 'Active', 'Japanese', 'Manga')",
            [" \t\u{2003} "],
        )
        .unwrap();

        assert!(!latest_schema_is_present(&conn).unwrap());
        let error = validate_latest_schema(&conn).unwrap_err().to_string();
        assert!(error.contains("Media row 1 has a blank title"));
        assert!(error.contains("stable title/variant identity"));
    }

    #[test]
    fn test_v2_to_v3_migration_adds_notes_column() {
        let temp_dir = unique_temp_dir("notes_v2_to_v3");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let user_db = temp_dir.join("kechimochi_user.db");
        let shared_db = temp_dir.join("kechimochi_shared_media.db");

        // Set up a v2 database (no notes column, schema version 2)
        {
            let conn = Connection::open(&user_db).unwrap();
            conn.execute_batch(
                "PRAGMA user_version = 2;
                 CREATE TABLE main.activity_logs (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     media_id INTEGER NOT NULL,
                     duration_minutes INTEGER NOT NULL,
                     characters INTEGER NOT NULL DEFAULT 0,
                     date TEXT NOT NULL,
                     activity_type TEXT NOT NULL DEFAULT ''
                 );
                 CREATE TABLE main.milestones (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     media_uid TEXT,
                     media_title TEXT NOT NULL DEFAULT '',
                     name TEXT NOT NULL DEFAULT '',
                     duration INTEGER NOT NULL DEFAULT 0,
                     characters INTEGER NOT NULL DEFAULT 0,
                     date TEXT
                 );
                 CREATE TABLE main.settings (
                     key TEXT PRIMARY KEY,
                     value TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT ''
                 );
                 CREATE TABLE main.profile_picture (
                     id INTEGER PRIMARY KEY CHECK (id = 1),
                     mime_type TEXT NOT NULL,
                     base64_data TEXT NOT NULL,
                     byte_size INTEGER NOT NULL,
                     width INTEGER NOT NULL,
                     height INTEGER NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                 INSERT INTO main.activity_logs (media_id, duration_minutes, characters, date, activity_type)
                     VALUES (1, 60, 0, '2024-01-01', 'Reading');",
            )
            .unwrap();
        }
        {
            let conn = Connection::open(&shared_db).unwrap();
            conn.execute_batch(
                "PRAGMA user_version = 2;
                 CREATE TABLE main.media (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     uid TEXT,
                     title TEXT NOT NULL UNIQUE,
                     media_type TEXT NOT NULL,
                     status TEXT NOT NULL,
                     language TEXT NOT NULL,
                     description TEXT DEFAULT '',
                     cover_image TEXT DEFAULT '',
                     extra_data TEXT DEFAULT '{}',
                     content_type TEXT DEFAULT 'Unknown',
                     tracking_status TEXT DEFAULT 'Untracked',
                     updated_at TEXT DEFAULT '',
                     updated_by_device_id TEXT DEFAULT ''
                 );
                 INSERT INTO main.media (id, uid, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status, updated_at, updated_by_device_id)
                     VALUES (1, 'test-uid-1', 'Pre-existing Media', 'Reading', 'Active', 'Japanese', '', '', '{}', 'Novel', 'Ongoing', '', '');",
            )
            .unwrap();
        }

        let conn = init_db(temp_dir.clone(), None).unwrap();

        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert!(table_has_column(&conn, "main", "activity_logs", "notes").unwrap());
        assert!(table_has_column(&conn, "shared", "media", "variant").unwrap());

        // Pre-existing row should have empty notes
        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "");
        assert_eq!(logs[0].duration_minutes, 60);
        let media = get_all_media(&conn).unwrap();
        assert_eq!(media[0].variant, "");

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_no_op_startup_on_v6_db_stays_at_v6() {
        let temp_dir = unique_temp_dir("noop_v6");
        std::fs::create_dir_all(&temp_dir).unwrap();

        // First init creates the DB at v6.
        let conn1 = init_db(temp_dir.clone(), None).unwrap();
        let media_id = add_media_with_id(&conn1, &sample_media("No-op Media")).unwrap();
        add_log(
            &conn1,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 20,
                characters: 0,
                date: "2024-05-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "persistent note".to_string(),
            },
        )
        .unwrap();
        drop(conn1);

        // Second init should be a no-op
        let conn2 = init_db(temp_dir.clone(), None).unwrap();
        assert_eq!(get_bundle_schema_version(&conn2).unwrap(), 6);

        let logs = get_logs(&conn2).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "persistent note");

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_v3_to_v4_migration_adds_variant_without_changing_existing_media() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL UNIQUE
             );
             INSERT INTO shared.media (title) VALUES ('Horimiya');",
        )
        .unwrap();

        migrate_v3_to_v4_add_media_variant(&conn).unwrap();

        assert!(table_has_column(&conn, "shared", "media", "variant").unwrap());
        let (title, variant): (String, String) = conn
            .query_row(
                "SELECT title, variant FROM shared.media WHERE title = 'Horimiya'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Horimiya");
        assert_eq!(variant, "");
    }

    #[test]
    fn test_v3_database_migrates_sequentially_to_v6_without_losing_relations() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL UNIQUE,
                 media_type TEXT NOT NULL,
                 status TEXT NOT NULL,
                 language TEXT NOT NULL,
                 description TEXT DEFAULT '',
                 cover_image TEXT DEFAULT '',
                 extra_data TEXT DEFAULT '{}',
                 content_type TEXT DEFAULT 'Unknown',
                 tracking_status TEXT DEFAULT 'Untracked'
             );
             CREATE TABLE main.activity_logs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_id INTEGER NOT NULL,
                 duration_minutes INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT NOT NULL,
                 activity_type TEXT NOT NULL DEFAULT '',
                 notes TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE main.milestones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_uid TEXT,
                 media_title TEXT NOT NULL,
                 name TEXT NOT NULL,
                 duration INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT
             );
             CREATE TABLE main.settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE main.profile_picture (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 mime_type TEXT NOT NULL,
                 base64_data TEXT NOT NULL,
                 byte_size INTEGER NOT NULL,
                 width INTEGER NOT NULL,
                 height INTEGER NOT NULL,
                 updated_at TEXT NOT NULL
             );
             INSERT INTO shared.media (
                 id, uid, title, media_type, status, language, description,
                 cover_image, extra_data, content_type, tracking_status
             ) VALUES (
                 12, 'v3-stable-uid', 'V3 Media', 'Reading', 'Active', 'Japanese',
                 'preserved description', '', '{}', 'Novel', 'Ongoing'
             );
             INSERT INTO main.activity_logs (
                 id, media_id, duration_minutes, characters, date, activity_type, notes
             ) VALUES (
                 21, 12, 45, 1800, '2026-07-20', 'Reading', 'preserved v3 note'
             );
             INSERT INTO main.milestones (
                 id, media_uid, media_title, name, duration, characters, date
             ) VALUES (
                 34, NULL, 'V3 Media', 'Legacy v3 checkpoint', 45, 1800, '2026-07-20'
             );",
        )
        .unwrap();
        set_bundle_schema_version(&conn, 3).unwrap();

        migrate_schema(&conn).unwrap();

        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 6);
        assert!(latest_media_identity_constraints_are_present(&conn).unwrap());
        assert!(table_column_is_not_null(&conn, "main", "milestones", "media_uid").unwrap());

        let media = get_all_media(&conn).unwrap().remove(0);
        assert_eq!(media.id, Some(12));
        assert_eq!(media.uid.as_deref(), Some("v3-stable-uid"));
        assert_eq!(media.title, "V3 Media");
        assert_eq!(media.variant, "");
        assert_eq!(media.default_activity_type, "Reading");
        assert_eq!(media.description, "preserved description");

        let logs = get_logs_for_media(&conn, 12).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, Some(21));
        assert_eq!(logs[0].activity_type, "Reading");
        assert_eq!(logs[0].notes, "preserved v3 note");

        let milestones = get_milestones_for_media_uid(&conn, "v3-stable-uid").unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].id, Some(34));
        assert_eq!(milestones[0].media_uid.as_deref(), Some("v3-stable-uid"));

        add_media_with_id(
            &conn,
            &Media {
                uid: Some("v6-second-variant".to_string()),
                variant: "Audiobook".to_string(),
                ..sample_media("V3 Media")
            },
        )
        .unwrap();
        assert!(add_media_with_id(
            &conn,
            &Media {
                uid: Some("v6-duplicate-empty-variant".to_string()),
                ..sample_media("V3 Media")
            },
        )
        .is_err());
    }

    #[test]
    fn test_v4_to_v5_migration_materializes_activity_types_and_renames_media_column() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        create_tables(&conn).unwrap();
        conn.execute(
            "ALTER TABLE shared.media
             RENAME COLUMN default_activity_type TO media_type",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO shared.media (
                 id, uid, title, media_type, status, language, variant
             ) VALUES
                 (1, 'uid-reading', 'Reading Default', 'Reading', 'Active', 'Japanese', ''),
                 (2, 'uid-blank', 'Blank Default', '   ', 'Active', 'Japanese', '');
             INSERT INTO main.activity_logs (
                 id, media_id, duration_minutes, characters, date, activity_type, notes
             ) VALUES
                 (1, 1, 30, 0, '2024-01-01', '', ''),
                 (2, 1, 30, 0, '2024-01-02', 'Watching', ''),
                 (3, 2, 30, 0, '2024-01-03', '  ', ''),
                 (4, 999, 30, 0, '2024-01-04', '', 'orphan'),
                 (5, 1, 30, 0, '2024-01-05', ' Studying ', '');",
        )
        .unwrap();
        set_bundle_schema_version(&conn, 4).unwrap();

        migrate_schema(&conn).unwrap();

        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 6);
        assert!(table_has_column(&conn, "shared", "media", "default_activity_type").unwrap());
        assert!(!table_has_column(&conn, "shared", "media", "media_type").unwrap());

        let media_types: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, default_activity_type FROM shared.media ORDER BY id")
                .unwrap();
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            media_types,
            vec![(1, "Reading".to_string()), (2, "None".to_string())]
        );

        let activity_types: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, activity_type FROM main.activity_logs ORDER BY id")
                .unwrap();
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            activity_types,
            vec![
                (1, "Reading".to_string()),
                (2, "Watching".to_string()),
                (3, "None".to_string()),
                (4, "None".to_string()),
                (5, " Studying ".to_string()),
            ]
        );

        let mut media = get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|media| media.id == Some(1))
            .unwrap();
        media.default_activity_type = "Playing".to_string();
        update_media(&conn, &media).unwrap();
        let historical_activity_type: String = conn
            .query_row(
                "SELECT activity_type FROM main.activity_logs WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(historical_activity_type, "Reading");
    }

    #[test]
    fn test_v5_to_v6_migration_preserves_media_and_relations_and_replaces_title_uniqueness() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL UNIQUE,
                 default_activity_type TEXT NOT NULL,
                 status TEXT NOT NULL,
                 language TEXT NOT NULL,
                 description TEXT DEFAULT '',
                 cover_image TEXT DEFAULT '',
                 extra_data TEXT DEFAULT '{}',
                 content_type TEXT DEFAULT 'Unknown',
                 tracking_status TEXT DEFAULT 'Untracked',
                 variant TEXT NOT NULL DEFAULT ''
             );",
        )
        .unwrap();
        create_activity_logs_table(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE main.milestones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_uid TEXT,
                 media_title TEXT NOT NULL,
                 name TEXT NOT NULL,
                 duration INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT
             );",
        )
        .unwrap();
        create_settings_table(&conn).unwrap();
        create_profile_picture_table(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, description,
                 cover_image, extra_data, content_type, tracking_status, variant
             ) VALUES (
                 42, 'stable-uid', 'Horimiya', 'Watching', 'Active', 'Japanese',
                 'preserved description', '/tmp/preserved-cover.png', '{\"key\":\"value\"}',
                 'Anime', 'Complete', '  Anime  '
             );
             INSERT INTO main.activity_logs (
                 id, media_id, duration_minutes, characters, date, activity_type, notes
             ) VALUES (7, 42, 25, 321, '2026-01-02', 'Watching', 'preserved note');
             INSERT INTO main.milestones (
                 id, media_uid, media_title, name, duration, characters, date
             ) VALUES
                 (9, 'stable-uid', 'Stale display title', 'Episode 6', 150, 0, '2026-01-02'),
                 (10, NULL, 'Horimiya', 'Legacy title-only milestone', 175, 0, '2026-01-03');",
        )
        .unwrap();
        set_bundle_schema_version(&conn, 5).unwrap();

        migrate_schema(&conn).unwrap();

        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 6);
        assert!(latest_media_identity_constraints_are_present(&conn).unwrap());
        let migrated = get_all_media(&conn).unwrap().remove(0);
        assert_eq!(migrated.id, Some(42));
        assert_eq!(migrated.uid.as_deref(), Some("stable-uid"));
        assert_eq!(migrated.title, "Horimiya");
        assert_eq!(migrated.variant, "Anime");
        assert_eq!(migrated.default_activity_type, "Watching");
        assert_eq!(migrated.status, "Active");
        assert_eq!(migrated.language, "Japanese");
        assert_eq!(migrated.description, "preserved description");
        assert_eq!(migrated.cover_image, "/tmp/preserved-cover.png");
        assert_eq!(migrated.extra_data, "{\"key\":\"value\"}");
        assert_eq!(migrated.content_type, "Anime");
        assert_eq!(migrated.tracking_status, "Complete");

        let logs = get_logs_for_media(&conn, 42).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, Some(7));
        assert_eq!(logs[0].notes, "preserved note");
        let milestones = get_milestones_for_media_uid(&conn, "stable-uid").unwrap();
        assert_eq!(milestones.len(), 2);
        assert_eq!(milestones[0].id, Some(9));
        assert_eq!(milestones[0].media_title, "Horimiya");
        assert_eq!(milestones[1].id, Some(10));
        assert_eq!(milestones[1].media_uid.as_deref(), Some("stable-uid"));
        assert!(table_column_is_not_null(&conn, "main", "milestones", "media_uid").unwrap());

        let manga_id = add_media_with_id(
            &conn,
            &Media {
                uid: Some("different-uid".to_string()),
                variant: "Manga".to_string(),
                ..sample_media("Horimiya")
            },
        )
        .unwrap();
        assert!(manga_id > 42);
        let duplicate = add_media_with_id(
            &conn,
            &Media {
                uid: Some("third-uid".to_string()),
                variant: "Anime".to_string(),
                ..sample_media("Horimiya")
            },
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn test_v5_to_v6_migration_rejects_variant_trim_collision_atomically() {
        let conn = setup_test_db();
        conn.execute("DROP TABLE shared.media", []).unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL,
                 default_activity_type TEXT NOT NULL,
                 status TEXT NOT NULL,
                 language TEXT NOT NULL,
                 description TEXT DEFAULT '',
                 cover_image TEXT DEFAULT '',
                 extra_data TEXT DEFAULT '{}',
                 content_type TEXT DEFAULT 'Unknown',
                 tracking_status TEXT DEFAULT 'Untracked',
                 variant TEXT NOT NULL DEFAULT ''
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, variant
             ) VALUES (1, 'uid-a', 'Collision', 'Reading', 'Active', 'Japanese', ?1)",
            ["Manga"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, variant
             ) VALUES (2, 'uid-b', 'Collision', 'Reading', 'Active', 'Japanese', ?1)",
            ["\u{2003}Manga\u{2003}"],
        )
        .unwrap();
        set_bundle_schema_version(&conn, 5).unwrap();

        let error = migrate_schema(&conn).unwrap_err().to_string();

        assert!(error.contains("Cannot normalize legacy media variants"));
        assert!(error.contains("rows 1 and 2"));
        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 5);
        let variants: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT variant FROM shared.media ORDER BY id ASC")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(variants, vec!["Manga", "\u{2003}Manga\u{2003}"]);
        assert!(!table_exists(&conn, "shared", "media_v6_new").unwrap());
    }

    #[test]
    fn test_v5_to_v6_migration_rejects_blank_title_without_any_changes() {
        let conn = setup_test_db();
        conn.execute("DROP TABLE shared.media", []).unwrap();
        conn.execute("DROP TABLE main.milestones", []).unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL UNIQUE,
                 default_activity_type TEXT NOT NULL,
                 status TEXT NOT NULL,
                 language TEXT NOT NULL,
                 description TEXT DEFAULT '',
                 cover_image TEXT DEFAULT '',
                 extra_data TEXT DEFAULT '{}',
                 content_type TEXT DEFAULT 'Unknown',
                 tracking_status TEXT DEFAULT 'Untracked',
                 variant TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE main.milestones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_uid TEXT,
                 media_title TEXT NOT NULL,
                 name TEXT NOT NULL,
                 duration INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT
             );
             INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, variant
             ) VALUES (1, 'valid-uid', 'Valid title', 'Reading', 'Active', 'Japanese', '  Manga  ');
             INSERT INTO main.milestones (
                 id, media_uid, media_title, name, duration, characters
             ) VALUES (7, NULL, 'Valid title', 'Unchanged milestone', 30, 0);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, variant
             ) VALUES (2, 'blank-uid', ?1, 'Reading', 'Active', 'Japanese', ' Anime ')",
            [" \t\u{2003} "],
        )
        .unwrap();
        set_bundle_schema_version(&conn, 5).unwrap();

        let media_schema_before: String = conn
            .query_row(
                "SELECT sql FROM shared.sqlite_master WHERE type = 'table' AND name = 'media'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let milestones_schema_before: String = conn
            .query_row(
                "SELECT sql FROM main.sqlite_master WHERE type = 'table' AND name = 'milestones'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let error = migrate_schema(&conn).unwrap_err().to_string();

        assert!(error.contains("Media row 2 has a blank title"));
        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 5);
        assert_eq!(
            conn.query_row(
                "SELECT sql FROM shared.sqlite_master WHERE type = 'table' AND name = 'media'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            media_schema_before
        );
        assert_eq!(
            conn.query_row(
                "SELECT sql FROM main.sqlite_master WHERE type = 'table' AND name = 'milestones'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            milestones_schema_before
        );
        let variants: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT variant FROM shared.media ORDER BY id ASC")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(variants, vec!["  Manga  ", " Anime "]);
        let milestone_link: Option<String> = conn
            .query_row(
                "SELECT media_uid FROM main.milestones WHERE id = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(milestone_link, None);
        assert!(!table_exists(&conn, "shared", "media_v6_new").unwrap());
        assert!(!table_exists(&conn, "main", "milestones_v6_new").unwrap());
    }

    #[test]
    fn test_v5_to_v6_migration_rejects_an_unresolvable_milestone_atomically() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        conn.execute_batch(
            "CREATE TABLE shared.media (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL UNIQUE,
                 default_activity_type TEXT NOT NULL,
                 status TEXT NOT NULL,
                 language TEXT NOT NULL,
                 description TEXT DEFAULT '',
                 cover_image TEXT DEFAULT '',
                 extra_data TEXT DEFAULT '{}',
                 content_type TEXT DEFAULT 'Unknown',
                 tracking_status TEXT DEFAULT 'Untracked',
                 variant TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE main.activity_logs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_id INTEGER NOT NULL,
                 duration_minutes INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT NOT NULL,
                 activity_type TEXT NOT NULL DEFAULT '',
                 notes TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE main.milestones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 media_uid TEXT,
                 media_title TEXT NOT NULL,
                 name TEXT NOT NULL,
                 duration INTEGER NOT NULL,
                 characters INTEGER NOT NULL DEFAULT 0,
                 date TEXT
             );
             CREATE TABLE main.settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE main.profile_picture (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 mime_type TEXT NOT NULL,
                 base64_data TEXT NOT NULL,
                 byte_size INTEGER NOT NULL,
                 width INTEGER NOT NULL,
                 height INTEGER NOT NULL,
                 updated_at TEXT NOT NULL
             );
             INSERT INTO shared.media (
                 uid, title, default_activity_type, status, language, variant
             ) VALUES ('known-uid', 'Known Media', 'Reading', 'Active', 'Japanese', '');
             INSERT INTO main.milestones (
                 media_uid, media_title, name, duration, characters
             ) VALUES (NULL, 'Missing Media', 'Orphan checkpoint', 60, 0);",
        )
        .unwrap();
        set_bundle_schema_version(&conn, 5).unwrap();

        let error = migrate_schema(&conn).unwrap_err().to_string();

        assert!(error.contains("Orphan checkpoint"));
        assert!(error.contains("not linked to an existing media UID"));
        assert_eq!(get_bundle_schema_version(&conn).unwrap(), 5);
        assert!(table_has_unique_index_on_columns(&conn, "shared", "media", &["title"]).unwrap());
        assert!(!table_column_is_not_null(&conn, "main", "milestones", "media_uid").unwrap());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM main.milestones", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn test_notes_are_saved_and_retrieved_via_add_update_log() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Notes CRUD")).unwrap();

        // Add a log with notes
        let log_id = add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-06-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "My first note".to_string(),
            },
        )
        .unwrap();

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "My first note");

        let logs_for_media = get_logs_for_media(&conn, media_id).unwrap();
        assert_eq!(logs_for_media[0].notes, "My first note");

        // Update to a different note
        update_log(
            &conn,
            &ActivityLog {
                id: Some(log_id),
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-06-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "Updated note".to_string(),
            },
        )
        .unwrap();

        let updated_logs = get_logs(&conn).unwrap();
        assert_eq!(updated_logs[0].notes, "Updated note");
    }

    #[test]
    fn test_legacy_unversioned_upgrade_gains_notes_column() {
        let temp_dir = unique_temp_dir("notes_legacy_upgrade");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let user_db = temp_dir.join("kechimochi_user.db");
        let shared_db = temp_dir.join("kechimochi_shared_media.db");

        // Legacy DB layout: old-style main.media + activity_logs without notes
        {
            let legacy_conn = Connection::open(&user_db).unwrap();
            legacy_conn
                .execute(
                    "CREATE TABLE media (
                        id INTEGER PRIMARY KEY,
                        title TEXT,
                        media_type TEXT,
                        status TEXT,
                        language TEXT
                    )",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "INSERT INTO media (id, title, media_type, status, language)
                     VALUES (1, 'Legacy Notes Media', 'Reading', 'Ongoing', 'Japanese')",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "CREATE TABLE activity_logs (
                        id INTEGER PRIMARY KEY,
                        media_id INTEGER,
                        duration_minutes INTEGER,
                        date TEXT
                    )",
                    [],
                )
                .unwrap();
            legacy_conn
                .execute(
                    "INSERT INTO activity_logs (id, media_id, duration_minutes, date)
                     VALUES (1, 1, 90, '2024-03-01')",
                    [],
                )
                .unwrap();
        }
        Connection::open(&shared_db).unwrap();

        let conn = init_db(temp_dir.clone(), None).unwrap();
        assert_eq!(
            get_bundle_schema_version(&conn).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert!(table_has_column(&conn, "main", "activity_logs", "notes").unwrap());

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Legacy Notes Media");
        assert_eq!(logs[0].notes, "");

        std::fs::remove_dir_all(temp_dir).ok();
    }
}

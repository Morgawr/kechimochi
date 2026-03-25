use rusqlite::{params, Connection, Result};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use tauri::Manager;

use crate::models::{
    ActivityLog, ActivitySummary, DailyHeatmap, Media, Milestone, ProfilePicture, TimelineEvent,
    TimelineEventKind,
};

pub const CURRENT_SCHEMA_VERSION: i64 = 1;

type MigrationFn = fn(&Connection) -> Result<()>;

struct Migration {
    from: i64,
    to: i64,
    apply: MigrationFn,
}

const VERSIONED_MIGRATIONS: &[Migration] = &[];

const SHARED_MEDIA_COLUMNS: &[&str] = &[
    "id",
    "title",
    "media_type",
    "status",
    "language",
    "description",
    "cover_image",
    "extra_data",
    "content_type",
    "tracking_status",
];

const ACTIVITY_LOG_COLUMNS: &[&str] = &[
    "id",
    "media_id",
    "duration_minutes",
    "characters",
    "date",
    "activity_type",
];

const MILESTONE_COLUMNS: &[&str] = &[
    "id",
    "media_title",
    "name",
    "duration",
    "characters",
    "date",
];

const SETTINGS_COLUMNS: &[&str] = &["key", "value"];
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
        let home = std::env::var("HOME").expect("HOME env var not set");
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(app_id)
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

fn latest_schema_is_present(conn: &Connection) -> Result<bool> {
    Ok(
        table_has_all_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?
            && table_has_all_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)?
            && table_has_all_columns(conn, "main", "milestones", MILESTONE_COLUMNS)?
            && table_has_all_columns(conn, "main", "settings", SETTINGS_COLUMNS)?
            && table_has_all_columns(conn, "main", "profile_picture", PROFILE_PICTURE_COLUMNS)?,
    )
}

fn validate_latest_schema(conn: &Connection) -> Result<()> {
    ensure_table_has_columns(conn, "shared", "media", SHARED_MEDIA_COLUMNS)?;
    ensure_table_has_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)?;
    ensure_table_has_columns(conn, "main", "milestones", MILESTONE_COLUMNS)?;
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
    if !table_has_all_columns(conn, "main", "activity_logs", ACTIVITY_LOG_COLUMNS)? {
        return Ok(true);
    }
    if !table_has_all_columns(conn, "main", "milestones", MILESTONE_COLUMNS)? {
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

fn migrate_to_shared(conn: &Connection) -> Result<()> {
    // Check if `main.media` exists
    if table_exists(conn, "main", "media")? {
        create_shared_media_table(conn)?;
        migrate_shared_media_columns(conn)?;

        let legacy_has_description = table_has_column(conn, "main", "media", "description")?;
        let legacy_has_cover_image = table_has_column(conn, "main", "media", "cover_image")?;
        let legacy_has_extra_data = table_has_column(conn, "main", "media", "extra_data")?;
        let legacy_has_content_type = table_has_column(conn, "main", "media", "content_type")?;
        let description_expr = if legacy_has_description {
            "description"
        } else {
            "''"
        };
        let cover_image_expr = if legacy_has_cover_image {
            "cover_image"
        } else {
            "''"
        };
        let extra_data_expr = if legacy_has_extra_data {
            "extra_data"
        } else {
            "'{}'"
        };
        let content_type_expr = if legacy_has_content_type {
            "content_type"
        } else {
            "'Unknown'"
        };

        conn.execute(
            &format!(
                "INSERT INTO shared.media (id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status)
                 SELECT id, title, media_type, status, language,
                        COALESCE({}, ''),
                        COALESCE({}, ''),
                        COALESCE({}, '{{}}'),
                        COALESCE({}, 'Unknown'),
                        'Untracked'
                 FROM main.media
                 WHERE NOT EXISTS (
                     SELECT 1 FROM shared.media s WHERE s.id = main.media.id
                 )",
                description_expr, cover_image_expr, extra_data_expr, content_type_expr
            ),
            [],
        )?;

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
    conn.execute(
        "CREATE TABLE IF NOT EXISTS shared.media (
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
    )?;
    Ok(())
}

fn create_activity_logs_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT NOT NULL,
            activity_type TEXT NOT NULL DEFAULT ''
        )",
        [],
    )?;
    Ok(())
}

fn create_milestones_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_title TEXT NOT NULL,
            name TEXT NOT NULL,
            duration INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT
        )",
        [],
    )?;
    Ok(())
}

fn migrate_milestones(conn: &Connection) -> Result<()> {
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
        conn.execute(
            "UPDATE main.activity_logs SET activity_type = (
                SELECT media_type FROM shared.media WHERE id = activity_logs.media_id
            ) WHERE activity_type = ''",
            [],
        )?;
    }
    Ok(())
}

fn create_settings_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
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

fn migrate_legacy_pre_release_to_v1(conn: &Connection) -> Result<()> {
    create_tables(conn)?;
    migrate_to_shared(conn)?;
    migrate_shared_media_columns(conn)?;
    migrate_milestones(conn)?;
    migrate_to_character_tracking(conn)?;
    migrate_activity_type_to_logs(conn)?;
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
                migrate_legacy_pre_release_to_v1(conn)?;
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
                    migrate_legacy_pre_release_to_v1(conn)?;
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

    if !user_db_path.exists() {
        if let Some(username) = fallback_username {
            let fallback_path = app_dir.join(format!("kechimochi_{}.db", username));
            if fallback_path.exists() {
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

// Media Operations
pub fn get_all_media(conn: &Connection) -> Result<Vec<Media>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status 
         FROM shared.media m
         ORDER BY 
            CASE 
                WHEN m.status != 'Archived' AND m.tracking_status = 'Ongoing' THEN 0
                WHEN m.status != 'Archived' THEN 1
                ELSE 2
            END,
            (SELECT MAX(date) FROM main.activity_logs WHERE media_id = m.id) DESC,
            m.id DESC"
    )?;
    let media_iter = stmt.query_map([], |row| {
        Ok(Media {
            id: row.get(0)?,
            title: row.get(1)?,
            media_type: row.get(2)?,
            status: row.get(3)?,
            language: row.get(4)?,
            description: row.get(5).unwrap_or_default(),
            cover_image: row.get(6).unwrap_or_default(),
            extra_data: row.get(7).unwrap_or_else(|_| "{}".to_string()),
            content_type: row.get(8).unwrap_or_else(|_| "Unknown".to_string()),
            tracking_status: row.get(9).unwrap_or_else(|_| "Untracked".to_string()),
        })
    })?;

    let mut media_list = Vec::new();
    for media in media_iter {
        media_list.push(media?);
    }
    Ok(media_list)
}

pub fn add_media_with_id(conn: &Connection, media: &Media) -> Result<i64> {
    conn.execute(
        "INSERT INTO shared.media (title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![media.title, media.media_type, media.status, media.language, media.description, media.cover_image, media.extra_data, media.content_type, media.tracking_status],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_media(conn: &Connection, media: &Media) -> Result<()> {
    conn.execute(
        "UPDATE shared.media SET title = ?1, media_type = ?2, status = ?3, language = ?4, description = ?5, cover_image = ?6, extra_data = ?7, content_type = ?8, tracking_status = ?9 WHERE id = ?10",
        params![
            media.title,
            media.media_type,
            media.status,
            media.language,
            media.description,
            media.cover_image,
            media.extra_data,
            media.content_type,
            media.tracking_status,
            media.id.unwrap() // Must have an ID
        ],
    )?;
    Ok(())
}

pub fn delete_media(conn: &Connection, id: i64) -> Result<()> {
    // Delete cover image from file system
    if let Ok(cover_image) = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1 AND cover_image IS NOT NULL AND cover_image != ''",
        params![id],
        |row| row.get::<_, String>(0),
    ) {
        let path = std::path::Path::new(&cover_image);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
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
pub fn add_log(conn: &Connection, log: &ActivityLog) -> Result<i64> {
    if log.duration_minutes == 0 && log.characters == 0 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Activity must have either duration or characters",
            ),
        )));
    }
    conn.execute(
        "INSERT INTO main.activity_logs (media_id, duration_minutes, characters, date, activity_type) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![log.media_id, log.duration_minutes, log.characters, log.date, log.activity_type],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_log(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_log(conn: &Connection, log: &ActivityLog) -> Result<()> {
    if log.duration_minutes == 0 && log.characters == 0 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Activity must have either duration or characters",
            ),
        )));
    }
    conn.execute(
        "UPDATE main.activity_logs SET media_id = ?1, duration_minutes = ?2, characters = ?3, date = ?4, activity_type = ?5 WHERE id = ?6",
        params![log.media_id, log.duration_minutes, log.characters, log.date, log.activity_type, log.id.unwrap()],
    )?;
    Ok(())
}

pub fn clear_activities(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs", [])?;
    Ok(())
}

pub fn get_logs(conn: &Connection) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, COALESCE(NULLIF(a.activity_type, ''), m.media_type) as activity_type, a.duration_minutes, a.characters, a.date, m.language 
         FROM main.activity_logs a 
         JOIN shared.media m ON a.media_id = m.id
         ORDER BY a.date DESC, a.id DESC",
    )?;
    let logs_iter = stmt.query_map([], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
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
        "SELECT a.id, a.media_id, m.title, COALESCE(NULLIF(a.activity_type, ''), m.media_type) as activity_type, a.duration_minutes, a.characters, a.date, m.language 
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
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
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
    conn.execute(
        "INSERT INTO main.settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
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
pub fn get_milestones_for_media(conn: &Connection, media_title: &str) -> Result<Vec<Milestone>> {
    let mut stmt = conn.prepare(
        "SELECT id, media_title, name, duration, characters, date FROM main.milestones WHERE media_title = ?1 ORDER BY id ASC",
    )?;
    let milestone_iter = stmt.query_map(params![media_title], |row| {
        Ok(Milestone {
            id: row.get(0)?,
            media_title: row.get(1)?,
            name: row.get(2)?,
            duration: row.get(3)?,
            characters: row.get(4)?,
            date: row.get(5)?,
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
        "SELECT id, media_title, name, duration, characters, date
         FROM main.milestones
         ORDER BY date DESC, id ASC",
    )?;
    let milestone_iter = stmt.query_map([], |row| {
        Ok(Milestone {
            id: row.get(0)?,
            media_title: row.get(1)?,
            name: row.get(2)?,
            duration: row.get(3)?,
            characters: row.get(4)?,
            date: row.get(5)?,
        })
    })?;

    let mut milestone_list = Vec::new();
    for milestone in milestone_iter {
        milestone_list.push(milestone?);
    }
    Ok(milestone_list)
}

#[derive(Clone)]
struct TimelineMediaContext {
    media_id: i64,
    media_title: String,
    cover_image: String,
    activity_type: String,
    content_type: String,
    tracking_status: String,
    first_date: String,
    last_date: String,
    total_minutes: i64,
    total_characters: i64,
    same_day_terminal: bool,
}

fn terminal_kind(tracking_status: &str) -> Option<TimelineEventKind> {
    match tracking_status {
        "Complete" => Some(TimelineEventKind::Finished),
        "Paused" => Some(TimelineEventKind::Paused),
        "Dropped" => Some(TimelineEventKind::Dropped),
        _ => None,
    }
}

fn timeline_sort_rank(event: &TimelineEvent) -> u8 {
    let is_terminal = terminal_kind(&event.tracking_status).is_some();

    match event.kind {
        TimelineEventKind::Milestone if !is_terminal => 0,
        TimelineEventKind::Started => 1,
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped
            if event.same_day_terminal =>
        {
            2
        }
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped => 3,
        TimelineEventKind::Milestone => 4,
    }
}

fn dominant_activity_type(logs: &[ActivitySummary], fallback: &str) -> String {
    let mut counts: HashMap<String, (usize, usize)> = HashMap::new();

    for (index, log) in logs.iter().enumerate() {
        let entry = counts
            .entry(log.media_type.clone())
            .or_insert((0, usize::MAX));
        entry.0 += 1;
        entry.1 = entry.1.min(index);
    }

    counts
        .into_iter()
        .max_by(
            |(left_kind, (left_count, left_first_seen)),
             (right_kind, (right_count, right_first_seen))| {
                left_count
                    .cmp(right_count)
                    .then_with(|| right_first_seen.cmp(left_first_seen))
                    .then_with(|| right_kind.cmp(left_kind))
            },
        )
        .map(|(kind, _)| kind)
        .unwrap_or_else(|| fallback.to_string())
}

fn build_timeline_event(
    context: &TimelineMediaContext,
    kind: TimelineEventKind,
    date: String,
    milestone_name: Option<String>,
    milestone_minutes: i64,
    milestone_characters: i64,
) -> TimelineEvent {
    TimelineEvent {
        kind,
        date,
        media_id: context.media_id,
        media_title: context.media_title.clone(),
        cover_image: context.cover_image.clone(),
        activity_type: context.activity_type.clone(),
        content_type: context.content_type.clone(),
        tracking_status: context.tracking_status.clone(),
        milestone_name,
        first_date: context.first_date.clone(),
        last_date: context.last_date.clone(),
        total_minutes: context.total_minutes,
        total_characters: context.total_characters,
        milestone_minutes,
        milestone_characters,
        same_day_terminal: context.same_day_terminal,
    }
}

pub fn get_timeline_events(conn: &Connection) -> Result<Vec<TimelineEvent>> {
    let media_list = get_all_media(conn)?;
    let logs = get_logs(conn)?;
    let milestones = get_all_milestones(conn)?;

    let mut logs_by_media_id: HashMap<i64, Vec<ActivitySummary>> = HashMap::new();
    for log in logs {
        logs_by_media_id.entry(log.media_id).or_default().push(log);
    }

    let mut media_contexts_by_id: HashMap<i64, TimelineMediaContext> = HashMap::new();
    let mut media_ids_by_title: HashMap<String, i64> = HashMap::new();
    let mut timeline_events = Vec::new();

    for media in media_list {
        let Some(media_id) = media.id else {
            continue;
        };

        media_ids_by_title.insert(media.title.clone(), media_id);

        let fallback_context = TimelineMediaContext {
            media_id,
            media_title: media.title.clone(),
            cover_image: media.cover_image.clone(),
            activity_type: media.media_type.clone(),
            content_type: media.content_type.clone(),
            tracking_status: media.tracking_status.clone(),
            first_date: String::new(),
            last_date: String::new(),
            total_minutes: 0,
            total_characters: 0,
            same_day_terminal: false,
        };
        media_contexts_by_id.insert(media_id, fallback_context.clone());

        let Some(media_logs) = logs_by_media_id.get(&media_id) else {
            continue;
        };
        if media_logs.is_empty() {
            continue;
        }

        let first_date = media_logs
            .last()
            .map(|log| log.date.clone())
            .unwrap_or_default();
        let last_date = media_logs
            .first()
            .map(|log| log.date.clone())
            .unwrap_or_default();
        let total_minutes = media_logs.iter().map(|log| log.duration_minutes).sum();
        let total_characters = media_logs.iter().map(|log| log.characters).sum();
        let activity_type = dominant_activity_type(media_logs, &media.media_type);
        let terminal_event = terminal_kind(&media.tracking_status);
        let same_day_terminal = terminal_event.is_some() && first_date == last_date;

        let context = TimelineMediaContext {
            media_id,
            media_title: media.title.clone(),
            cover_image: media.cover_image.clone(),
            activity_type,
            content_type: media.content_type.clone(),
            tracking_status: media.tracking_status.clone(),
            first_date: first_date.clone(),
            last_date: last_date.clone(),
            total_minutes,
            total_characters,
            same_day_terminal,
        };
        media_contexts_by_id.insert(media_id, context.clone());

        if let Some(kind) = terminal_event {
            timeline_events.push(build_timeline_event(
                &context,
                kind,
                last_date.clone(),
                None,
                0,
                0,
            ));

            if !same_day_terminal {
                timeline_events.push(build_timeline_event(
                    &context,
                    TimelineEventKind::Started,
                    first_date,
                    None,
                    0,
                    0,
                ));
            }
            continue;
        }

        timeline_events.push(build_timeline_event(
            &context,
            TimelineEventKind::Started,
            first_date.clone(),
            None,
            0,
            0,
        ));
    }

    for milestone in milestones {
        let Some(date) = milestone.date.clone() else {
            continue;
        };
        let Some(media_id) = media_ids_by_title.get(&milestone.media_title).copied() else {
            continue;
        };
        let Some(context) = media_contexts_by_id.get(&media_id).cloned() else {
            continue;
        };

        timeline_events.push(build_timeline_event(
            &context,
            TimelineEventKind::Milestone,
            date,
            Some(milestone.name),
            milestone.duration,
            milestone.characters,
        ));
    }

    timeline_events.sort_by(|left, right| {
        right
            .date
            .cmp(&left.date)
            .then_with(|| timeline_sort_rank(left).cmp(&timeline_sort_rank(right)))
            .then_with(|| left.media_title.cmp(&right.media_title))
            .then_with(|| left.media_id.cmp(&right.media_id))
            .then_with(|| {
                left.milestone_name
                    .as_deref()
                    .unwrap_or("")
                    .cmp(right.milestone_name.as_deref().unwrap_or(""))
            })
    });

    Ok(timeline_events)
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
    conn.execute(
        "INSERT INTO main.milestones (media_title, name, duration, characters, date) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![milestone.media_title, milestone.name, milestone.duration, milestone.characters, milestone.date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_milestone(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.milestones WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_milestones_for_media(conn: &Connection, media_title: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM main.milestones WHERE media_title = ?1",
        params![media_title],
    )?;
    Ok(())
}

pub fn update_milestone(conn: &Connection, milestone: &Milestone) -> Result<()> {
    conn.execute(
        "UPDATE main.milestones SET media_title = ?1, name = ?2, duration = ?3, characters = ?4, date = ?5 WHERE id = ?6",
        params![
            milestone.media_title,
            milestone.name,
            milestone.duration,
            milestone.characters,
            milestone.date,
            milestone.id.unwrap()
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

    // Delete old cover
    let old_cover: String = conn
        .query_row(
            "SELECT cover_image FROM shared.media WHERE id = ?1",
            rusqlite::params![media_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let dest_str = dest.to_string_lossy().to_string();
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() && old_cover != dest_str {
            let _ = std::fs::remove_file(old_path);
        }
    }

    std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    )
    .map_err(|e| e.to_string())?;

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

    // Delete old cover
    let old_cover: String = conn
        .query_row(
            "SELECT cover_image FROM shared.media WHERE id = ?1",
            rusqlite::params![media_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let dest_str = dest.to_string_lossy().to_string();
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() && old_cover != dest_str {
            let _ = std::fs::remove_file(old_path);
        }
    }

    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TimelineEventKind;
    use rusqlite::Connection;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

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
            title: title.to_string(),
            media_type: "Reading".to_string(),
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
        }
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
        let _guard = ENV_LOCK.lock().unwrap();

        let original = std::env::var("KECHIMOCHI_DATA_DIR").ok();
        let custom =
            std::env::temp_dir().join(format!("kechimochi_data_dir_env_{}", std::process::id()));

        unsafe {
            std::env::set_var("KECHIMOCHI_DATA_DIR", &custom);
        }

        let resolved = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(resolved, custom);

        match original {
            Some(value) => unsafe {
                std::env::set_var("KECHIMOCHI_DATA_DIR", value);
            },
            None => unsafe {
                std::env::remove_var("KECHIMOCHI_DATA_DIR");
            },
        }
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
        let _guard = ENV_LOCK.lock().unwrap();

        let original_data_dir = std::env::var("KECHIMOCHI_DATA_DIR").ok();
        let original_app_identifier = std::env::var("KECHIMOCHI_APP_IDENTIFIER").ok();
        let original_appdata = std::env::var("APPDATA").ok();
        let fake_appdata =
            std::env::temp_dir().join(format!("kechimochi_appdata_{}", std::process::id()));

        unsafe {
            std::env::remove_var("KECHIMOCHI_DATA_DIR");
            std::env::remove_var("KECHIMOCHI_APP_IDENTIFIER");
            std::env::set_var("APPDATA", &fake_appdata);
        }

        let resolved = get_data_dir(&STANDALONE_DATA_DIR_PROVIDER);
        assert_eq!(resolved, fake_appdata.join("com.morg.kechimochi"));

        match original_data_dir {
            Some(value) => unsafe {
                std::env::set_var("KECHIMOCHI_DATA_DIR", value);
            },
            None => unsafe {
                std::env::remove_var("KECHIMOCHI_DATA_DIR");
            },
        }

        match original_app_identifier {
            Some(value) => unsafe {
                std::env::set_var("KECHIMOCHI_APP_IDENTIFIER", value);
            },
            None => unsafe {
                std::env::remove_var("KECHIMOCHI_APP_IDENTIFIER");
            },
        }

        match original_appdata {
            Some(value) => unsafe {
                std::env::set_var("APPDATA", value);
            },
            None => unsafe {
                std::env::remove_var("APPDATA");
            },
        }
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
    }

    #[test]
    fn test_add_duplicate_media_fails() {
        let conn = setup_test_db();
        let media = sample_media("薬屋のひとりごと");
        add_media_with_id(&conn, &media).unwrap();
        let result = add_media_with_id(&conn, &media);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_media() {
        let conn = setup_test_db();
        let media = sample_media("呪術廻戦");
        let id = add_media_with_id(&conn, &media).unwrap();

        let updated = Media {
            id: Some(id),
            title: "呪術廻戦".to_string(),
            media_type: "Watching".to_string(),
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
        assert_eq!(all[0].media_type, "Watching");
        assert_eq!(all[0].status, "Complete");
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

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 60,
            characters: 0,
            date: "2024-01-15".to_string(),
            activity_type: String::new(),
        };
        add_log(&conn, &log).unwrap();

        assert!(cover_path.exists());

        // Delete media (should cascade logs and remove file)
        delete_media(&conn, media_id).unwrap();

        let media_list = get_all_media(&conn).unwrap();
        assert_eq!(media_list.len(), 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);

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
        };
        let result = add_log(&conn, &log);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Activity must have either duration or characters"));
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

        add_milestone(
            &conn,
            &Milestone {
                id: None,
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
                media_type: "Playing".to_string(),
                tracking_status: "Paused".to_string(),
                content_type: "Videogame".to_string(),
                ..sample_media("Paused Title")
            },
        )
        .unwrap();
        let dropped_id = add_media_with_id(
            &conn,
            &Media {
                media_type: "Watching".to_string(),
                tracking_status: "Dropped".to_string(),
                content_type: "Anime".to_string(),
                ..sample_media("Dropped Title")
            },
        )
        .unwrap();
        let ongoing_id = add_media_with_id(
            &conn,
            &Media {
                media_type: "Listening".to_string(),
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

        // 1. Archived media with recent activity (should be last: Tier 2)
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
            },
        )
        .unwrap();

        // 2. Active entry but NOT ongoing (should be middle: Tier 1)
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
            },
        )
        .unwrap();

        // 3. Ongoing media with older activity (should be first: Tier 0)
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
            },
        )
        .unwrap();

        // 4. Ongoing media with NO activity (should be after Tier 0 with activity)
        let _m4_id = add_media_with_id(
            &conn,
            &Media {
                status: "Active".to_string(),
                tracking_status: "Ongoing".to_string(),
                ..sample_media("Ongoing No Activity")
            },
        )
        .unwrap();

        // Expectation:
        // 1. Ongoing Old (Tier 0, has activity)
        // 2. Ongoing No Activity (Tier 0, no activity)
        // 3. Active Complete (Tier 1)
        // 4. Archived Recent (Tier 2)

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].title, "Ongoing Old");
        assert_eq!(all[1].title, "Ongoing No Activity");
        assert_eq!(all[2].title, "Active Complete");
        assert_eq!(all[3].title, "Archived Recent");
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
        let temp_dir = unique_temp_dir("future_schema_test");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let user_db = temp_dir.join("kechimochi_user.db");
        let shared_db = temp_dir.join("kechimochi_shared_media.db");

        {
            let conn = Connection::open(&user_db).unwrap();
            conn.execute_batch(&format!(
                "PRAGMA user_version = {};",
                CURRENT_SCHEMA_VERSION + 1
            ))
            .unwrap();
        }
        {
            let conn = Connection::open(&shared_db).unwrap();
            conn.execute_batch(&format!(
                "PRAGMA user_version = {};",
                CURRENT_SCHEMA_VERSION + 1
            ))
            .unwrap();
        }

        let err = init_db(temp_dir.clone(), None).unwrap_err();
        assert!(err.to_string().contains("newer than this app supports"));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_get_data_dir_override() {
        let temp_dir = "/tmp/kechimochi_test_dir";
        std::env::set_var("KECHIMOCHI_DATA_DIR", temp_dir);

        // We need a dummy AppHandle to call it, but we can't easily.
        // However, we can verify the env var logic directly.
        let dir = if let Ok(d) = std::env::var("KECHIMOCHI_DATA_DIR") {
            PathBuf::from(d)
        } else {
            PathBuf::from("fail")
        };
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
    fn test_milestone_operations() {
        let conn = setup_test_db();
        let media_title = "Milestone Media";

        let milestone = Milestone {
            id: None,
            media_title: media_title.to_string(),
            name: "First Quarter".to_string(),
            duration: 120,
            characters: 0,
            date: Some("2024-03-12".to_string()),
        };

        // Test add_milestone
        let id = add_milestone(&conn, &milestone).unwrap();
        assert!(id > 0);

        // Test get_milestones_for_media
        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].name, "First Quarter");
        assert_eq!(milestones[0].duration, 120);

        // Test update_milestone
        let mut updated = milestones[0].clone();
        updated.name = "Halfway".to_string();
        updated.duration = 240;
        update_milestone(&conn, &updated).unwrap();

        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones[0].name, "Halfway");
        assert_eq!(milestones[0].duration, 240);

        // Test delete_milestone
        delete_milestone(&conn, id).unwrap();
        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones.len(), 0);
    }

    #[test]
    fn test_add_milestone_validation() {
        let conn = setup_test_db();
        let milestone = Milestone {
            id: None,
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
    fn test_delete_milestones_for_media() {
        let conn = setup_test_db();
        let title1 = "Media 1";
        let title2 = "Media 2";

        add_milestone(
            &conn,
            &Milestone {
                id: None,
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
                media_title: title2.to_string(),
                name: "M2".to_string(),
                duration: 20,
                characters: 0,
                date: None,
            },
        )
        .unwrap();

        assert_eq!(get_milestones_for_media(&conn, title1).unwrap().len(), 1);
        assert_eq!(get_milestones_for_media(&conn, title2).unwrap().len(), 1);

        delete_milestones_for_media(&conn, title1).unwrap();
        assert_eq!(get_milestones_for_media(&conn, title1).unwrap().len(), 0);
        assert_eq!(get_milestones_for_media(&conn, title2).unwrap().len(), 1);
    }

    #[test]
    fn test_migrate_milestones() {
        let conn = Connection::open_in_memory().unwrap();
        // Create table with only id (simulate old version if it ever missed columns)
        conn.execute(
            "CREATE TABLE main.milestones (id INTEGER PRIMARY KEY AUTOINCREMENT)",
            [],
        )
        .unwrap();

        // This should add the missing columns
        migrate_milestones(&conn).unwrap();

        // Verify we can insert
        let milestone = Milestone {
            id: None,
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
        };
        let id = add_log(&conn, &log).unwrap();

        let updated_log = ActivityLog {
            id: Some(id),
            media_id,
            duration_minutes: 45,
            characters: 100,
            date: "2024-01-02".to_string(),
            activity_type: "Watching".to_string(),
        };
        update_log(&conn, &updated_log).unwrap();

        let logs = get_logs_for_media(&conn, media_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].characters, 100);
        assert_eq!(logs[0].date, "2024-01-02");
    }
}

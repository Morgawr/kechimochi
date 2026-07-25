use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, State};
use tempfile::NamedTempFile;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::app_file_io;
use crate::database_recovery;
use crate::db;
use crate::sync_state;
use crate::{DbState, StartupMode, StartupState};

pub const BACKUP_FORMAT_VERSION: i64 = 1;
const MAX_BACKUP_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_BACKUP_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const BACKUP_SWAP_PREFIX: &str = ".kechimochi-backup-swap-";
const BACKUP_SWAP_PHASE_FILE: &str = "phase";
const BACKUP_SWAP_ORIGINALS_DIR: &str = "originals";
const BACKUP_SWAP_RECOVERY_DIR: &str = "recovery";
const BACKUP_INSTALL_PATHS: &[&str] = &[
    "kechimochi_user.db",
    "kechimochi_user.db-wal",
    "kechimochi_user.db-shm",
    "kechimochi_user.db-journal",
    "kechimochi_shared_media.db",
    "kechimochi_shared_media.db-wal",
    "kechimochi_shared_media.db-shm",
    "kechimochi_shared_media.db-journal",
    "covers",
];

fn backup_swap_paths() -> impl Iterator<Item = &'static str> {
    BACKUP_INSTALL_PATHS
        .iter()
        .copied()
        .chain(sync_state::SYNC_RUNTIME_RELATIVE_PATHS.iter().copied())
}

#[derive(Debug, Clone)]
pub struct PreparedFullBackup {
    pub staging_dir: PathBuf,
    pub local_storage: String,
}

pub enum PreparedFullBackupOutcome {
    Ready(PreparedFullBackup),
    RecoveryRequired {
        prepared: PreparedFullBackup,
        plan: database_recovery::DatabaseRecoveryPlan,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FullBackupImportResult {
    Imported {
        local_storage: String,
    },
    RecoveryRequired {
        plan: database_recovery::DatabaseRecoveryPlan,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    backup_format_version: i64,
    app_version: String,
    db_schema_version: i64,
    created_at: String,
}

fn build_backup_manifest(
    conn: &rusqlite::Connection,
    app_version: &str,
) -> Result<BackupManifest, String> {
    let db_schema_version = db::get_bundle_schema_version(conn).map_err(|e| e.to_string())?;
    Ok(BackupManifest {
        backup_format_version: BACKUP_FORMAT_VERSION,
        app_version: app_version.to_string(),
        db_schema_version,
        created_at: Utc::now().to_rfc3339(),
    })
}

fn read_backup_manifest(extract_dir: &Path) -> Result<Option<BackupManifest>, String> {
    let manifest_path = extract_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    let manifest_json = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest = serde_json::from_str::<BackupManifest>(&manifest_json)
        .map_err(|e| format!("Failed to parse backup manifest: {}", e))?;
    Ok(Some(manifest))
}

fn read_backup_schema_version(user_db: &Path, shared_db: &Path) -> Result<i64, String> {
    let conn = Connection::open(user_db)
        .map_err(|e| format!("Failed to open extracted user DB: {}", e))?;
    conn.execute(
        "ATTACH DATABASE ?1 AS shared",
        rusqlite::params![shared_db.to_string_lossy().to_string()],
    )
    .map_err(|e| format!("Failed to attach extracted shared DB: {}", e))?;
    db::get_bundle_schema_version(&conn).map_err(|e| e.to_string())
}

fn validate_extracted_backup(
    user_db: &Path,
    shared_db: &Path,
    manifest: Option<&BackupManifest>,
) -> Result<(), String> {
    if let Some(manifest) = manifest {
        if manifest.backup_format_version > BACKUP_FORMAT_VERSION {
            return Err(format!(
                "Backup format version {} is newer than this app supports ({})",
                manifest.backup_format_version, BACKUP_FORMAT_VERSION
            ));
        }
    }

    let schema_version = read_backup_schema_version(user_db, shared_db)?;
    if schema_version > db::CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Backup database schema version {} is newer than this app supports ({})",
            schema_version,
            db::CURRENT_SCHEMA_VERSION
        ));
    }

    if let Some(manifest) = manifest {
        if manifest.db_schema_version != schema_version {
            return Err(format!(
                "Backup manifest schema version {} does not match database files ({})",
                manifest.db_schema_version, schema_version
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn export_full_backup(
    app_handle: AppHandle,
    state: State<'_, DbState>,
    file_path: String,
    local_storage: String,
    version: String,
) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    let conn = state.conn.clone();

    spawn_blocking(move || {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        export_full_backup_internal(&app_dir, &conn_guard, &file_path, &local_storage, &version)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn export_full_backup_internal(
    app_dir: &Path,
    conn_guard: &rusqlite::Connection, // pass a guard reference to ensure lock is held
    file_path: &str,
    local_storage: &str,
    version: &str,
) -> Result<(), String> {
    let dest_path = Path::new(file_path);
    validate_local_storage_json(local_storage)?;
    let manifest = build_backup_manifest(conn_guard, version)?;
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    let destination_parent = dest_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let staging_file = NamedTempFile::new_in(destination_parent)
        .map_err(|e| format!("Failed to create temporary backup file: {e}"))?;
    let file = staging_file
        .reopen()
        .map_err(|e| format!("Failed to open temporary backup file: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Write manifest.json
    zip.start_file("manifest.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&manifest_json).map_err(|e| e.to_string())?;

    // Write version.txt
    zip.start_file("version.txt", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(version.as_bytes())
        .map_err(|e| e.to_string())?;

    // Write local_storage.json
    zip.start_file("local_storage.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(local_storage.as_bytes())
        .map_err(|e| e.to_string())?;

    // Add DB files
    let files_to_backup = vec![
        "kechimochi_user.db",
        "kechimochi_user.db-wal",
        "kechimochi_user.db-shm",
        "kechimochi_shared_media.db",
        "kechimochi_shared_media.db-wal",
        "kechimochi_shared_media.db-shm",
    ];

    for file_name in files_to_backup {
        let path = app_dir.join(file_name);
        if path.exists() {
            zip.start_file(file_name, options)
                .map_err(|e| e.to_string())?;
            let mut f = File::open(&path).map_err(|e| e.to_string())?;
            io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        }
    }

    // Add covers directory (using walkdir for simplicity)
    let covers_dir = app_dir.join("covers");
    if covers_dir.exists() && covers_dir.is_dir() {
        for entry in WalkDir::new(&covers_dir) {
            let entry = entry
                .map_err(|error| format!("Failed to traverse cover images for backup: {error}"))?;
            let path = entry.path();
            if path.is_file() {
                let relative_path = path.strip_prefix(app_dir).map_err(|e| e.to_string())?;
                let zip_path = relative_path.to_string_lossy();
                zip.start_file(zip_path, options)
                    .map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            }
        }
    }

    let finished_file = zip.finish().map_err(|e| e.to_string())?;
    finished_file.sync_all().map_err(|e| e.to_string())?;
    drop(finished_file);
    let installed = staging_file
        .persist(dest_path)
        .map_err(|error| format!("Failed to install completed backup: {}", error.error))?;
    installed.sync_all().map_err(|error| error.to_string())?;
    sync_directory(destination_parent)?;
    Ok(())
}

fn validate_local_storage_json(local_storage: &str) -> Result<(), String> {
    match serde_json::from_str::<serde_json::Value>(local_storage) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        Ok(_) => Err("Backup local storage must be a JSON object".to_string()),
        Err(error) => Err(format!("Backup local storage is invalid JSON: {error}")),
    }
}

#[tauri::command]
pub fn import_full_backup(
    app_handle: AppHandle,
    state: State<DbState>,
    startup_state: State<StartupState>,
    file_path: String,
) -> Result<FullBackupImportResult, String> {
    let app_dir = db::get_data_dir(&app_handle);
    {
        let mode = startup_state
            .mode
            .lock()
            .map_err(|error| error.to_string())?;
        if !matches!(*mode, StartupMode::Ready) {
            return Err("Finish the current database recovery before importing a backup.".into());
        }
    }
    let _sync_guard = sync_state::acquire_sync_lock(&app_dir)?;
    let zip_file = app_file_io::open_input_file(&app_handle, &file_path)?;
    match prepare_full_backup_from_reader_internal(&app_dir, zip_file)? {
        PreparedFullBackupOutcome::Ready(prepared) => {
            let local_storage = {
                let mut conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
                install_prepared_full_backup(&app_dir, &mut conn_guard, &prepared)?
            };
            Ok(FullBackupImportResult::Imported { local_storage })
        }
        PreparedFullBackupOutcome::RecoveryRequired { prepared, plan } => {
            let session = database_recovery::DatabaseRecoverySession {
                plan: plan.clone(),
                target: database_recovery::DatabaseRecoveryTarget::StagedFullBackup {
                    staging_dir: prepared.staging_dir,
                    local_storage: prepared.local_storage,
                },
            };
            *startup_state
                .mode
                .lock()
                .map_err(|error| error.to_string())? = StartupMode::RecoveryRequired(session);
            Ok(FullBackupImportResult::RecoveryRequired { plan })
        }
    }
}

pub fn import_full_backup_internal(
    app_dir: &Path,
    conn_guard: &mut rusqlite::Connection,
    file_path: &str,
) -> Result<String, String> {
    let zip_path = Path::new(file_path);
    let zip_file = File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    import_full_backup_from_reader_internal(app_dir, conn_guard, zip_file)
}

pub fn import_full_backup_from_reader_internal<R: Read + io::Seek>(
    app_dir: &Path,
    conn_guard: &mut rusqlite::Connection,
    zip_file: R,
) -> Result<String, String> {
    match prepare_full_backup_from_reader_internal(app_dir, zip_file)? {
        PreparedFullBackupOutcome::Ready(prepared) => {
            install_prepared_full_backup(app_dir, conn_guard, &prepared)
        }
        PreparedFullBackupOutcome::RecoveryRequired { prepared, .. } => {
            let _ = fs::remove_dir_all(prepared.staging_dir);
            Err(
                "The backup contains data that requires interactive database recovery. Import it from the Kechimochi app."
                    .to_string(),
            )
        }
    }
}

pub fn prepare_full_backup_from_reader_internal<R: Read + io::Seek>(
    app_dir: &Path,
    zip_file: R,
) -> Result<PreparedFullBackupOutcome, String> {
    let mut archive =
        ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    if archive.len() > MAX_BACKUP_ARCHIVE_ENTRIES {
        return Err(format!(
            "Backup contains too many entries ({}; maximum {})",
            archive.len(),
            MAX_BACKUP_ARCHIVE_ENTRIES
        ));
    }
    let extraction = tempfile::Builder::new()
        .prefix(".kechimochi-extracted-")
        .tempdir_in(app_dir)
        .map_err(|error| error.to_string())?;
    let extract_dir = extraction.path().to_path_buf();
    let mut extracted_paths = std::collections::HashSet::new();
    let mut declared_uncompressed_bytes = 0_u64;
    let mut extracted_uncompressed_bytes = 0_u64;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        declared_uncompressed_bytes = declared_uncompressed_bytes
            .checked_add(file.size())
            .ok_or_else(|| "Backup uncompressed size overflowed".to_string())?;
        if declared_uncompressed_bytes > MAX_BACKUP_UNCOMPRESSED_BYTES {
            return Err(format!(
                "Backup expands beyond the supported {} byte limit",
                MAX_BACKUP_UNCOMPRESSED_BYTES
            ));
        }
        let outpath = match file.enclosed_name() {
            Some(path) => extract_dir.join(path),
            None => return Err("Backup contains an unsafe path".to_string()),
        };
        let relative_path = outpath
            .strip_prefix(&extract_dir)
            .map_err(|error| error.to_string())?
            .to_path_buf();
        let collision_key = relative_path
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if !extracted_paths.insert(collision_key) {
            return Err("Backup contains duplicate paths".to_string());
        }

        // We only care about files, not directories, in the root
        if file.is_file() {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            let remaining = MAX_BACKUP_UNCOMPRESSED_BYTES - extracted_uncompressed_bytes;
            let copied = io::copy(&mut (&mut file).take(remaining + 1), &mut outfile)
                .map_err(|e| e.to_string())?;
            if copied > remaining {
                return Err(format!(
                    "Backup expands beyond the supported {} byte limit",
                    MAX_BACKUP_UNCOMPRESSED_BYTES
                ));
            }
            extracted_uncompressed_bytes += copied;
        }
    }

    // Verify critical files exist
    let user_db = extract_dir.join("kechimochi_user.db");
    let shared_db = extract_dir.join("kechimochi_shared_media.db");
    let local_storage_file = extract_dir.join("local_storage.json");

    if !user_db.exists() {
        return Err("Missing kechimochi_user.db in archive".into());
    }
    if !shared_db.exists() {
        return Err("Missing kechimochi_shared_media.db in archive".into());
    }

    let manifest = read_backup_manifest(&extract_dir)?;
    validate_extracted_backup(&user_db, &shared_db, manifest.as_ref())?;

    let local_storage_json = if local_storage_file.exists() {
        fs::read_to_string(&local_storage_file)
            .map_err(|error| format!("Failed to read backup local storage: {error}"))?
    } else {
        "{}".to_string()
    };
    validate_local_storage_json(&local_storage_json)?;

    let database_outcome = database_recovery::open_database(extract_dir.clone(), None)
        .map_err(|error| format!("Failed to initialize restored database: {error}"))?;
    let staging_dir = extraction.keep();
    let prepared = PreparedFullBackup {
        staging_dir,
        local_storage: local_storage_json,
    };
    match database_outcome {
        database_recovery::DatabaseOpenOutcome::Ready(connection) => {
            drop(connection);
            Ok(PreparedFullBackupOutcome::Ready(prepared))
        }
        database_recovery::DatabaseOpenOutcome::RecoveryRequired(plan) => {
            Ok(PreparedFullBackupOutcome::RecoveryRequired { prepared, plan })
        }
    }
}

pub fn install_prepared_full_backup(
    app_dir: &Path,
    conn_guard: &mut rusqlite::Connection,
    prepared: &PreparedFullBackup,
) -> Result<String, String> {
    let _sync_state_guard = sync_state::lock_sync_state_files_for_data_replacement();
    let extract_dir = &prepared.staging_dir;
    let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}{}", uuid::Uuid::new_v4()));
    let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);

    // Drop active connection by replacing with in-memory DB so windows allows moving files
    *conn_guard = Connection::open_in_memory().map_err(|error| error.to_string())?;

    if let Err(error) = fs::create_dir_all(&originals_dir) {
        return Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            format!("Failed to prepare backup swap directory: {error}"),
        ));
    }
    if let Err(error) = sync_directory(app_dir) {
        return Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            error,
        ));
    }
    if let Err(error) = write_backup_swap_phase(&backup_dir, "moving_originals") {
        return Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            error,
        ));
    }

    // Move current files to backup
    for file_name in backup_swap_paths() {
        let current_path = app_dir.join(file_name);
        if current_path.exists() {
            let backup_path = originals_dir.join(file_name);
            if let Some(parent) = backup_path.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    return Err(abort_backup_install(
                        app_dir,
                        conn_guard,
                        extract_dir,
                        &backup_dir,
                        format!("Failed to prepare backup path for {file_name}: {error}"),
                    ));
                }
            }
            if let Err(e) = fs::rename(&current_path, &backup_path) {
                return Err(abort_backup_install(
                    app_dir,
                    conn_guard,
                    extract_dir,
                    &backup_dir,
                    format!("Failed to move {file_name} to backup: {e}"),
                ));
            }
            if let Err(error) = sync_rename_parents(&current_path, &backup_path) {
                return Err(abort_backup_install(
                    app_dir,
                    conn_guard,
                    extract_dir,
                    &backup_dir,
                    error,
                ));
            }
        }
    }
    if let Err(error) = write_backup_swap_phase(&backup_dir, "installing") {
        return Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            error,
        ));
    }

    // Move extracted files to active directory
    for file_name in BACKUP_INSTALL_PATHS {
        let extracted_path = extract_dir.join(file_name);
        if extracted_path.exists() {
            let active_path = app_dir.join(file_name);
            if let Err(e) = fs::rename(&extracted_path, &active_path) {
                return Err(abort_backup_install(
                    app_dir,
                    conn_guard,
                    extract_dir,
                    &backup_dir,
                    format!("Failed to move extracted {file_name} to active path: {e}"),
                ));
            }
            if let Err(error) = sync_rename_parents(&extracted_path, &active_path) {
                return Err(abort_backup_install(
                    app_dir,
                    conn_guard,
                    extract_dir,
                    &backup_dir,
                    error,
                ));
            }
        }
    }
    if let Err(error) = write_backup_swap_phase(&backup_dir, "verifying") {
        return Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            error,
        ));
    }

    // Reinitialize DB
    match db::init_db_without_backup_recovery(app_dir.to_path_buf(), None) {
        Ok(new_conn) => {
            if let Err(error) = write_backup_swap_phase(&backup_dir, "committed") {
                drop(new_conn);
                return Err(abort_backup_install(
                    app_dir,
                    conn_guard,
                    extract_dir,
                    &backup_dir,
                    format!(
                        "Restored database was valid but the commit marker could not be written: {error}"
                    ),
                ));
            }
            *conn_guard = new_conn;
            let _ = fs::remove_dir_all(extract_dir);
            let _ = fs::remove_dir_all(&backup_dir);
            Ok(prepared.local_storage.clone())
        }
        Err(e) => Err(abort_backup_install(
            app_dir,
            conn_guard,
            extract_dir,
            &backup_dir,
            format!("Failed to initialize DB after restore: {e}"),
        )),
    }
}

fn write_backup_swap_phase(backup_dir: &Path, phase: &str) -> Result<(), String> {
    let phase_path = backup_dir.join(BACKUP_SWAP_PHASE_FILE);
    let mut staged_phase = NamedTempFile::new_in(backup_dir)
        .map_err(|error| format!("Failed to stage backup swap phase: {error}"))?;
    staged_phase
        .write_all(phase.as_bytes())
        .map_err(|error| format!("Failed to write backup swap phase: {error}"))?;
    staged_phase
        .as_file()
        .sync_all()
        .map_err(|error| format!("Failed to sync backup swap phase: {error}"))?;
    staged_phase
        .persist(&phase_path)
        .map_err(|error| format!("Failed to install backup swap phase: {}", error.error))?;
    sync_directory(backup_dir)?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Failed to sync directory '{}': {error}", path.display()))
    }
    #[cfg(not(unix))]
    {
        if let Ok(directory) = File::open(path) {
            directory
                .sync_all()
                .map_err(|error| format!("Failed to sync directory '{}': {error}", path.display()))
        } else {
            Ok(())
        }
    }
}

fn sync_rename_parents(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = source.parent() {
        sync_directory(parent)?;
    }
    if destination.parent() != source.parent() {
        if let Some(parent) = destination.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

fn write_backup_recovery_marker(
    backup_dir: &Path,
    index: usize,
    had_original: bool,
) -> Result<(), String> {
    let recovery_dir = backup_dir.join(BACKUP_SWAP_RECOVERY_DIR);
    fs::create_dir_all(&recovery_dir)
        .map_err(|error| format!("Failed to prepare backup recovery progress: {error}"))?;
    sync_directory(backup_dir)?;
    let marker_path = recovery_dir.join(index.to_string());
    if marker_path.exists() {
        return Ok(());
    }
    let mut staged = NamedTempFile::new_in(&recovery_dir)
        .map_err(|error| format!("Failed to stage backup recovery progress: {error}"))?;
    staged
        .write_all(if had_original { b"original" } else { b"absent" })
        .map_err(|error| format!("Failed to write backup recovery progress: {error}"))?;
    staged
        .as_file()
        .sync_all()
        .map_err(|error| format!("Failed to sync backup recovery progress: {error}"))?;
    staged.persist(&marker_path).map_err(|error| {
        format!(
            "Failed to install backup recovery progress: {}",
            error.error
        )
    })?;
    sync_directory(&recovery_dir)
}

fn read_or_create_backup_recovery_marker(
    backup_dir: &Path,
    index: usize,
    original_exists: bool,
) -> Result<bool, String> {
    let marker_path = backup_dir
        .join(BACKUP_SWAP_RECOVERY_DIR)
        .join(index.to_string());
    if !marker_path.exists() {
        write_backup_recovery_marker(backup_dir, index, original_exists)?;
    }
    match fs::read_to_string(&marker_path)
        .map_err(|error| format!("Failed to read backup recovery progress: {error}"))?
        .trim()
    {
        "original" => Ok(true),
        "absent" => Ok(false),
        value => Err(format!(
            "Interrupted backup has invalid recovery progress '{value}'"
        )),
    }
}

fn abort_backup_install(
    app_dir: &Path,
    conn_guard: &mut Connection,
    extract_dir: &Path,
    backup_dir: &Path,
    primary_error: String,
) -> String {
    let rollback_result = if backup_dir.join(BACKUP_SWAP_PHASE_FILE).exists() {
        recover_backup_swap_directory(app_dir, backup_dir)
    } else {
        remove_path(backup_dir)
    };

    let reconnect_result = if rollback_result.is_ok() {
        db::init_db_without_backup_recovery(app_dir.to_path_buf(), None)
            .map(|connection| *conn_guard = connection)
            .map_err(|error| error.to_string())
    } else {
        Err("database connection was left closed because rollback did not complete".to_string())
    };
    let cleanup_result = remove_path(extract_dir);

    let mut message = primary_error;
    if let Err(error) = rollback_result {
        message.push_str(&format!("; rollback failed: {error}"));
    }
    if let Err(error) = reconnect_result {
        message.push_str(&format!("; reconnect failed: {error}"));
    }
    if let Err(error) = cleanup_result {
        message.push_str(&format!("; staging cleanup failed: {error}"));
    }
    message
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn recover_backup_swap_directory(app_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    let phase_path = backup_dir.join(BACKUP_SWAP_PHASE_FILE);
    if !phase_path.exists() {
        let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);
        let originals_are_empty = !originals_dir.exists()
            || fs::read_dir(&originals_dir)
                .map_err(|error| {
                    format!("Failed to inspect uncommitted backup originals: {error}")
                })?
                .next()
                .is_none();
        if originals_are_empty {
            return fs::remove_dir_all(backup_dir).map_err(|error| {
                format!("Failed to clean an uncommitted backup swap directory: {error}")
            });
        }
        return Err(
            "Interrupted backup has original data but no recovery phase; refusing to guess"
                .to_string(),
        );
    }
    let phase = fs::read_to_string(phase_path)
        .map_err(|error| format!("Failed to read interrupted backup phase: {error}"))?;
    let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);

    match phase.trim() {
        "moving_originals" => {
            for file_name in backup_swap_paths() {
                let original = originals_dir.join(file_name);
                if original.exists() {
                    let active = app_dir.join(file_name);
                    if active.exists() {
                        return Err(format!(
                            "Cannot restore '{}' because the active path unexpectedly exists",
                            file_name
                        ));
                    }
                    if let Some(parent) = active.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            format!(
                                "Failed to prepare the restore directory for '{file_name}': {error}"
                            )
                        })?;
                    }
                    fs::rename(&original, &active).map_err(|error| {
                        format!("Failed to restore interrupted backup file '{file_name}': {error}")
                    })?;
                    sync_rename_parents(&original, &active)?;
                }
            }
        }
        "installing" | "verifying" => {
            for (index, file_name) in backup_swap_paths().enumerate() {
                let active = app_dir.join(file_name);
                let original = originals_dir.join(file_name);
                let had_original =
                    read_or_create_backup_recovery_marker(backup_dir, index, original.exists())?;
                if had_original {
                    if !original.exists() {
                        if !active.exists() {
                            return Err(format!(
                                "Original '{file_name}' was already moved out of backup recovery state, but its active path is missing"
                            ));
                        }
                        continue;
                    }
                    remove_path(&active).map_err(|error| {
                        format!("Failed to remove partially restored '{file_name}': {error}")
                    })?;
                    if let Some(parent) = active.parent().filter(|parent| parent.exists()) {
                        sync_directory(parent)?;
                    }
                    if let Some(parent) = active.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            format!(
                                "Failed to prepare the restore directory for '{file_name}': {error}"
                            )
                        })?;
                    }
                    fs::rename(&original, &active).map_err(|error| {
                        format!("Failed to restore original '{file_name}': {error}")
                    })?;
                    sync_rename_parents(&original, &active)?;
                } else {
                    remove_path(&active).map_err(|error| {
                        format!("Failed to remove partially restored '{file_name}': {error}")
                    })?;
                    if let Some(parent) = active.parent().filter(|parent| parent.exists()) {
                        sync_directory(parent)?;
                    }
                }
            }
        }
        "committed" => {}
        other => {
            return Err(format!(
                "Interrupted backup has unknown recovery phase '{other}'"
            ))
        }
    }
    fs::remove_dir_all(backup_dir)
        .map_err(|error| format!("Failed to clean interrupted backup state: {error}"))?;
    sync_directory(app_dir)
}

pub(crate) fn recover_interrupted_backup_installs(app_dir: &Path) -> Result<(), String> {
    if !app_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(app_dir)
        .map_err(|error| format!("Failed to inspect backup recovery state: {error}"))?;
    let mut swap_directories = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let is_swap = path.is_dir()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(BACKUP_SWAP_PREFIX));
        if is_swap {
            swap_directories.push(path);
        }
    }
    swap_directories.sort();
    for backup_dir in swap_directories {
        recover_backup_swap_directory(app_dir, &backup_dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models;

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), ts))
    }

    fn write_backup_archive(
        source_dir: &Path,
        zip_path: &Path,
        local_storage: &str,
        version_txt: &str,
        manifest: Option<&BackupManifest>,
    ) {
        let file = File::create(zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        if let Some(manifest) = manifest {
            zip.start_file("manifest.json", options).unwrap();
            let json = serde_json::to_vec_pretty(manifest).unwrap();
            zip.write_all(&json).unwrap();
        }

        zip.start_file("version.txt", options).unwrap();
        zip.write_all(version_txt.as_bytes()).unwrap();

        zip.start_file("local_storage.json", options).unwrap();
        zip.write_all(local_storage.as_bytes()).unwrap();

        for name in ["kechimochi_user.db", "kechimochi_shared_media.db"] {
            let path = source_dir.join(name);
            zip.start_file(name, options).unwrap();
            let bytes = fs::read(path).unwrap();
            zip.write_all(&bytes).unwrap();
        }

        zip.finish().unwrap();
    }

    #[test]
    fn test_export_full_backup_writes_manifest() {
        let data_dir = unique_temp_dir("backup_export");
        fs::create_dir_all(&data_dir).unwrap();

        let conn = db::init_db(data_dir.clone(), None).unwrap();
        let backup_path = data_dir.join("exported_backup.zip");
        export_full_backup_internal(
            &data_dir,
            &conn,
            backup_path.to_str().unwrap(),
            "{\"theme\":\"light\"}",
            "1.0.0",
        )
        .unwrap();

        let file = File::open(&backup_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();

        let manifest: BackupManifest = {
            let mut manifest_entry = archive.by_name("manifest.json").unwrap();
            let mut manifest_json = String::new();
            manifest_entry.read_to_string(&mut manifest_json).unwrap();
            serde_json::from_str(&manifest_json).unwrap()
        };
        assert_eq!(manifest.backup_format_version, BACKUP_FORMAT_VERSION);
        assert_eq!(manifest.app_version, "1.0.0");
        assert_eq!(manifest.db_schema_version, db::CURRENT_SCHEMA_VERSION);

        let version_txt = {
            let mut version_entry = archive.by_name("version.txt").unwrap();
            let mut version_txt = String::new();
            version_entry.read_to_string(&mut version_txt).unwrap();
            version_txt
        };
        assert_eq!(version_txt, "1.0.0");

        fs::remove_dir_all(data_dir).ok();
    }

    #[test]
    fn test_import_full_backup_rejects_newer_schema() {
        let source_dir = unique_temp_dir("backup_future_source");
        let target_dir = unique_temp_dir("backup_future_target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();

        let user_db = source_dir.join("kechimochi_user.db");
        let shared_db = source_dir.join("kechimochi_shared_media.db");
        {
            let conn = Connection::open(&user_db).unwrap();
            conn.execute_batch(&format!(
                "PRAGMA user_version = {};",
                db::CURRENT_SCHEMA_VERSION + 1
            ))
            .unwrap();
        }
        {
            let conn = Connection::open(&shared_db).unwrap();
            conn.execute_batch(&format!(
                "PRAGMA user_version = {};",
                db::CURRENT_SCHEMA_VERSION + 1
            ))
            .unwrap();
        }

        let zip_path = source_dir.join("future_backup.zip");
        let manifest = BackupManifest {
            backup_format_version: BACKUP_FORMAT_VERSION,
            app_version: "9.9.9".to_string(),
            db_schema_version: db::CURRENT_SCHEMA_VERSION + 1,
            created_at: Utc::now().to_rfc3339(),
        };
        write_backup_archive(&source_dir, &zip_path, "{}", "9.9.9", Some(&manifest));

        let mut conn_guard = Connection::open_in_memory().unwrap();
        let err =
            import_full_backup_internal(&target_dir, &mut conn_guard, zip_path.to_str().unwrap())
                .unwrap_err();
        assert!(err.contains("newer than this app supports"));

        fs::remove_dir_all(source_dir).ok();
        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn test_import_full_backup_migrates_legacy_schema() {
        let source_dir = unique_temp_dir("backup_legacy_source");
        let target_dir = unique_temp_dir("backup_legacy_target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();

        let user_db = source_dir.join("kechimochi_user.db");
        let shared_db = source_dir.join("kechimochi_shared_media.db");
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
                 VALUES (1, 'Legacy VN', 'Reading', 'Ongoing', 'Japanese')",
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
                 VALUES (1, 1, 45, '2024-02-01')",
                    [],
                )
                .unwrap();
        }
        Connection::open(&shared_db).unwrap();

        let zip_path = source_dir.join("legacy_backup.zip");
        write_backup_archive(
            &source_dir,
            &zip_path,
            "{\"theme\":\"dark\"}",
            "0.9.0",
            None,
        );

        let mut conn_guard = Connection::open_in_memory().unwrap();
        let local_storage =
            import_full_backup_internal(&target_dir, &mut conn_guard, zip_path.to_str().unwrap())
                .unwrap();

        assert_eq!(local_storage, "{\"theme\":\"dark\"}");
        assert_eq!(
            db::get_bundle_schema_version(&conn_guard).unwrap(),
            db::CURRENT_SCHEMA_VERSION
        );

        let media = db::get_all_media(&conn_guard).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "Legacy VN");

        let logs = db::get_logs(&conn_guard).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Legacy VN");
        assert_eq!(logs[0].duration_minutes, 45);

        fs::remove_dir_all(source_dir).ok();
        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn test_broken_full_backup_stays_staged_until_interactive_recovery() {
        let source_dir = unique_temp_dir("backup_recovery_source");
        let target_dir = unique_temp_dir("backup_recovery_target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();

        let source_conn = db::init_db(source_dir.clone(), None).unwrap();
        let imported_media_id = db::add_media_with_id(
            &source_conn,
            &models::Media {
                id: None,
                uid: None,
                title: "Renamed import".to_string(),
                variant: "Novel".to_string(),
                default_activity_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: String::new(),
                extra_data: "{}".to_string(),
                content_type: "Novel".to_string(),
                tracking_status: "Ongoing".to_string(),
            },
        )
        .unwrap();
        let imported_media_uid: String = source_conn
            .query_row(
                "SELECT uid FROM shared.media WHERE id = ?1",
                rusqlite::params![imported_media_id],
                |row| row.get(0),
            )
            .unwrap();
        db::add_milestone(
            &source_conn,
            &models::Milestone {
                id: None,
                media_uid: Some(imported_media_uid.clone()),
                media_title: "Renamed import".to_string(),
                name: "Imported milestone".to_string(),
                duration: 20,
                characters: 900,
                date: Some("2026-07-01".to_string()),
            },
        )
        .unwrap();
        source_conn
            .execute(
                "UPDATE main.milestones
                 SET media_uid = 'missing-import-uid', media_title = 'Legacy import title'",
                [],
            )
            .unwrap();
        source_conn
            .execute_batch(
                "PRAGMA main.user_version = 5;
                 PRAGMA shared.user_version = 5;
                 PRAGMA main.wal_checkpoint(TRUNCATE);
                 PRAGMA shared.wal_checkpoint(TRUNCATE);",
            )
            .unwrap();
        drop(source_conn);

        let zip_path = source_dir.join("recovery-backup.zip");
        let manifest = BackupManifest {
            backup_format_version: BACKUP_FORMAT_VERSION,
            app_version: "0.3.1".to_string(),
            db_schema_version: 5,
            created_at: Utc::now().to_rfc3339(),
        };
        write_backup_archive(
            &source_dir,
            &zip_path,
            r#"{"theme":"restored"}"#,
            "0.3.1",
            Some(&manifest),
        );

        let mut target_conn = db::init_db(target_dir.clone(), None).unwrap();
        db::add_media_with_id(
            &target_conn,
            &models::Media {
                id: None,
                uid: None,
                title: "Existing live data".to_string(),
                variant: String::new(),
                default_activity_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: String::new(),
                extra_data: "{}".to_string(),
                content_type: "Novel".to_string(),
                tracking_status: "Ongoing".to_string(),
            },
        )
        .unwrap();

        let prepared = match prepare_full_backup_from_reader_internal(
            &target_dir,
            File::open(&zip_path).unwrap(),
        )
        .unwrap()
        {
            PreparedFullBackupOutcome::RecoveryRequired { prepared, plan } => {
                assert_eq!(
                    db::get_all_media(&target_conn).unwrap()[0].title,
                    "Existing live data"
                );
                (prepared, plan)
            }
            PreparedFullBackupOutcome::Ready(_) => {
                panic!("broken backup should require interactive recovery")
            }
        };

        let group = match &prepared.1.issues[0] {
            database_recovery::DatabaseRecoveryIssue::OrphanedMilestoneGroups { groups } => {
                &groups[0]
            }
        };
        let applied = database_recovery::apply_database_recovery(
            &prepared.0.staging_dir,
            &prepared.1,
            database_recovery::ApplyDatabaseRecoveryRequest {
                session_token: prepared.1.session_token.clone(),
                resolutions: vec![
                    database_recovery::DatabaseRecoveryResolution::AttachMilestoneGroup {
                        group_token: group.group_token.clone(),
                        media_uid: imported_media_uid.clone(),
                    },
                ],
                local_storage: "{}".to_string(),
            },
        )
        .unwrap();
        drop(applied.connection);
        let restored_storage =
            install_prepared_full_backup(&target_dir, &mut target_conn, &prepared.0).unwrap();

        assert_eq!(restored_storage, r#"{"theme":"restored"}"#);
        assert_eq!(
            db::get_all_media(&target_conn).unwrap()[0].title,
            "Renamed import"
        );
        let milestone_parent: (String, String) = target_conn
            .query_row(
                "SELECT media_uid, media_title FROM main.milestones",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            milestone_parent,
            (imported_media_uid, "Renamed import".to_string())
        );

        fs::remove_dir_all(source_dir).ok();
        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn test_backup_export_import_preserves_activity_notes_and_media_variant() {
        let source_dir = unique_temp_dir("backup_notes_source");
        let target_dir = unique_temp_dir("backup_notes_target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();

        // Build source DB with a log that has notes
        let source_conn = db::init_db(source_dir.clone(), None).unwrap();
        let media_id = db::add_media_with_id(
            &source_conn,
            &models::Media {
                id: None,
                uid: None,
                title: "Backup Notes Media".to_string(),
                variant: "Novel".to_string(),
                default_activity_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: String::new(),
                extra_data: "{}".to_string(),
                content_type: "Novel".to_string(),
                tracking_status: "Ongoing".to_string(),
            },
        )
        .unwrap();
        db::add_log(
            &source_conn,
            &models::ActivityLog {
                id: None,
                media_id,
                duration_minutes: 50,
                characters: 0,
                date: "2024-11-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "backup note content".to_string(),
            },
        )
        .unwrap();

        let zip_path = source_dir.join("notes_backup.zip");
        export_full_backup_internal(
            &source_dir,
            &source_conn,
            zip_path.to_str().unwrap(),
            "{}",
            "0.0.0",
        )
        .unwrap();

        fs::create_dir_all(target_dir.join("sync")).unwrap();
        fs::write(
            sync_state::sync_config_path(&target_dir),
            b"old sync association",
        )
        .unwrap();

        // Import the backup into a fresh connection
        let mut target_conn = Connection::open_in_memory().unwrap();
        import_full_backup_internal(&target_dir, &mut target_conn, zip_path.to_str().unwrap())
            .unwrap();

        let logs = db::get_logs(&target_conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "backup note content");
        assert_eq!(logs[0].title, "Backup Notes Media");
        assert_eq!(db::get_all_media(&target_conn).unwrap()[0].variant, "Novel");
        assert!(!sync_state::sync_config_path(&target_dir).exists());

        fs::remove_dir_all(source_dir).ok();
        fs::remove_dir_all(target_dir).ok();
    }

    #[test]
    fn test_interrupted_original_move_restores_only_files_that_were_moved() {
        let app_dir = unique_temp_dir("backup_partial_original_move");
        let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}test"));
        let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);
        fs::create_dir_all(&originals_dir).unwrap();

        fs::write(originals_dir.join("kechimochi_user.db"), b"original user").unwrap();
        fs::write(
            app_dir.join("kechimochi_shared_media.db"),
            b"untouched shared",
        )
        .unwrap();
        write_backup_swap_phase(&backup_dir, "moving_originals").unwrap();

        recover_interrupted_backup_installs(&app_dir).unwrap();

        assert_eq!(
            fs::read(app_dir.join("kechimochi_user.db")).unwrap(),
            b"original user"
        );
        assert_eq!(
            fs::read(app_dir.join("kechimochi_shared_media.db")).unwrap(),
            b"untouched shared"
        );
        assert!(!backup_dir.exists());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn test_unphased_empty_swap_directory_is_safe_to_clean_after_a_crash() {
        let app_dir = unique_temp_dir("backup_unphased_swap");
        let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}test"));
        fs::create_dir_all(backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR)).unwrap();
        fs::write(app_dir.join("unrelated.txt"), b"preserve me").unwrap();

        recover_interrupted_backup_installs(&app_dir).unwrap();

        assert!(!backup_dir.exists());
        assert_eq!(
            fs::read(app_dir.join("unrelated.txt")).unwrap(),
            b"preserve me"
        );
        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn test_interrupted_install_removes_partial_replacement_and_restores_originals() {
        let app_dir = unique_temp_dir("backup_partial_install");
        let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}test"));
        let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);
        fs::create_dir_all(&originals_dir).unwrap();

        fs::write(originals_dir.join("kechimochi_user.db"), b"original user").unwrap();
        fs::write(
            originals_dir.join("kechimochi_shared_media.db"),
            b"original shared",
        )
        .unwrap();
        fs::create_dir_all(originals_dir.join("sync")).unwrap();
        fs::write(
            originals_dir.join("sync/sync_config.json"),
            b"original sync",
        )
        .unwrap();
        fs::write(app_dir.join("kechimochi_user.db"), b"partial replacement").unwrap();
        fs::create_dir_all(app_dir.join("sync")).unwrap();
        fs::write(
            app_dir.join("sync/sync_config.json"),
            b"partial sync replacement",
        )
        .unwrap();
        fs::write(app_dir.join("unrelated.txt"), b"preserve me").unwrap();
        write_backup_swap_phase(&backup_dir, "installing").unwrap();

        recover_interrupted_backup_installs(&app_dir).unwrap();

        assert_eq!(
            fs::read(app_dir.join("kechimochi_user.db")).unwrap(),
            b"original user"
        );
        assert_eq!(
            fs::read(app_dir.join("kechimochi_shared_media.db")).unwrap(),
            b"original shared"
        );
        assert_eq!(
            fs::read(app_dir.join("sync/sync_config.json")).unwrap(),
            b"original sync"
        );
        assert_eq!(
            fs::read(app_dir.join("unrelated.txt")).unwrap(),
            b"preserve me"
        );
        assert!(!backup_dir.exists());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn test_recovery_restart_does_not_delete_an_original_already_restored() {
        let app_dir = unique_temp_dir("backup_recovery_restart");
        let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}test"));
        fs::create_dir_all(backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR)).unwrap();
        fs::write(
            app_dir.join("kechimochi_user.db"),
            b"already restored original",
        )
        .unwrap();
        write_backup_swap_phase(&backup_dir, "installing").unwrap();
        write_backup_recovery_marker(&backup_dir, 0, true).unwrap();

        recover_interrupted_backup_installs(&app_dir).unwrap();

        assert_eq!(
            fs::read(app_dir.join("kechimochi_user.db")).unwrap(),
            b"already restored original"
        );
        assert!(!backup_dir.exists());
        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn test_committed_install_keeps_replacement_and_discards_originals() {
        let app_dir = unique_temp_dir("backup_committed_install");
        let backup_dir = app_dir.join(format!("{BACKUP_SWAP_PREFIX}test"));
        let originals_dir = backup_dir.join(BACKUP_SWAP_ORIGINALS_DIR);
        fs::create_dir_all(&originals_dir).unwrap();

        fs::write(originals_dir.join("kechimochi_user.db"), b"original user").unwrap();
        fs::write(app_dir.join("kechimochi_user.db"), b"committed replacement").unwrap();
        write_backup_swap_phase(&backup_dir, "committed").unwrap();

        recover_interrupted_backup_installs(&app_dir).unwrap();

        assert_eq!(
            fs::read(app_dir.join("kechimochi_user.db")).unwrap(),
            b"committed replacement"
        );
        assert!(!backup_dir.exists());

        fs::remove_dir_all(app_dir).ok();
    }
}

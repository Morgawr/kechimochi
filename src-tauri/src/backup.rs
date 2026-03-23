use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, State};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::db;
use crate::DbState;

pub const BACKUP_FORMAT_VERSION: i64 = 1;

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
    let manifest = build_backup_manifest(conn_guard, version)?;
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    let file = File::create(dest_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
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

    let mut buffer = Vec::new();
    for file_name in files_to_backup {
        let path = app_dir.join(file_name);
        if path.exists() {
            zip.start_file(file_name, options)
                .map_err(|e| e.to_string())?;
            let mut f = File::open(&path).map_err(|e| e.to_string())?;
            buffer.clear();
            f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            zip.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }

    // Add covers directory (using walkdir for simplicity)
    let covers_dir = app_dir.join("covers");
    if covers_dir.exists() && covers_dir.is_dir() {
        for entry in WalkDir::new(&covers_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let relative_path = path.strip_prefix(app_dir).map_err(|e| e.to_string())?;
                let zip_path = relative_path.to_string_lossy();
                zip.start_file(zip_path, options)
                    .map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                buffer.clear();
                f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                zip.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }
    }

    let finished_file = zip.finish().map_err(|e| e.to_string())?;
    finished_file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_full_backup(
    app_handle: AppHandle,
    state: State<DbState>,
    file_path: String,
) -> Result<String, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let mut conn_guard = state.conn.lock().unwrap();
    import_full_backup_internal(&app_dir, &mut conn_guard, &file_path)
}

pub fn import_full_backup_internal(
    app_dir: &Path,
    conn_guard: &mut rusqlite::Connection,
    file_path: &str,
) -> Result<String, String> {
    let zip_path = Path::new(file_path);

    let zip_file = File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let extract_dir = app_dir.join("extracted_tmp");
    let backup_dir = app_dir.join("backup_tmp");

    // Clean up any lingering tmp dirs
    let _ = fs::remove_dir_all(&extract_dir);
    let _ = fs::remove_dir_all(&backup_dir);

    fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => extract_dir.join(path),
            None => continue,
        };

        // We only care about files, not directories, in the root
        if file.is_file() {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    // Verify critical files exist
    let user_db = extract_dir.join("kechimochi_user.db");
    let shared_db = extract_dir.join("kechimochi_shared_media.db");
    let local_storage_file = extract_dir.join("local_storage.json");

    if !user_db.exists() {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err("Missing kechimochi_user.db in archive".into());
    }
    if !shared_db.exists() {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err("Missing kechimochi_shared_media.db in archive".into());
    }

    let manifest = match read_backup_manifest(&extract_dir) {
        Ok(manifest) => manifest,
        Err(err) => {
            let _ = fs::remove_dir_all(&extract_dir);
            return Err(err);
        }
    };
    if let Err(err) = validate_extracted_backup(&user_db, &shared_db, manifest.as_ref()) {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(err);
    }

    let local_storage_json = if local_storage_file.exists() {
        fs::read_to_string(&local_storage_file).unwrap_or_else(|_| "{}".to_string())
    } else {
        "{}".to_string()
    };

    let files_to_swap = vec![
        "kechimochi_user.db",
        "kechimochi_user.db-wal",
        "kechimochi_user.db-shm",
        "kechimochi_shared_media.db",
        "kechimochi_shared_media.db-wal",
        "kechimochi_shared_media.db-shm",
        "covers",
    ];

    // Drop active connection by replacing with in-memory DB so windows allows moving files
    *conn_guard = Connection::open_in_memory().unwrap();

    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    // Move current files to backup
    for file_name in &files_to_swap {
        let current_path = app_dir.join(file_name);
        if current_path.exists() {
            let backup_path = backup_dir.join(file_name);
            if let Err(e) = fs::rename(&current_path, &backup_path) {
                // If we fail here, try to rollback what we've moved so far
                rollback_backup(app_dir, &backup_dir, &files_to_swap);
                let _ = fs::remove_dir_all(&extract_dir);
                *conn_guard = db::init_db(app_dir.to_path_buf(), None)
                    .unwrap_or_else(|_| Connection::open_in_memory().unwrap());
                return Err(format!("Failed to move {} to backup: {}", file_name, e));
            }
        }
    }

    // Move extracted files to active directory
    for file_name in &files_to_swap {
        let extracted_path = extract_dir.join(file_name);
        if extracted_path.exists() {
            let active_path = app_dir.join(file_name);
            if let Err(e) = fs::rename(&extracted_path, &active_path) {
                // Rollback if failure
                rollback_backup(app_dir, &backup_dir, &files_to_swap);
                let _ = fs::remove_dir_all(&extract_dir);
                *conn_guard = db::init_db(app_dir.to_path_buf(), None)
                    .unwrap_or_else(|_| Connection::open_in_memory().unwrap());
                return Err(format!(
                    "Failed to move extracted {} to active path: {}",
                    file_name, e
                ));
            }
        }
    }

    // Reinitialize DB
    match db::init_db(app_dir.to_path_buf(), None) {
        Ok(new_conn) => {
            *conn_guard = new_conn;
            // Success cleanup
            let _ = fs::remove_dir_all(&extract_dir);
            let _ = fs::remove_dir_all(&backup_dir);
            Ok(local_storage_json)
        }
        Err(e) => {
            // DB init failed, rollback
            rollback_backup(app_dir, &backup_dir, &files_to_swap);
            *conn_guard = db::init_db(app_dir.to_path_buf(), None)
                .unwrap_or_else(|_| Connection::open_in_memory().unwrap());
            let _ = fs::remove_dir_all(&extract_dir);
            Err(format!("Failed to initialize DB after restore: {}", e))
        }
    }
}

fn rollback_backup(app_dir: &Path, backup_dir: &Path, files: &[&str]) {
    for file_name in files {
        let backup_path = backup_dir.join(file_name);
        let active_path = app_dir.join(file_name);
        if backup_path.exists() {
            if active_path.exists() {
                if active_path.is_dir() {
                    let _ = fs::remove_dir_all(&active_path);
                } else {
                    let _ = fs::remove_file(&active_path);
                }
            }
            let _ = fs::rename(&backup_path, &active_path);
        } else {
            // If the active file shouldn't be here (wasn't backed up) and an extracted file was placed, remove it.
            if active_path.exists() {
                if active_path.is_dir() {
                    let _ = fs::remove_dir_all(&active_path);
                } else {
                    let _ = fs::remove_file(&active_path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

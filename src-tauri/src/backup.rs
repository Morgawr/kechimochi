use rusqlite::Connection;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use tauri::{AppHandle, State};
use zip::{ZipArchive, ZipWriter};
use zip::write::SimpleFileOptions;
use walkdir::WalkDir;

use crate::db;
use crate::DbState;

#[tauri::command]
pub fn export_full_backup(
    app_handle: AppHandle,
    state: State<DbState>,
    file_path: String,
    local_storage: String,
    version: String,
) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    export_full_backup_internal(&app_dir, &state.conn.lock().unwrap(), &file_path, &local_storage, &version)
}

pub fn export_full_backup_internal(
    app_dir: &Path,
    _conn_guard: &rusqlite::Connection, // pass a guard reference to ensure lock is held
    file_path: &str,
    local_storage: &str,
    version: &str,
) -> Result<(), String> {
    let dest_path = Path::new(file_path);

    let file = File::create(dest_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Write version.txt
    zip.start_file("version.txt", options).map_err(|e| e.to_string())?;
    zip.write_all(version.as_bytes()).map_err(|e| e.to_string())?;

    // Write local_storage.json
    zip.start_file("local_storage.json", options).map_err(|e| e.to_string())?;
    zip.write_all(local_storage.as_bytes()).map_err(|e| e.to_string())?;

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
            zip.start_file(file_name, options).map_err(|e| e.to_string())?;
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
                zip.start_file(zip_path, options).map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                buffer.clear();
                f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                zip.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
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
    let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

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
                *conn_guard = db::init_db(app_dir.to_path_buf(), None).unwrap_or_else(|_| Connection::open_in_memory().unwrap());
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
                *conn_guard = db::init_db(app_dir.to_path_buf(), None).unwrap_or_else(|_| Connection::open_in_memory().unwrap());
                return Err(format!("Failed to move extracted {} to active path: {}", file_name, e));
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
            *conn_guard = db::init_db(app_dir.to_path_buf(), None).unwrap_or_else(|_| Connection::open_in_memory().unwrap());
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



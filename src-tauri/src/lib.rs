mod db;
mod models;
mod csv_import;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

use models::{ActivityLog, ActivitySummary, DailyHeatmap, Media};

// Database state
pub struct DbState {
    pub conn: Mutex<Connection>,
}

#[tauri::command]
fn get_all_media(state: State<DbState>) -> Result<Vec<Media>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_all_media(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_media(state: State<DbState>, media: Media) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    db::add_media_with_id(&conn, &media).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_media(state: State<DbState>, media: Media) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::update_media(&conn, &media).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_media(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::delete_media(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_log(state: State<DbState>, log: ActivityLog) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    db::add_log(&conn, &log).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_log(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::delete_log(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_logs(state: State<DbState>) -> Result<Vec<ActivitySummary>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_logs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_heatmap(state: State<DbState>) -> Result<Vec<DailyHeatmap>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_heatmap(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_logs_for_media(state: State<DbState>, media_id: i64) -> Result<Vec<ActivitySummary>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_logs_for_media(&conn, media_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn upload_cover_image(app_handle: tauri::AppHandle, state: State<DbState>, media_id: i64, path: String) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
        
    let img_dir = app_dir.join("covers");
    std::fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;

    let src = std::path::Path::new(&path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let dest_file = format!("{}.{}", media_id, ext);
    let dest = img_dir.join(&dest_file);
    
    let conn = state.conn.lock().unwrap();
    let old_cover: String = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1",
        rusqlite::params![media_id],
        |row| row.get(0),
    ).unwrap_or_default();
    
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() {
            let _ = std::fs::remove_file(old_path);
        }
    }
    
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    
    let dest_str = dest.to_string_lossy().to_string();
    
    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    ).map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_remote_bytes(url: String) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

#[tauri::command]
async fn fetch_external_json(url: String, method: String, body: Option<String>, headers: Option<std::collections::HashMap<String, String>>) -> Result<String, String> {
    let builder = reqwest::Client::builder();
    
    // Set a default user agent, then try to override below if provided
    let default_ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let ua = if let Some(ref h) = headers {
        h.get("User-Agent").map(|s| s.as_str()).unwrap_or(default_ua)
    } else {
        default_ua
    };
    
    let client = builder.user_agent(ua).build().map_err(|e| e.to_string())?;
    
    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };
    
    if let Some(h) = headers {
        for (k, v) in h.iter() {
            if k.eq_ignore_ascii_case("User-Agent") { continue; }
            req = req.header(k, v);
        }
    }
    
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    
    let res = req.send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

#[tauri::command]
async fn download_and_save_image(app_handle: tauri::AppHandle, state: State<'_, DbState>, media_id: i64, url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
        
    let img_dir = app_dir.join("covers");
    std::fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(&url).extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg");
    
    let dest_file = format!("{}_remote.{}", media_id, ext);
    let dest = img_dir.join(&dest_file);
    
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    
    let dest_str = dest.to_string_lossy().to_string();
    
    let conn = state.conn.lock().unwrap();
    let old_cover: String = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1",
        rusqlite::params![media_id],
        |row| row.get(0),
    ).unwrap_or_default();
    
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() && old_cover != dest_str {
            let _ = std::fs::remove_file(old_path);
        }
    }
    
    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    ).map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[tauri::command]
fn import_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    csv_import::import_csv(&mut conn, &file_path)
}

#[tauri::command]
fn export_csv(state: State<DbState>, file_path: String, start_date: Option<String>, end_date: Option<String>) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    let logs = db::get_logs(&conn).map_err(|e| e.to_string())?;
    
    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;
    
    wtr.write_record(&["Date", "Log Name", "Media Type", "Duration", "Language"]).map_err(|e| e.to_string())?;
    
    for log in logs {
        if let Some(start) = &start_date {
            if &log.date < start { continue; }
        }
        if let Some(end) = &end_date {
            if &log.date > end { continue; }
        }
        
        wtr.write_record(&[
            &log.date,
            &log.title,
            &log.media_type,
            &log.duration_minutes.to_string(),
            &log.language
        ]).map_err(|e| e.to_string())?;
        
        count += 1;
    }
    
    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
fn export_media_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::export_media_csv(&conn, &file_path)
}

#[tauri::command]
fn analyze_media_csv(state: State<DbState>, file_path: String) -> Result<Vec<csv_import::MediaConflict>, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::analyze_media_csv(&conn, &file_path)
}

#[tauri::command]
fn apply_media_import(app_handle: tauri::AppHandle, state: State<DbState>, records: Vec<csv_import::MediaCsvRow>) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    csv_import::apply_media_import(&app_handle, &mut conn, records)
}

#[tauri::command]
fn switch_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    let new_conn = db::init_db(&app_handle, &profile_name).map_err(|e| e.to_string())?;
    let mut conn_guard = state.conn.lock().unwrap();
    *conn_guard = new_conn;
    Ok(())
}

#[tauri::command]
fn clear_activities(state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::clear_activities(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn wipe_everything(app_handle: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }
    
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    
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

#[tauri::command]
fn delete_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }
    db::wipe_profile(&app_handle, &profile_name)?;
    Ok(())
}

#[tauri::command]
fn list_profiles(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    db::list_profiles(&app_handle)
}

#[tauri::command]
fn get_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "User".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let profiles = db::list_profiles(app.handle()).unwrap_or_default();
            let conn = if profiles.is_empty() {
                // If no profile exists, start with a temporary in-memory db. 
                // The frontend will force the user to create an initial profile and call switchProfile.
                rusqlite::Connection::open_in_memory().unwrap()
            } else {
                db::init_db(app.handle(), &profiles[0]).expect("Failed to initialize database")
            };
            app.manage(DbState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_media,
            add_media,
            update_media,
            delete_media,
            add_log,
            delete_log,
            get_logs,
            get_heatmap,
            import_csv,
            export_csv,
            export_media_csv,
            analyze_media_csv,
            apply_media_import,
            switch_profile,
            clear_activities,
            wipe_everything,
            delete_profile,
            list_profiles,
            get_logs_for_media,
            upload_cover_image,
            read_file_bytes,
            fetch_remote_bytes,
            fetch_external_json,
            download_and_save_image,
            get_username
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

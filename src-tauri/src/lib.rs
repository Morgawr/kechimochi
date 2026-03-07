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
        "SELECT cover_image FROM media WHERE id = ?1",
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
        "UPDATE media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    ).map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_external_json(url: String, method: String, body: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };
    
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    
    let res = req.send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

#[tauri::command]
async fn download_and_save_image(app_handle: tauri::AppHandle, state: State<'_, DbState>, media_id: i64, url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
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
        "SELECT cover_image FROM media WHERE id = ?1",
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
        "UPDATE media SET cover_image = ?1 WHERE id = ?2",
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
fn switch_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    let new_conn = db::init_db(&app_handle, &profile_name).map_err(|e| e.to_string())?;
    let mut conn_guard = state.conn.lock().unwrap();
    *conn_guard = new_conn;
    Ok(())
}

#[tauri::command]
fn wipe_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    // Drop the current connection if we are wiping it so windows doesn't barf on locks (though we are on linux it's good practice)
    // Actually sqlite will allow deletion but further writes will fail. 
    // Usually wiping implies switching back later or recreation
    // Let's just create a temporary in-memory so the file is fully freed
    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }
    
    db::wipe_profile(&app_handle, &profile_name)?;
    
    // Re-initialize a blank database for it
    let new_conn = db::init_db(&app_handle, &profile_name).map_err(|e| e.to_string())?;
    let mut conn_guard = state.conn.lock().unwrap();
    *conn_guard = new_conn;
    
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let profiles = db::list_profiles(app.handle()).unwrap_or_default();
            let initial_profile = if profiles.is_empty() {
                "default".to_string()
            } else {
                profiles[0].clone()
            };
            let conn = db::init_db(app.handle(), &initial_profile).expect("Failed to initialize database");
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
            switch_profile,
            wipe_profile,
            delete_profile,
            list_profiles,
            get_logs_for_media,
            upload_cover_image,
            read_file_bytes,
            fetch_external_json,
            download_and_save_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

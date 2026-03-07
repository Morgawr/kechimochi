use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

use kechimochi_core::models::{ActivityLog, ActivitySummary, DailyHeatmap, Media};

// Database state
pub struct DbState {
    pub conn: Mutex<Connection>,
}

#[tauri::command]
fn get_all_media(state: State<DbState>) -> Result<Vec<Media>, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::get_all_media(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_media(state: State<DbState>, media: Media) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::add_media_with_id(&conn, &media).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_media(state: State<DbState>, media: Media) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::update_media(&conn, &media).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_media(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::delete_media(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_log(state: State<DbState>, log: ActivityLog) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::add_log(&conn, &log).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_log(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::delete_log(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_logs(state: State<DbState>) -> Result<Vec<ActivitySummary>, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::get_logs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_heatmap(state: State<DbState>) -> Result<Vec<DailyHeatmap>, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::get_heatmap(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_logs_for_media(state: State<DbState>, media_id: i64) -> Result<Vec<ActivitySummary>, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::db::get_logs_for_media(&conn, media_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn upload_cover_image(app_handle: tauri::AppHandle, state: State<DbState>, media_id: i64, path: String) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let covers_dir = app_dir.join("covers");
    let conn = state.conn.lock().unwrap();
    kechimochi_core::covers::upload_cover_from_path(&conn, &covers_dir, media_id, &path)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    kechimochi_core::covers::read_file_bytes(&path)
}

#[tauri::command]
async fn fetch_external_json(url: String, method: String, body: Option<String>) -> Result<String, String> {
    kechimochi_core::covers::fetch_external_json(&url, &method, body).await
}

#[tauri::command]
async fn download_and_save_image(app_handle: tauri::AppHandle, state: State<'_, DbState>, media_id: i64, url: String) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let covers_dir = app_dir.join("covers");

    // Download the image first (no lock held across await)
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(&url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg");
    let dest_file = format!("{}_remote.{}", media_id, ext);

    // Now lock and save
    let conn = state.conn.lock().unwrap();
    kechimochi_core::covers::save_cover(&conn, &covers_dir, media_id, &dest_file, &bytes)
}

#[tauri::command]
fn import_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    kechimochi_core::csv_import::import_csv(&mut conn, &file_path)
}

#[tauri::command]
fn export_csv(state: State<DbState>, file_path: String, start_date: Option<String>, end_date: Option<String>) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    kechimochi_core::csv_import::export_csv(
        &conn,
        &file_path,
        start_date.as_deref(),
        end_date.as_deref(),
    )
}

#[tauri::command]
fn switch_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let new_conn = kechimochi_core::db::init_db(&app_dir, &profile_name).map_err(|e| e.to_string())?;
    let mut conn_guard = state.conn.lock().unwrap();
    *conn_guard = new_conn;
    Ok(())
}

#[tauri::command]
fn wipe_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }

    kechimochi_core::db::wipe_profile(&app_dir, &profile_name)?;

    // Re-initialize a blank database for it
    let new_conn = kechimochi_core::db::init_db(&app_dir, &profile_name).map_err(|e| e.to_string())?;
    let mut conn_guard = state.conn.lock().unwrap();
    *conn_guard = new_conn;

    Ok(())
}

#[tauri::command]
fn delete_profile(app_handle: tauri::AppHandle, state: State<DbState>, profile_name: String) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }
    kechimochi_core::db::wipe_profile(&app_dir, &profile_name)?;
    Ok(())
}

#[tauri::command]
fn list_profiles(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    kechimochi_core::db::list_profiles(&app_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .handle()
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let profiles = kechimochi_core::db::list_profiles(&app_dir).unwrap_or_default();
            let initial_profile = if profiles.is_empty() {
                "default".to_string()
            } else {
                profiles[0].clone()
            };
            let conn = kechimochi_core::db::init_db(&app_dir, &initial_profile)
                .expect("Failed to initialize database");
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

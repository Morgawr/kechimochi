pub mod backup;
pub mod csv_import;
pub mod db;
pub mod models;
pub mod profile_picture;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

use models::{
    ActivityLog, ActivitySummary, DailyHeatmap, Media, Milestone, ProfilePicture, TimelineEvent,
};

// Database state
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
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
fn update_log(state: State<DbState>, log: ActivityLog) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::update_log(&conn, &log).map_err(|e| e.to_string())
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
fn get_logs_for_media(
    state: State<DbState>,
    media_id: i64,
) -> Result<Vec<ActivitySummary>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_logs_for_media(&conn, media_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_timeline_events(state: State<DbState>) -> Result<Vec<TimelineEvent>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_timeline_events(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_milestones(state: State<DbState>, media_title: String) -> Result<Vec<Milestone>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_milestones_for_media(&conn, &media_title).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_milestone(state: State<DbState>, milestone: Milestone) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    db::add_milestone(&conn, &milestone).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_milestone(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::delete_milestone(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_milestones_for_media(state: State<DbState>, media_title: String) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::delete_milestones_for_media(&conn, &media_title).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_milestone(state: State<DbState>, milestone: Milestone) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::update_milestone(&conn, &milestone).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_milestones_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::export_milestones_csv(&conn, &file_path)
}

#[tauri::command]
fn import_milestones_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    csv_import::import_milestones_csv(&mut conn, &file_path)
}

#[tauri::command]
fn upload_cover_image(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    media_id: i64,
    path: String,
) -> Result<String, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let covers_dir = app_dir.join("covers");
    let conn = state.conn.lock().unwrap();
    db::save_cover_image(&conn, covers_dir, media_id, std::path::Path::new(&path))
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
async fn fetch_external_json(
    url: String,
    method: String,
    body: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let builder = reqwest::Client::builder();

    // Set a default user agent, then try to override below if provided
    let default_ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let ua = if let Some(ref h) = headers {
        h.get("User-Agent")
            .map(|s| s.as_str())
            .unwrap_or(default_ua)
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
            if k.eq_ignore_ascii_case("User-Agent") {
                continue;
            }
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
async fn download_and_save_image(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
    media_id: i64,
    url: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let bytes_vec = bytes.to_vec();

    let app_dir = db::get_data_dir(&app_handle);
    let covers_dir = app_dir.join("covers");

    let ext = std::path::Path::new(&url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg");

    let conn = state.conn.lock().unwrap();
    db::save_cover_bytes(&conn, covers_dir, media_id, bytes_vec, ext)
}

#[tauri::command]
fn import_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    csv_import::import_csv(&mut conn, &file_path)
}

#[tauri::command]
fn export_csv(
    state: State<DbState>,
    file_path: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::export_logs_csv(&conn, &file_path, start_date, end_date)
}

#[tauri::command]
fn export_media_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::export_media_csv(&conn, &file_path)
}

#[tauri::command]
fn analyze_media_csv(
    state: State<DbState>,
    file_path: String,
) -> Result<Vec<csv_import::MediaConflict>, String> {
    let conn = state.conn.lock().unwrap();
    csv_import::analyze_media_csv(&conn, &file_path)
}

#[tauri::command]
fn apply_media_import(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    records: Vec<csv_import::MediaCsvRow>,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().unwrap();
    let app_dir = db::get_data_dir(&app_handle);
    let covers_dir = app_dir.join("covers");
    csv_import::apply_media_import(covers_dir, &mut conn, records)
}

#[tauri::command]
fn initialize_user_db(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    fallback_username: Option<String>,
) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    let new_conn = db::init_db(app_dir, fallback_username.as_deref()).map_err(|e| e.to_string())?;
    *state.conn.lock().unwrap() = new_conn;
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

    let app_dir = db::get_data_dir(&app_handle);
    db::wipe_everything(app_dir)
}

#[tauri::command]
fn set_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_username() -> String {
    get_username_logic()
}

#[tauri::command]
fn get_profile_picture(state: State<DbState>) -> Result<Option<ProfilePicture>, String> {
    let conn = state.conn.lock().unwrap();
    db::get_profile_picture(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn upload_profile_picture(state: State<DbState>, path: String) -> Result<ProfilePicture, String> {
    let profile_picture = profile_picture::process_profile_picture_file(&path)?;
    let conn = state.conn.lock().unwrap();
    db::upsert_profile_picture(&conn, &profile_picture).map_err(|e| e.to_string())?;
    Ok(profile_picture)
}

#[tauri::command]
fn delete_profile_picture(state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::delete_profile_picture(&conn).map_err(|e| e.to_string())
}

pub fn get_username_logic() -> String {
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
            let app_dir = db::get_data_dir(app.handle());
            let user_db_path = app_dir.join("kechimochi_user.db");
            let conn = if user_db_path.exists() {
                db::init_db(app_dir, None).expect("Failed to initialize database")
            } else {
                // If no user DB exists, start with a temporary in-memory db.
                // The frontend will force the user to create an initial profile and call initialize_user_db.
                rusqlite::Connection::open_in_memory().unwrap()
            };
            app.manage(DbState {
                conn: Arc::new(Mutex::new(conn)),
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
            update_log,
            get_logs,
            get_heatmap,
            import_csv,
            export_csv,
            export_media_csv,
            analyze_media_csv,
            apply_media_import,
            initialize_user_db,
            clear_activities,
            wipe_everything,
            get_logs_for_media,
            get_timeline_events,
            get_milestones,
            add_milestone,
            delete_milestone,
            update_milestone,
            export_milestones_csv,
            import_milestones_csv,
            delete_milestones_for_media,
            upload_cover_image,
            read_file_bytes,
            fetch_remote_bytes,
            fetch_external_json,
            download_and_save_image,
            get_username,
            get_profile_picture,
            upload_profile_picture,
            delete_profile_picture,
            set_setting,
            get_setting,
            backup::export_full_backup,
            backup::import_full_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

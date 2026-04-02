pub mod backup;
pub mod csv_import;
pub mod db;
pub mod models;
pub mod profile_picture;
pub mod sync_auth;
pub mod sync_cover_blobs;
pub mod sync_drive;
pub mod sync_merge;
pub mod sync_orchestrator;
pub mod sync_snapshot;
pub mod sync_state;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

use models::{
    ActivityLog, ActivitySummary, DailyHeatmap, Media, Milestone, ProfilePicture, TimelineEvent,
};

// Database state
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

fn with_conn<T, F>(state: &State<DbState>, operation: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let conn = state.conn.lock().unwrap();
    operation(&conn)
}

fn with_conn_mut<T, F>(state: &State<DbState>, operation: F) -> Result<T, String>
where
    F: FnOnce(&mut Connection) -> Result<T, String>,
{
    let mut conn = state.conn.lock().unwrap();
    operation(&mut conn)
}

fn mark_sync_dirty(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_dir = db::get_data_dir(app_handle);
    sync_state::mark_sync_dirty_if_configured(&app_dir)?;
    Ok(())
}

fn run_dirty_command<T, F>(app_handle: &tauri::AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let result = operation()?;
    mark_sync_dirty(app_handle)?;
    Ok(result)
}

#[tauri::command]
fn get_all_media(state: State<DbState>) -> Result<Vec<Media>, String> {
    with_conn(&state, |conn| {
        db::get_all_media(conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn add_media(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    media: Media,
) -> Result<i64, String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::add_media_with_id(conn, &media).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn update_media(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    media: Media,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::update_media(conn, &media).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn delete_media(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    id: i64,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::delete_media(conn, id).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn add_log(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    log: ActivityLog,
) -> Result<i64, String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::add_log(conn, &log).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn delete_log(app_handle: tauri::AppHandle, state: State<DbState>, id: i64) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::delete_log(conn, id).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn update_log(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    log: ActivityLog,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::update_log(conn, &log).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn get_logs(state: State<DbState>) -> Result<Vec<ActivitySummary>, String> {
    with_conn(&state, |conn| db::get_logs(conn).map_err(|e| e.to_string()))
}

#[tauri::command]
fn get_heatmap(state: State<DbState>) -> Result<Vec<DailyHeatmap>, String> {
    with_conn(&state, |conn| {
        db::get_heatmap(conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_logs_for_media(
    state: State<DbState>,
    media_id: i64,
) -> Result<Vec<ActivitySummary>, String> {
    with_conn(&state, |conn| {
        db::get_logs_for_media(conn, media_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_timeline_events(state: State<DbState>) -> Result<Vec<TimelineEvent>, String> {
    with_conn(&state, |conn| {
        db::get_timeline_events(conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_milestones(state: State<DbState>, media_title: String) -> Result<Vec<Milestone>, String> {
    with_conn(&state, |conn| {
        db::get_milestones_for_media(conn, &media_title).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn add_milestone(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    milestone: Milestone,
) -> Result<i64, String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::add_milestone(conn, &milestone).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn delete_milestone(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    id: i64,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::delete_milestone(conn, id).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn delete_milestones_for_media(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    media_title: String,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::delete_milestones_for_media(conn, &media_title).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn update_milestone(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    milestone: Milestone,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::update_milestone(conn, &milestone).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn export_milestones_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    with_conn(&state, |conn| {
        csv_import::export_milestones_csv(conn, &file_path)
    })
}

#[tauri::command]
fn import_milestones_csv(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    file_path: String,
) -> Result<usize, String> {
    run_dirty_command(&app_handle, || {
        with_conn_mut(&state, |conn| {
            csv_import::import_milestones_csv(conn, &file_path)
        })
    })
}

#[tauri::command]
fn upload_cover_image(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    media_id: i64,
    path: String,
) -> Result<String, String> {
    let covers_dir = db::get_data_dir(&app_handle).join("covers");
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::save_cover_image(conn, covers_dir, media_id, std::path::Path::new(&path))
        })
    })
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

    let covers_dir = db::get_data_dir(&app_handle).join("covers");

    let ext = std::path::Path::new(&url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg");

    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::save_cover_bytes(conn, covers_dir, media_id, bytes_vec, ext)
        })
    })
}

#[tauri::command]
fn import_csv(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    file_path: String,
) -> Result<usize, String> {
    run_dirty_command(&app_handle, || {
        with_conn_mut(&state, |conn| csv_import::import_csv(conn, &file_path))
    })
}

#[tauri::command]
fn export_csv(
    state: State<DbState>,
    file_path: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    with_conn(&state, |conn| {
        csv_import::export_logs_csv(conn, &file_path, start_date, end_date)
    })
}

#[tauri::command]
fn export_media_csv(state: State<DbState>, file_path: String) -> Result<usize, String> {
    with_conn(&state, |conn| {
        csv_import::export_media_csv(conn, &file_path)
    })
}

#[tauri::command]
fn analyze_media_csv(
    state: State<DbState>,
    file_path: String,
) -> Result<Vec<csv_import::MediaConflict>, String> {
    with_conn(&state, |conn| {
        csv_import::analyze_media_csv(conn, &file_path)
    })
}

#[tauri::command]
fn apply_media_import(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    records: Vec<csv_import::MediaCsvRow>,
) -> Result<usize, String> {
    let covers_dir = db::get_data_dir(&app_handle).join("covers");
    run_dirty_command(&app_handle, || {
        with_conn_mut(&state, |conn| {
            csv_import::apply_media_import(covers_dir, conn, records)
        })
    })
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
fn clear_activities(app_handle: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::clear_activities(conn).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn wipe_everything(app_handle: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    {
        let mut conn_guard = state.conn.lock().unwrap();
        *conn_guard = rusqlite::Connection::open_in_memory().unwrap();
    }

    let app_dir = db::get_data_dir(&app_handle);
    sync_state::clear_sync_runtime_files(&app_dir)?;
    db::wipe_everything(app_dir)
}

#[tauri::command]
fn set_setting(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::set_setting(conn, &key, &value).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    with_conn(&state, |conn| {
        db::get_setting(conn, &key).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_username() -> String {
    get_username_logic()
}

#[tauri::command]
fn get_profile_picture(state: State<DbState>) -> Result<Option<ProfilePicture>, String> {
    with_conn(&state, |conn| {
        db::get_profile_picture(conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn upload_profile_picture(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    path: String,
) -> Result<ProfilePicture, String> {
    let profile_picture = profile_picture::process_profile_picture_file(&path)?;
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::upsert_profile_picture(conn, &profile_picture).map_err(|e| e.to_string())?;
            Ok(profile_picture.clone())
        })
    })
}

#[tauri::command]
fn delete_profile_picture(
    app_handle: tauri::AppHandle,
    state: State<DbState>,
) -> Result<(), String> {
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::delete_profile_picture(conn).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
fn get_sync_status(app_handle: tauri::AppHandle) -> Result<sync_state::SyncStatus, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let token_store = sync_auth::OsSecureTokenStore::default();
    let google_authenticated = match sync_auth::has_google_drive_tokens(&token_store) {
        Ok(authenticated) => authenticated,
        Err(err) => {
            if sync_state::load_sync_config(&app_dir)?.is_some() {
                return Err(err);
            }
            false
        }
    };
    let google_account_email =
        sync_auth::load_google_account_email(&token_store).unwrap_or_default();
    sync_state::get_sync_status(&app_dir, google_authenticated, google_account_email)
}

#[tauri::command]
async fn connect_google_drive(
    app_handle: tauri::AppHandle,
) -> Result<sync_auth::GoogleDriveAuthSession, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();

    sync_auth::connect_google_drive_with_browser(&app_dir, &config, &token_store, |auth_url| {
        app_handle
            .opener()
            .open_url(auth_url, None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn list_remote_sync_profiles(
    _app_handle: tauri::AppHandle,
) -> Result<Vec<sync_orchestrator::RemoteSyncProfileSummary>, String> {
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();
    sync_orchestrator::list_remote_sync_profiles(&config, &token_store).await
}

#[tauri::command]
async fn create_remote_sync_profile(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();
    let conn = state.conn.clone();
    sync_orchestrator::create_remote_sync_profile(&app_dir, &conn, &config, &token_store, None)
        .await
}

#[tauri::command]
async fn attach_remote_sync_profile(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();
    let conn = state.conn.clone();
    sync_orchestrator::attach_remote_sync_profile(
        &app_dir,
        &conn,
        &config,
        &token_store,
        &profile_id,
        None,
    )
    .await
}

#[tauri::command]
async fn run_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();
    let conn = state.conn.clone();
    sync_orchestrator::run_sync(&app_dir, &conn, &config, &token_store).await
}

#[tauri::command]
fn get_sync_conflicts(
    app_handle: tauri::AppHandle,
) -> Result<Vec<sync_merge::SyncConflict>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    sync_orchestrator::get_sync_conflicts(&app_dir)
}

#[tauri::command]
async fn resolve_sync_conflict(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
    conflict_index: usize,
    resolution: sync_orchestrator::SyncConflictResolution,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let config = sync_auth::GoogleOAuthClientConfig::from_env()?;
    let token_store = sync_auth::OsSecureTokenStore::default();
    let conn = state.conn.clone();
    sync_orchestrator::resolve_sync_conflict(
        &app_dir,
        &conn,
        &config,
        &token_store,
        conflict_index,
        resolution,
    )
    .await
}

#[tauri::command]
fn disconnect_google_drive(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    let token_store = sync_auth::OsSecureTokenStore::default();
    sync_auth::disconnect_google_drive_data(&app_dir, &token_store)
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
            get_sync_status,
            connect_google_drive,
            list_remote_sync_profiles,
            create_remote_sync_profile,
            attach_remote_sync_profile,
            run_sync,
            get_sync_conflicts,
            resolve_sync_conflict,
            disconnect_google_drive,
            set_setting,
            get_setting,
            backup::export_full_backup,
            backup::import_full_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

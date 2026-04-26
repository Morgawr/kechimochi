pub mod cli_env;
pub mod app_file_io;
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

use serde::{Deserialize, Serialize};
use rusqlite::Connection;
use std::fs::File;
use std::future::Future;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State};
#[cfg(not(target_os = "android"))]
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use models::{
    ActivityLog, ActivitySummary, DailyHeatmap, Media, Milestone, ProfilePicture, TimelineEvent,
};

// Database state
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

pub struct StartupState {
    pub error: Option<String>,
}

const SYNC_COMMAND_TIMEOUT_SECS: u64 = 120;
const CREATE_SYNC_PROFILE_TIMEOUT_SECS: u64 = 900;
const RECOVERY_SYNC_TIMEOUT_SECS: u64 = 900;
const SYNC_PROGRESS_EVENT: &str = "sync-progress";
#[cfg(not(target_os = "android"))]
const SYNC_TEST_AUTO_OPEN_ENV: &str = "KECHIMOCHI_SYNC_TEST_AUTO_OPEN";
const SKIP_LEGACY_LOCAL_PROFILE_MIGRATION_ENV: &str =
    "KECHIMOCHI_E2E_SKIP_LEGACY_LOCAL_PROFILE_MIGRATION";

type SyncTokenStore = Box<dyn sync_auth::SecureTokenStore>;
type SyncDbConn = Arc<Mutex<Connection>>;

pub struct GoogleAuthMobileState(pub Option<tauri::plugin::PluginHandle<tauri::Wry>>);

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Default)]
struct AndroidGoogleAuthRequest;

#[cfg(target_os = "android")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidGoogleClearTokenRequest {
    access_token: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidGoogleAuthResponse {
    access_token: String,
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

fn google_oauth_config(
    app_handle: &tauri::AppHandle,
) -> Result<sync_auth::GoogleOAuthClientConfig, String> {
    sync_auth::GoogleOAuthClientConfig::from_plugin_or_env(
        app_handle.config().plugins.0.get("kechimochiSync"),
    )
}

fn sync_token_store() -> Box<dyn sync_auth::SecureTokenStore> {
    sync_auth::default_secure_token_store()
}

fn sync_command_setup(
    app_handle: &tauri::AppHandle,
) -> Result<
    (
        std::path::PathBuf,
        sync_auth::GoogleOAuthClientConfig,
        SyncTokenStore,
    ),
    String,
> {
    Ok((
        db::get_data_dir(app_handle),
        google_oauth_config(app_handle)?,
        sync_token_store(),
    ))
}

#[cfg(target_os = "android")]
async fn ensure_android_google_drive_access_token(
    app_handle: &tauri::AppHandle,
    token_store: &dyn sync_auth::SecureTokenStore,
) -> Result<(), String> {
    let google_auth_mobile = app_handle.state::<GoogleAuthMobileState>();
    let plugin = google_auth_mobile
        .0
        .as_ref()
        .ok_or_else(|| "Google Drive sign-in is unavailable on this Android build.".to_string())?;
    let response: AndroidGoogleAuthResponse = plugin
        .run_mobile_plugin("authorizeGoogleDrive", AndroidGoogleAuthRequest)
        .map_err(|e| e.to_string())?;
    sync_auth::persist_google_drive_android_access_token(token_store, &response.access_token).await
}

#[cfg(not(target_os = "android"))]
async fn ensure_android_google_drive_access_token(
    _app_handle: &tauri::AppHandle,
    _token_store: &dyn sync_auth::SecureTokenStore,
) -> Result<(), String> {
    Ok(())
}

fn sync_progress_reporter(
    app_handle: tauri::AppHandle,
    activity_tx: Option<tokio::sync::mpsc::UnboundedSender<()>>,
) -> impl Fn(sync_orchestrator::SyncProgressUpdate) + Send + Sync + 'static {
    move |update| {
        if let Some(activity_tx) = activity_tx.as_ref() {
            let _ = activity_tx.send(());
        }
        let _ = app_handle.emit(SYNC_PROGRESS_EVENT, update);
    }
}

#[cfg(not(target_os = "android"))]
fn should_auto_open_sync_auth() -> bool {
    matches!(
        std::env::var(SYNC_TEST_AUTO_OPEN_ENV).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES")
    )
}

#[cfg(not(target_os = "android"))]
async fn auto_open_sync_auth_url(auth_url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    client
        .get(auth_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn with_sync_command_timeout<T, F>(
    operation_name: &str,
    timeout_secs: u64,
    mut activity_rx: Option<tokio::sync::mpsc::UnboundedReceiver<()>>,
    operation: F,
) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    if activity_rx.is_none() {
        return match tokio::time::timeout(Duration::from_secs(timeout_secs), operation).await {
            Ok(result) => result,
            Err(_) => Err(format!("{operation_name} timed out. Please try again.")),
        };
    }

    let timeout = Duration::from_secs(timeout_secs);
    tokio::pin!(operation);
    let sleep = tokio::time::sleep(timeout);
    tokio::pin!(sleep);

    loop {
        tokio::select! {
            result = &mut operation => return result,
            maybe_activity = async {
                match activity_rx.as_mut() {
                    Some(rx) => rx.recv().await,
                    None => std::future::pending::<Option<()>>().await,
                }
            } => {
                match maybe_activity {
                    Some(_) => sleep.as_mut().reset(tokio::time::Instant::now() + timeout),
                    None => activity_rx = None,
                }
            },
            _ = &mut sleep => {
                return Err(format!(
                    "{operation_name} timed out while waiting for sync progress. Please try again."
                ));
            }
        }
    }
}

async fn with_sync_command<T, F, Fut>(
    app_handle: &tauri::AppHandle,
    operation_name: &str,
    timeout_secs: u64,
    activity_rx: Option<tokio::sync::mpsc::UnboundedReceiver<()>>,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce(std::path::PathBuf, sync_auth::GoogleOAuthClientConfig, SyncTokenStore) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let (app_dir, config, token_store) = sync_command_setup(app_handle)?;
    ensure_android_google_drive_access_token(app_handle, token_store.as_ref()).await?;
    with_sync_command_timeout(
        operation_name,
        timeout_secs,
        activity_rx,
        operation(app_dir, config, token_store),
    )
    .await
}

async fn with_sync_db_command<T, F, Fut>(
    app_handle: &tauri::AppHandle,
    state: &State<'_, DbState>,
    operation_name: &str,
    timeout_secs: u64,
    activity_rx: Option<tokio::sync::mpsc::UnboundedReceiver<()>>,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce(
        std::path::PathBuf,
        SyncDbConn,
        sync_auth::GoogleOAuthClientConfig,
        SyncTokenStore,
    ) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let conn = state.conn.clone();
    with_sync_command(
        app_handle,
        operation_name,
        timeout_secs,
        activity_rx,
        move |app_dir, config, token_store| operation(app_dir, conn, config, token_store),
    )
    .await
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
    let file = app_file_io::open_input_file(&app_handle, &file_path)?;
    run_dirty_command(&app_handle, || {
        with_conn_mut(&state, |conn| {
            csv_import::import_milestones_csv_from_reader(conn, file)
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
    let bytes = app_file_io::read_input_bytes(&app_handle, &path)?;
    let extension = app_file_io::infer_image_extension(&app_handle, &path, &bytes);
    run_dirty_command(&app_handle, || {
        with_conn(&state, |conn| {
            db::save_cover_bytes(conn, covers_dir, media_id, bytes, &extension)
        })
    })
}

#[tauri::command]
fn read_file_bytes(app_handle: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    app_file_io::read_input_bytes(&app_handle, &path)
}

fn read_text_file_logic(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    read_text_file_logic(&path)
}

fn write_text_file_logic(path: &str, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    write_text_file_logic(&path, &contents)
}

pub fn theme_packs_dir<P: AsRef<Path>>(app_dir: P) -> PathBuf {
    app_dir.as_ref().join("theme-packs")
}

const THEME_PACK_MANIFEST_NAME: &str = "theme.json";
const THEME_PACK_ZIP_SIGNATURE: &[u8] = b"PK\x03\x04";
const MAX_THEME_PACK_IMPORT_BYTES: usize = 128 * 1024 * 1024;

pub fn theme_pack_file_name(theme_id: &str) -> Result<String, String> {
    let trimmed = theme_id.trim();
    if trimmed.is_empty() {
        return Err("Theme id is required".to_string());
    }

    let mut encoded = String::with_capacity(trimmed.len() * 2);
    for byte in trimmed.as_bytes() {
        encoded.push_str(&format!("{:02x}", byte));
    }

    Ok(format!("{}.json", encoded))
}

fn theme_pack_dir_name(theme_id: &str) -> Result<String, String> {
    let trimmed = theme_id.trim();
    if trimmed.is_empty() {
        return Err("Theme id is required".to_string());
    }

    let mut encoded = String::with_capacity(trimmed.len() * 2);
    for byte in trimmed.as_bytes() {
        encoded.push_str(&format!("{:02x}", byte));
    }

    Ok(encoded)
}

#[derive(Deserialize)]
struct ThemePackIdentity {
    id: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ThemePackSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_assets: Option<bool>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedThemePackFile {
    pub theme_id: String,
    pub theme_name: String,
    pub content: String,
    pub file_name: Option<String>,
}

#[derive(Clone, Debug)]
struct StoredThemePackEntry {
    manifest_path: PathBuf,
    root_path: PathBuf,
    has_assets: bool,
    is_legacy_file: bool,
}

fn parse_theme_pack_id(content: &str) -> Option<String> {
    serde_json::from_str::<ThemePackIdentity>(content)
        .ok()
        .map(|theme| theme.id.trim().to_string())
        .filter(|theme_id| !theme_id.is_empty())
}

fn parse_theme_pack_summary(content: &str) -> Option<ThemePackSummary> {
    serde_json::from_str::<ThemePackSummary>(content)
        .ok()
        .map(|theme| ThemePackSummary {
            id: theme.id.trim().to_string(),
            name: theme.name.trim().to_string(),
            version: theme.version,
            has_assets: theme.has_assets,
        })
        .filter(|theme| !theme.id.is_empty() && !theme.name.is_empty())
}

fn list_theme_pack_entries_logic(themes_dir: &Path) -> Result<Vec<StoredThemePackEntry>, String> {
    if !themes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(themes_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            entries.push(StoredThemePackEntry {
                manifest_path: path.clone(),
                root_path: path,
                has_assets: false,
                is_legacy_file: true,
            });
            continue;
        }

        if path.is_dir() {
            let manifest_path = path.join(THEME_PACK_MANIFEST_NAME);
            if manifest_path.exists() {
                entries.push(StoredThemePackEntry {
                    manifest_path,
                    root_path: path,
                    has_assets: true,
                    is_legacy_file: false,
                });
            }
        }
    }

    entries.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
    Ok(entries)
}

fn sanitize_theme_pack_file_name(preferred_file_name: &str) -> Option<String> {
    let base_name = Path::new(preferred_file_name).file_name()?.to_str()?.trim();
    if base_name.is_empty() {
        return None;
    }

    let sanitized = base_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ' | '(' | ')' | '[' | ']') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches(|ch| ch == ' ' || ch == '.' || ch == '-');
    if sanitized.is_empty() {
        return None;
    }

    let stem = Path::new(sanitized).file_stem()?.to_str()?.trim_matches(|ch| ch == ' ' || ch == '.' || ch == '-');
    if stem.is_empty() {
        return None;
    }

    Some(format!("{}.json", stem))
}

fn theme_pack_bundle_root(themes_dir: &Path, theme_id: &str) -> Result<PathBuf, String> {
    Ok(themes_dir.join(theme_pack_dir_name(theme_id)?))
}

fn normalize_theme_pack_asset_path(asset_path: &str) -> Result<PathBuf, String> {
    let normalized = asset_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("Theme asset path is required".to_string());
    }

    let path = Path::new(&normalized);
    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(value) => sanitized.push(value),
            _ => return Err("Theme asset path must stay within the pack bundle".to_string()),
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err("Theme asset path is required".to_string());
    }

    Ok(sanitized)
}

fn read_theme_pack_manifest(entry: &StoredThemePackEntry) -> Result<String, String> {
    std::fs::read_to_string(&entry.manifest_path).map_err(|e| e.to_string())
}

fn find_theme_pack_entries_for_id(themes_dir: &Path, theme_id: &str) -> Result<Vec<StoredThemePackEntry>, String> {
    let trimmed_theme_id = theme_id.trim();
    let mut matches = Vec::new();

    for entry in list_theme_pack_entries_logic(themes_dir)? {
        match read_theme_pack_manifest(&entry) {
            Ok(content) => {
                if parse_theme_pack_id(&content).as_deref() == Some(trimmed_theme_id) {
                    matches.push(entry);
                }
            }
            Err(error) => {
                eprintln!("[kechimochi] Failed to inspect theme pack {}: {}", entry.manifest_path.display(), error);
            }
        }
    }

    matches.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
    Ok(matches)
}

fn build_unique_theme_pack_path(themes_dir: &Path, file_name: &str, existing_paths: &[StoredThemePackEntry]) -> PathBuf {
    let preferred_path = themes_dir.join(file_name);
    if !preferred_path.exists() || existing_paths.iter().any(|entry| entry.root_path == preferred_path) {
        return preferred_path;
    }

    let template = Path::new(file_name);
    let stem = template.file_stem().and_then(|value| value.to_str()).unwrap_or("theme");
    let extension = template.extension().and_then(|value| value.to_str()).unwrap_or("json");

    let mut counter = 2;
    loop {
        let candidate = themes_dir.join(format!("{}-{}.{}", stem, counter, extension));
        if !candidate.exists() || existing_paths.iter().any(|entry| entry.root_path == candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn remove_theme_pack_entry(entry: &StoredThemePackEntry) -> Result<(), String> {
    if entry.is_legacy_file {
        if entry.root_path.exists() {
            std::fs::remove_file(&entry.root_path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if entry.root_path.exists() {
        std::fs::remove_dir_all(&entry.root_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn save_theme_pack_bundle_logic(
    themes_dir: &Path,
    theme_id: &str,
    manifest_content: &str,
    asset_files: &[(PathBuf, Vec<u8>)],
) -> Result<(), String> {
    for entry in find_theme_pack_entries_for_id(themes_dir, theme_id)? {
        remove_theme_pack_entry(&entry)?;
    }

    let bundle_root = theme_pack_bundle_root(themes_dir, theme_id)?;
    std::fs::create_dir_all(&bundle_root).map_err(|e| e.to_string())?;
    std::fs::write(bundle_root.join(THEME_PACK_MANIFEST_NAME), manifest_content).map_err(|e| e.to_string())?;

    for (relative_path, bytes) in asset_files {
        let target_path = bundle_root.join(relative_path);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(target_path, bytes).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn is_zip_theme_pack(bytes: &[u8], file_name: Option<&str>) -> bool {
    bytes.starts_with(THEME_PACK_ZIP_SIGNATURE)
        || file_name
            .and_then(|name| Path::new(name).extension().and_then(|ext| ext.to_str()))
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

fn import_json_theme_pack_logic(
    themes_dir: &Path,
    content: String,
    file_name: Option<&str>,
) -> Result<ImportedThemePackFile, String> {
    let summary = parse_theme_pack_summary(&content)
        .ok_or_else(|| "Theme pack file is missing a valid id and name.".to_string())?;
    save_theme_pack_logic(themes_dir, &summary.id, &content, file_name)?;
    Ok(ImportedThemePackFile {
        theme_id: summary.id,
        theme_name: summary.name,
        content,
        file_name: file_name.map(|value| value.to_string()),
    })
}

fn import_zip_theme_pack_logic(
    themes_dir: &Path,
    bytes: &[u8],
    file_name: Option<&str>,
) -> Result<ImportedThemePackFile, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Failed to read theme pack archive: {e}"))?;
    let mut manifest_content: Option<String> = None;
    let mut asset_files: Vec<(PathBuf, Vec<u8>)> = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        if !file.is_file() {
            continue;
        }

        let enclosed = file.enclosed_name().ok_or_else(|| "Theme pack archive contains an unsafe file path.".to_string())?;
        let relative_path = enclosed.to_path_buf();
        let mut file_bytes = Vec::new();
        file.read_to_end(&mut file_bytes).map_err(|e| e.to_string())?;

        if file_bytes.len() > MAX_THEME_PACK_IMPORT_BYTES {
            return Err("Theme pack archive contains an asset that is too large.".to_string());
        }

        if relative_path == Path::new(THEME_PACK_MANIFEST_NAME) {
            manifest_content = Some(String::from_utf8(file_bytes).map_err(|_| "Theme pack manifest is not valid UTF-8.".to_string())?);
            continue;
        }

        asset_files.push((relative_path, file_bytes));
    }

    let manifest_content = manifest_content.ok_or_else(|| "Theme pack archive is missing theme.json.".to_string())?;
    let summary = parse_theme_pack_summary(&manifest_content)
        .ok_or_else(|| "Theme pack manifest is missing a valid id and name.".to_string())?;

    save_theme_pack_bundle_logic(themes_dir, &summary.id, &manifest_content, &asset_files)?;

    Ok(ImportedThemePackFile {
        theme_id: summary.id,
        theme_name: summary.name,
        content: manifest_content,
        file_name: file_name.map(|value| value.to_string()),
    })
}

pub fn import_theme_pack_logic(
    themes_dir: &Path,
    bytes: &[u8],
    file_name: Option<&str>,
) -> Result<ImportedThemePackFile, String> {
    if bytes.len() > MAX_THEME_PACK_IMPORT_BYTES {
        return Err("Theme pack file is too large.".to_string());
    }

    if is_zip_theme_pack(bytes, file_name) {
        return import_zip_theme_pack_logic(themes_dir, bytes, file_name);
    }

    let content = String::from_utf8(bytes.to_vec()).map_err(|_| "Theme pack file is not valid UTF-8 JSON.".to_string())?;
    import_json_theme_pack_logic(themes_dir, content, file_name)
}

pub fn list_theme_pack_contents_logic(themes_dir: &Path) -> Result<Vec<String>, String> {
    let mut contents = Vec::new();
    for entry in list_theme_pack_entries_logic(themes_dir)? {
        match read_theme_pack_manifest(&entry) {
            Ok(content) => contents.push(content),
            Err(error) => {
                eprintln!("[kechimochi] Failed to read theme pack {}: {}", entry.manifest_path.display(), error);
            }
        }
    }

    Ok(contents)
}

pub fn list_theme_pack_summaries_logic(themes_dir: &Path) -> Result<Vec<ThemePackSummary>, String> {
    let mut summaries = Vec::new();
    for entry in list_theme_pack_entries_logic(themes_dir)? {
        match read_theme_pack_manifest(&entry) {
            Ok(content) => {
                if let Some(mut summary) = parse_theme_pack_summary(&content) {
                    summary.has_assets = Some(entry.has_assets);
                    summaries.push(summary);
                }
            }
            Err(error) => {
                eprintln!("[kechimochi] Failed to read theme pack {}: {}", entry.manifest_path.display(), error);
            }
        }
    }

    summaries.sort_by(|left, right| left.name.cmp(&right.name).then_with(|| left.id.cmp(&right.id)));
    Ok(summaries)
}

pub fn read_theme_pack_logic(themes_dir: &Path, theme_id: &str) -> Result<Option<String>, String> {
    let Some(entry) = find_theme_pack_entries_for_id(themes_dir, theme_id)?.into_iter().next() else {
        return Ok(None);
    };

    read_theme_pack_manifest(&entry).map(Some)
}

pub fn save_theme_pack_logic(themes_dir: &Path, theme_id: &str, content: &str, preferred_file_name: Option<&str>) -> Result<(), String> {
    let existing_paths = find_theme_pack_entries_for_id(themes_dir, theme_id)?;
    let target_path = if let Some(file_name) = preferred_file_name.and_then(sanitize_theme_pack_file_name) {
        build_unique_theme_pack_path(themes_dir, &file_name, &existing_paths)
    } else if let Some(existing_path) = existing_paths.iter().find(|entry| entry.is_legacy_file) {
        existing_path.root_path.clone()
    } else {
        themes_dir.join(theme_pack_file_name(theme_id)?)
    };

    for existing_path in &existing_paths {
        remove_theme_pack_entry(existing_path)?;
    }

    std::fs::create_dir_all(themes_dir).map_err(|e| e.to_string())?;
    std::fs::write(&target_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_theme_pack_logic(themes_dir: &Path, theme_id: &str) -> Result<(), String> {
    for entry in find_theme_pack_entries_for_id(themes_dir, theme_id)? {
        remove_theme_pack_entry(&entry)?;
    }
    Ok(())
}

pub fn get_theme_pack_asset_path_logic(themes_dir: &Path, theme_id: &str, asset_path: &str) -> Result<Option<String>, String> {
    let Some(entry) = find_theme_pack_entries_for_id(themes_dir, theme_id)?
        .into_iter()
        .find(|entry| entry.has_assets) else {
        return Ok(None);
    };

    let relative_path = normalize_theme_pack_asset_path(asset_path)?;
    let candidate = entry.root_path.join(relative_path);
    if !candidate.exists() || !candidate.is_file() {
        return Ok(None);
    }

    Ok(Some(candidate.to_string_lossy().to_string()))
}

pub fn read_theme_pack_asset_bytes_for_path_logic(themes_dir: &Path, theme_id: &str, asset_path: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(asset_path) = get_theme_pack_asset_path_logic(themes_dir, theme_id, asset_path)? else {
        return Ok(None);
    };

    std::fs::read(asset_path).map(Some).map_err(|e| e.to_string())
}

pub fn read_theme_pack_asset_bytes_logic(themes_dir: &Path, theme_id: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    let Some(entry) = find_theme_pack_entries_for_id(themes_dir, theme_id)?
        .into_iter()
        .find(|entry| entry.has_assets) else {
        return Ok(Vec::new());
    };

    let mut assets = Vec::new();
    for walk_entry in WalkDir::new(&entry.root_path).into_iter().filter_map(|value| value.ok()) {
        let path = walk_entry.path();
        if !path.is_file() || path == entry.manifest_path {
            continue;
        }

        let relative_path = path.strip_prefix(&entry.root_path).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        assets.push((relative_path.to_string_lossy().replace('\\', "/"), bytes));
    }

    assets.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(assets)
}

pub fn theme_pack_has_assets_logic(themes_dir: &Path, theme_id: &str) -> Result<bool, String> {
    Ok(find_theme_pack_entries_for_id(themes_dir, theme_id)?
        .into_iter()
        .any(|entry| entry.has_assets))
}

pub fn export_theme_pack_logic(themes_dir: &Path, theme_id: &str, content: &str, file_path: &str) -> Result<(), String> {
    if !theme_pack_has_assets_logic(themes_dir, theme_id)? {
        return std::fs::write(file_path, content)
            .map_err(|e| format!("Failed to write theme pack: {e}"));
    }

    let file = File::create(file_path).map_err(|e| format!("Failed to create theme archive: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(THEME_PACK_MANIFEST_NAME, options).map_err(|e| e.to_string())?;
    zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;

    if let Some(entry) = find_theme_pack_entries_for_id(themes_dir, theme_id)?
        .into_iter()
        .find(|entry| entry.has_assets)
    {
        let mut buffer = Vec::new();
        for walk_entry in WalkDir::new(&entry.root_path).into_iter().filter_map(|value| value.ok()) {
            let path = walk_entry.path();
            if !path.is_file() || path == entry.manifest_path {
                continue;
            }

            let relative_path = path.strip_prefix(&entry.root_path).map_err(|e| e.to_string())?;
            zip.start_file(relative_path.to_string_lossy(), options).map_err(|e| e.to_string())?;

            buffer.clear();
            File::open(path).map_err(|e| e.to_string())?.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            zip.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }

    let finished_file = zip.finish().map_err(|e| e.to_string())?;
    finished_file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_theme_packs(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    list_theme_pack_contents_logic(&theme_packs_dir(&app_dir))
}

#[tauri::command]
fn list_theme_pack_summaries(app_handle: tauri::AppHandle) -> Result<Vec<ThemePackSummary>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    list_theme_pack_summaries_logic(&theme_packs_dir(&app_dir))
}

#[tauri::command]
fn read_theme_pack(app_handle: tauri::AppHandle, theme_id: String) -> Result<Option<String>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    read_theme_pack_logic(&theme_packs_dir(&app_dir), &theme_id)
}

#[tauri::command]
fn get_theme_pack_asset_path(app_handle: tauri::AppHandle, theme_id: String, asset_path: String) -> Result<Option<String>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    get_theme_pack_asset_path_logic(&theme_packs_dir(&app_dir), &theme_id, &asset_path)
}

#[tauri::command]
fn read_theme_pack_asset_bytes(app_handle: tauri::AppHandle, theme_id: String, asset_path: String) -> Result<Option<Vec<u8>>, String> {
    let app_dir = db::get_data_dir(&app_handle);
    read_theme_pack_asset_bytes_for_path_logic(&theme_packs_dir(&app_dir), &theme_id, &asset_path)
}

#[tauri::command]
fn save_theme_pack(app_handle: tauri::AppHandle, theme_id: String, content: String, preferred_file_name: Option<String>) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    save_theme_pack_logic(&theme_packs_dir(&app_dir), &theme_id, &content, preferred_file_name.as_deref())
}

#[tauri::command]
fn import_theme_pack(app_handle: tauri::AppHandle, path: String) -> Result<ImportedThemePackFile, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let bytes = app_file_io::read_input_bytes(&app_handle, &path)?;
    let file_name = app_file_io::input_file_name(&app_handle, &path);
    import_theme_pack_logic(&theme_packs_dir(&app_dir), &bytes, file_name.as_deref())
}

#[tauri::command]
fn export_theme_pack(app_handle: tauri::AppHandle, theme_id: String, content: String, file_path: String) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    export_theme_pack_logic(&theme_packs_dir(&app_dir), &theme_id, &content, &file_path)
}

#[tauri::command]
fn delete_theme_pack(app_handle: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    delete_theme_pack_logic(&theme_packs_dir(&app_dir), &theme_id)
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
    let file = app_file_io::open_input_file(&app_handle, &file_path)?;
    run_dirty_command(&app_handle, || {
        with_conn_mut(&state, |conn| {
            csv_import::import_csv_from_reader(conn, file)
        })
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
    app_handle: tauri::AppHandle,
    state: State<DbState>,
    file_path: String,
) -> Result<Vec<csv_import::MediaConflict>, String> {
    let file = app_file_io::open_input_file(&app_handle, &file_path)?;
    with_conn(&state, |conn| {
        csv_import::analyze_media_csv_from_reader(conn, file)
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
fn should_skip_legacy_local_profile_migration() -> bool {
    matches!(
        std::env::var(SKIP_LEGACY_LOCAL_PROFILE_MIGRATION_ENV)
            .ok()
            .as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES")
    )
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
    let bytes = app_file_io::read_input_bytes(&app_handle, &path)?;
    let profile_picture = profile_picture::process_profile_picture_bytes(&bytes)?;
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
    let token_store = sync_token_store();
    let google_authenticated = match sync_auth::has_google_drive_tokens(token_store.as_ref()) {
        Ok(authenticated) => authenticated,
        Err(err) => {
            if sync_state::load_sync_config(&app_dir)?.is_some() {
                return Err(err);
            }
            false
        }
    };
    let google_account_email =
        sync_auth::load_google_account_email(token_store.as_ref()).unwrap_or_default();
    sync_state::get_sync_status(&app_dir, google_authenticated, google_account_email)
}

#[tauri::command]
fn clear_sync_backups(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    sync_state::clear_sync_backups(&app_dir)
}

#[tauri::command]
async fn connect_google_drive(
    app_handle: tauri::AppHandle,
    _state: State<'_, DbState>,
) -> Result<sync_auth::GoogleDriveAuthSession, String> {
    let app_dir = db::get_data_dir(&app_handle);
    let token_store = sync_token_store();

    #[cfg(target_os = "android")]
    {
        ensure_android_google_drive_access_token(&app_handle, token_store.as_ref()).await?;
        return sync_auth::build_google_drive_auth_session(&app_dir, token_store.as_ref());
    }

    #[cfg(not(target_os = "android"))]
    {
        let config = google_oauth_config(&app_handle)?;

        return sync_auth::connect_google_drive_with_browser(
            &app_dir,
            &config,
            token_store.as_ref(),
            {
                let app_handle = app_handle.clone();
                move |auth_url| {
                    let auth_url = auth_url.to_string();
                    Box::pin(async move {
                        if should_auto_open_sync_auth() {
                            auto_open_sync_auth_url(&auth_url).await
                        } else {
                            app_handle
                                .opener()
                                .open_url(&auth_url, None::<&str>)
                                .map_err(|e| e.to_string())
                        }
                    })
                }
            },
        )
        .await;
    }
}

#[tauri::command]
async fn list_remote_sync_profiles(
    app_handle: tauri::AppHandle,
) -> Result<Vec<sync_orchestrator::RemoteSyncProfileSummary>, String> {
    with_sync_command(
        &app_handle,
        "Loading cloud profiles",
        SYNC_COMMAND_TIMEOUT_SECS,
        None,
        |_, config, token_store| async move {
            sync_orchestrator::list_remote_sync_profiles(&config, token_store.as_ref()).await
        },
    )
    .await
}

#[tauri::command]
async fn create_remote_sync_profile(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    let progress_reporter = sync_progress_reporter(app_handle.clone(), Some(activity_tx));
    with_sync_db_command(
        &app_handle,
        &state,
        "Creating the cloud sync profile",
        CREATE_SYNC_PROFILE_TIMEOUT_SECS,
        Some(activity_rx),
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::create_remote_sync_profile_with_progress(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                None,
                Some(&progress_reporter),
            )
            .await
        },
    )
    .await
}

#[tauri::command]
async fn attach_remote_sync_profile(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    let progress_reporter = sync_progress_reporter(app_handle.clone(), Some(activity_tx));
    with_sync_db_command(
        &app_handle,
        &state,
        "Attaching the cloud sync profile",
        SYNC_COMMAND_TIMEOUT_SECS,
        Some(activity_rx),
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::attach_remote_sync_profile_with_progress(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                &profile_id,
                None,
                Some(&progress_reporter),
            )
            .await
        },
    )
    .await
}

#[tauri::command]
async fn preview_attach_remote_sync_profile(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<sync_orchestrator::AttachPreviewResult, String> {
    with_sync_db_command(
        &app_handle,
        &state,
        "Preparing the cloud profile attach preview",
        SYNC_COMMAND_TIMEOUT_SECS,
        None,
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::preview_attach_remote_sync_profile(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                &profile_id,
            )
            .await
        },
    )
    .await
}

#[tauri::command]
async fn run_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    let progress_reporter = sync_progress_reporter(app_handle.clone(), Some(activity_tx));
    with_sync_db_command(
        &app_handle,
        &state,
        "Syncing with Google Drive",
        SYNC_COMMAND_TIMEOUT_SECS,
        Some(activity_rx),
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::run_sync_with_progress(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                Some(&progress_reporter),
            )
            .await
        },
    )
    .await
}

#[tauri::command]
async fn replace_local_from_remote(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    let progress_reporter = sync_progress_reporter(app_handle.clone(), Some(activity_tx));
    with_sync_db_command(
        &app_handle,
        &state,
        "Replacing local data from Google Drive",
        RECOVERY_SYNC_TIMEOUT_SECS,
        Some(activity_rx),
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::replace_local_from_remote_with_progress(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                Some(&progress_reporter),
            )
            .await
        },
    )
    .await
}

#[tauri::command]
async fn force_publish_local_as_remote(
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<sync_orchestrator::SyncActionResult, String> {
    let (activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();
    let progress_reporter = sync_progress_reporter(app_handle.clone(), Some(activity_tx));
    with_sync_db_command(
        &app_handle,
        &state,
        "Force publishing local data to Google Drive",
        RECOVERY_SYNC_TIMEOUT_SECS,
        Some(activity_rx),
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::force_publish_local_as_remote_with_progress(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                Some(&progress_reporter),
            )
            .await
        },
    )
    .await
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
    with_sync_db_command(
        &app_handle,
        &state,
        "Resolving the sync conflict",
        SYNC_COMMAND_TIMEOUT_SECS,
        None,
        move |app_dir, conn, config, token_store| async move {
            sync_orchestrator::resolve_sync_conflict(
                &app_dir,
                &conn,
                &config,
                token_store.as_ref(),
                conflict_index,
                resolution,
            )
            .await
        },
    )
    .await
}

#[tauri::command]
fn disconnect_google_drive(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = db::get_data_dir(&app_handle);
    let token_store = sync_token_store();
    #[cfg(target_os = "android")]
    if let Some(access_token) = sync_auth::load_google_access_token(token_store.as_ref())? {
        let google_auth_mobile = app_handle.state::<GoogleAuthMobileState>();
        if let Some(plugin) = google_auth_mobile.0.as_ref() {
            let _ = plugin.run_mobile_plugin::<()>(
                "clearToken",
                AndroidGoogleClearTokenRequest { access_token },
            );
        }
    }
    sync_auth::disconnect_google_drive_data(&app_dir, token_store.as_ref())
}

#[tauri::command]
fn get_startup_error(state: State<'_, StartupState>) -> Option<String> {
    state.error.clone()
}

pub fn get_username_logic() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "User".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(init_google_auth_mobile_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = db::get_data_dir(app.handle());
            let user_db_path = app_dir.join("kechimochi_user.db");
            let (conn, startup_error) = if user_db_path.exists() {
                match db::init_db(app_dir, None) {
                    Ok(conn) => (conn, None),
                    Err(err) => {
                        let error_message = format!(
                            "Kechimochi could not open this database safely.\n\n{}\n\nUse a newer version of the app that supports this database schema.",
                            err
                        );

                        (
                            rusqlite::Connection::open_in_memory().unwrap(),
                            Some(error_message),
                        )
                    }
                }
            } else {
                // If no user DB exists, start with a temporary in-memory db.
                // The frontend will force the user to create an initial profile and call initialize_user_db.
                (rusqlite::Connection::open_in_memory().unwrap(), None)
            };
            app.manage(DbState {
                conn: Arc::new(Mutex::new(conn)),
            });
            app.manage(StartupState {
                error: startup_error,
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
            read_text_file,
            write_text_file,
            list_theme_packs,
            list_theme_pack_summaries,
            read_theme_pack,
            get_theme_pack_asset_path,
            read_theme_pack_asset_bytes,
            save_theme_pack,
            import_theme_pack,
            export_theme_pack,
            delete_theme_pack,
            fetch_remote_bytes,
            fetch_external_json,
            download_and_save_image,
            get_username,
            should_skip_legacy_local_profile_migration,
            get_profile_picture,
            upload_profile_picture,
            delete_profile_picture,
            get_sync_status,
            connect_google_drive,
            list_remote_sync_profiles,
            create_remote_sync_profile,
            preview_attach_remote_sync_profile,
            attach_remote_sync_profile,
            run_sync,
            replace_local_from_remote,
            force_publish_local_as_remote,
            get_sync_conflicts,
            resolve_sync_conflict,
            disconnect_google_drive,
            clear_sync_backups,
            get_startup_error,
            set_setting,
            get_setting,
            backup::export_full_backup,
            backup::import_full_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_google_auth_mobile_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("googleAuth")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = Some(
                _api.register_android_plugin("com.morg.kechimochi", "GoogleAuthPlugin")
                    .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?,
            );
            #[cfg(not(target_os = "android"))]
            let plugin = None;

            app.manage(GoogleAuthMobileState(plugin));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::{
        delete_theme_pack_logic,
        export_theme_pack_logic,
        get_theme_pack_asset_path_logic,
        get_username_logic,
        import_theme_pack_logic,
        list_theme_pack_contents_logic,
        list_theme_pack_summaries_logic,
        read_theme_pack_asset_bytes_logic,
        read_theme_pack_logic,
        read_text_file_logic,
        save_theme_pack_bundle_logic,
        save_theme_pack_logic,
        theme_packs_dir,
        ThemePackSummary,
        write_text_file_logic,
    };

    #[test]
    fn test_theme_pack_text_file_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("kechimochi_theme_pack_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("theme.json");
        let content = "{\"name\":\"Theme\"}";

        write_text_file_logic(file_path.to_str().unwrap(), content).unwrap();
        let read_back = read_text_file_logic(file_path.to_str().unwrap()).unwrap();

        assert_eq!(read_back, content);

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_read_text_file_logic_errors_for_missing_file() {
        let missing = std::env::temp_dir().join(format!("missing_theme_pack_{}.json", std::process::id()));
        let result = read_text_file_logic(missing.to_str().unwrap());
        assert!(result.is_err());
    }

    #[test]
    fn test_managed_theme_pack_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("kechimochi_managed_theme_pack_{}", std::process::id()));
        let themes_dir = theme_packs_dir(&temp_dir);
        let content = r#"{"version":1,"id":"custom:test-theme","name":"Test Theme","variables":{}}"#;

        save_theme_pack_logic(&themes_dir, "custom:test-theme", content, None).unwrap();

        let listed = list_theme_pack_contents_logic(&themes_dir).unwrap();
        assert_eq!(listed, vec![content.to_string()]);

        delete_theme_pack_logic(&themes_dir, "custom:test-theme").unwrap();
        assert!(list_theme_pack_contents_logic(&themes_dir).unwrap().is_empty());

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_managed_theme_pack_preserves_preferred_file_name_and_handles_collisions() {
        let temp_dir = std::env::temp_dir().join(format!("kechimochi_managed_theme_pack_names_{}", std::process::id()));
        let themes_dir = theme_packs_dir(&temp_dir);
        let first_content = r#"{"version":1,"id":"custom:first-theme","name":"First Theme","variables":{}}"#;
        let second_content = r#"{"version":1,"id":"custom:second-theme","name":"Second Theme","variables":{}}"#;

        save_theme_pack_logic(&themes_dir, "custom:first-theme", first_content, Some("midnight-current.json")).unwrap();
        save_theme_pack_logic(&themes_dir, "custom:second-theme", second_content, Some("midnight-current.json")).unwrap();

        let mut file_names = std::fs::read_dir(&themes_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().to_str().map(|value| value.to_string()))
            .collect::<Vec<_>>();
        file_names.sort();

        assert!(file_names.contains(&"midnight-current.json".to_string()));
        assert!(file_names.contains(&"midnight-current-2.json".to_string()));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_managed_theme_pack_summaries_and_single_read() {
        let temp_dir = std::env::temp_dir().join(format!("kechimochi_managed_theme_pack_summaries_{}", std::process::id()));
        let themes_dir = theme_packs_dir(&temp_dir);
        let content = r#"{"version":1,"id":"custom:test-theme","name":"Test Theme","variables":{}}"#;

        save_theme_pack_logic(&themes_dir, "custom:test-theme", content, Some("test-theme.json")).unwrap();

        let summaries = list_theme_pack_summaries_logic(&themes_dir).unwrap();
        assert_eq!(summaries, vec![ThemePackSummary {
            id: "custom:test-theme".to_string(),
            name: "Test Theme".to_string(),
            version: Some(1),
            has_assets: Some(false),
        }]);
        assert_eq!(read_theme_pack_logic(&themes_dir, "custom:test-theme").unwrap(), Some(content.to_string()));
        assert_eq!(read_theme_pack_logic(&themes_dir, "custom:missing-theme").unwrap(), None);

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_bundled_theme_pack_import_export_roundtrip_preserves_assets() {
        let base_dir = std::env::temp_dir().join(format!("kechimochi_managed_theme_bundle_{}", std::process::id()));
        let source_dir = base_dir.join("source");
        let target_dir = base_dir.join("target");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&target_dir).unwrap();

        let source_themes_dir = theme_packs_dir(&source_dir);
        let target_themes_dir = theme_packs_dir(&target_dir);
        let content = r#"{"version":1,"id":"custom:bundle-theme","name":"Bundle Theme","variables":{},"background":{"type":"video","src":"assets/bg.mp4"}}"#;
        let assets = vec![
            (std::path::PathBuf::from("assets/bg.mp4"), b"video-bytes".to_vec()),
            (std::path::PathBuf::from("assets/fonts/reload.woff2"), b"font-bytes".to_vec()),
        ];

        save_theme_pack_bundle_logic(&source_themes_dir, "custom:bundle-theme", content, &assets).unwrap();

        let summaries = list_theme_pack_summaries_logic(&source_themes_dir).unwrap();
        assert_eq!(summaries, vec![ThemePackSummary {
            id: "custom:bundle-theme".to_string(),
            name: "Bundle Theme".to_string(),
            version: Some(1),
            has_assets: Some(true),
        }]);
        assert!(get_theme_pack_asset_path_logic(&source_themes_dir, "custom:bundle-theme", "assets/bg.mp4")
            .unwrap()
            .is_some());

        let export_path = base_dir.join("bundle-theme.zip");
        export_theme_pack_logic(
            &source_themes_dir,
            "custom:bundle-theme",
            content,
            export_path.to_str().unwrap(),
        )
        .unwrap();

        let bytes = std::fs::read(&export_path).unwrap();
        let imported = import_theme_pack_logic(&target_themes_dir, &bytes, Some("bundle-theme.zip")).unwrap();
        assert_eq!(imported.theme_id, "custom:bundle-theme");
        assert_eq!(imported.theme_name, "Bundle Theme");
        assert_eq!(imported.content, content);

        assert_eq!(
            read_theme_pack_logic(&target_themes_dir, "custom:bundle-theme").unwrap(),
            Some(content.to_string())
        );
        assert_eq!(
            read_theme_pack_asset_bytes_logic(&target_themes_dir, "custom:bundle-theme").unwrap(),
            vec![
                ("assets/bg.mp4".to_string(), b"video-bytes".to_vec()),
                ("assets/fonts/reload.woff2".to_string(), b"font-bytes".to_vec()),
            ]
        );

        std::fs::remove_dir_all(base_dir).ok();
    }

    #[test]
    fn test_plain_theme_pack_export_writes_json() {
        let base_dir = std::env::temp_dir().join(format!("kechimochi_managed_theme_export_json_{}", std::process::id()));
        std::fs::create_dir_all(&base_dir).unwrap();

        let themes_dir = theme_packs_dir(&base_dir);
        let content = r#"{"version":1,"id":"custom:json-theme","name":"JSON Theme","variables":{}}"#;
        save_theme_pack_logic(&themes_dir, "custom:json-theme", content, Some("json-theme.json")).unwrap();

        let export_path = base_dir.join("json-theme.json");
        export_theme_pack_logic(
            &themes_dir,
            "custom:json-theme",
            content,
            export_path.to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(std::fs::read_to_string(&export_path).unwrap(), content);

        std::fs::remove_dir_all(base_dir).ok();
    }

    #[test]
    fn test_get_username_logic() {
        std::env::set_var("USER", "testuser");
        assert_eq!(get_username_logic(), "testuser");

        std::env::remove_var("USER");
        std::env::set_var("USERNAME", "winuser");
        assert_eq!(get_username_logic(), "winuser");
    }
}

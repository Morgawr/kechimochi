/// Standalone HTTP server for kechimochi web/LAN mode.
///
/// Run with:
///   cargo run --bin web_server
///
/// Configuration via environment variables:
///   PORT                  TCP port to listen on (default: 3000)
///   HOST                  Bind address (default: 0.0.0.0)
///   KECHIMOCHI_DATA_DIR   Override data directory (platform default otherwise)
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

use kechimochi_lib::{csv_import, db, get_username_logic, models};

// ── Error handling ────────────────────────────────────────────────────────────

struct AppError(String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}

/// Extension trait: `.ae()?` converts any `Display` error into `HandlerResult`.
trait AeExt<T> {
    fn ae(self) -> HandlerResult<T>;
}

impl<T, E: std::fmt::Display> AeExt<T> for std::result::Result<T, E> {
    fn ae(self) -> HandlerResult<T> {
        self.map_err(|e| AppError(e.to_string()))
    }
}

type HandlerResult<T> = std::result::Result<T, AppError>;

// ── Shared state ──────────────────────────────────────────────────────────────

struct AppState {
    conn: Mutex<rusqlite::Connection>,
    data_dir: PathBuf,
}

type Shared = Arc<AppState>;

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let data_dir = db::get_data_dir_standalone();
    println!("[kechimochi] data dir: {}", data_dir.display());

    let profiles = db::list_profiles(data_dir.clone()).unwrap_or_default();
    let conn = if profiles.is_empty() {
        rusqlite::Connection::open_in_memory().expect("Failed to open in-memory DB")
    } else {
        db::init_db(data_dir.clone(), &profiles[0]).expect("Failed to open database")
    };

    let state: Shared = Arc::new(AppState {
        conn: Mutex::new(conn),
        data_dir,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Media
        .route("/api/media",                 get(get_all_media).post(add_media))
        .route("/api/media/:id",             put(update_media).delete(delete_media_handler))
        // Logs — specific routes before the parameterised :id route
        .route("/api/logs/heatmap",          get(get_heatmap))
        .route("/api/logs/media/:id",        get(get_logs_for_media))
        .route("/api/logs",                  get(get_logs).post(add_log))
        .route("/api/logs/:id",              delete(delete_log_handler))
        // Profiles — specific routes before :name
        .route("/api/profiles/switch",       post(switch_profile))
        .route("/api/profiles",              get(list_profiles))
        .route("/api/profiles/:name",        delete(delete_profile_handler))
        // Settings
        .route("/api/settings/:key",         get(get_setting).put(set_setting))
        // Utility
        .route("/api/username",              get(get_username))
        .route("/api/version",               get(get_version))
        .route("/api/activities/clear",      post(clear_activities))
        .route("/api/reset",                 post(wipe_everything_handler))
        // Import / export
        .route("/api/import/activities",     post(import_activities))
        .route("/api/export/activities",     get(export_activities))
        .route("/api/import/media/analyze",  post(analyze_media_csv_upload))
        .route("/api/import/media/apply",    post(apply_media_import_handler))
        .route("/api/export/media",          get(export_media_handler))
        // Covers — specific routes before the parameterised :media_id route
        .route("/api/covers/download",       post(download_cover))
        .route("/api/covers/file/:filename", get(serve_cover))
        .route("/api/covers/:media_id",      post(upload_cover))
        // External proxy
        .route("/api/fetch/json",            post(fetch_json_proxy))
        .route("/api/fetch/bytes",           post(fetch_bytes_proxy))
        .with_state(state)
        .layer(cors);

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("{}:{}", host, port);
    println!("[kechimochi] listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server error");
}

// ── Media handlers ────────────────────────────────────────────────────────────

async fn get_all_media(State(s): State<Shared>) -> HandlerResult<Json<Vec<models::Media>>> {
    let conn = s.conn.lock().await;
    db::get_all_media(&conn).ae().map(Json)
}

async fn add_media(
    State(s): State<Shared>,
    Json(media): Json<models::Media>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().await;
    db::add_media_with_id(&conn, &media).ae().map(Json)
}

async fn update_media(
    State(s): State<Shared>,
    Json(media): Json<models::Media>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::update_media(&conn, &media).ae().map(|_| Json(()))
}

async fn delete_media_handler(
    State(s): State<Shared>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::delete_media(&conn, id).ae().map(|_| Json(()))
}

// ── Log handlers ──────────────────────────────────────────────────────────────

async fn get_logs(State(s): State<Shared>) -> HandlerResult<Json<Vec<models::ActivitySummary>>> {
    let conn = s.conn.lock().await;
    db::get_logs(&conn).ae().map(Json)
}

async fn add_log(
    State(s): State<Shared>,
    Json(log): Json<models::ActivityLog>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().await;
    db::add_log(&conn, &log).ae().map(Json)
}

async fn delete_log_handler(
    State(s): State<Shared>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::delete_log(&conn, id).ae().map(|_| Json(()))
}

async fn get_heatmap(State(s): State<Shared>) -> HandlerResult<Json<Vec<models::DailyHeatmap>>> {
    let conn = s.conn.lock().await;
    db::get_heatmap(&conn).ae().map(Json)
}

async fn get_logs_for_media(
    State(s): State<Shared>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<Vec<models::ActivitySummary>>> {
    let conn = s.conn.lock().await;
    db::get_logs_for_media(&conn, id).ae().map(Json)
}

// ── Profile handlers ──────────────────────────────────────────────────────────

async fn list_profiles(State(s): State<Shared>) -> HandlerResult<Json<Vec<String>>> {
    db::list_profiles(s.data_dir.clone()).ae().map(Json)
}

#[derive(Deserialize)]
struct SwitchProfileBody {
    profile_name: String,
}

async fn switch_profile(
    State(s): State<Shared>,
    Json(body): Json<SwitchProfileBody>,
) -> HandlerResult<Json<()>> {
    let new_conn = db::init_db(s.data_dir.clone(), &body.profile_name).ae()?;
    *s.conn.lock().await = new_conn;
    Ok(Json(()))
}

async fn delete_profile_handler(
    State(s): State<Shared>,
    Path(name): Path<String>,
) -> HandlerResult<Json<()>> {
    *s.conn.lock().await = rusqlite::Connection::open_in_memory().ae()?;
    db::wipe_profile(s.data_dir.clone(), &name).ae().map(|_| Json(()))
}

// ── Settings handlers ─────────────────────────────────────────────────────────

async fn get_setting(
    State(s): State<Shared>,
    Path(key): Path<String>,
) -> HandlerResult<Json<Option<String>>> {
    let conn = s.conn.lock().await;
    db::get_setting(&conn, &key).ae().map(Json)
}

#[derive(Deserialize)]
struct SetSettingBody {
    value: String,
}

async fn set_setting(
    State(s): State<Shared>,
    Path(key): Path<String>,
    Json(body): Json<SetSettingBody>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::set_setting(&conn, &key, &body.value).ae().map(|_| Json(()))
}

// ── Utility handlers ──────────────────────────────────────────────────────────

async fn get_username() -> Json<String> {
    Json(get_username_logic())
}

async fn get_version() -> Json<String> {
    let version = option_env!("CARGO_PKG_VERSION").unwrap_or("0.0.0");
    Json(format!("web-{}", version))
}

async fn clear_activities(State(s): State<Shared>) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::clear_activities(&conn).ae().map(|_| Json(()))
}

async fn wipe_everything_handler(State(s): State<Shared>) -> HandlerResult<Json<()>> {
    *s.conn.lock().await = rusqlite::Connection::open_in_memory().ae()?;
    db::wipe_everything(s.data_dir.clone()).ae().map(|_| Json(()))
}

// ── CSV import / export ───────────────────────────────────────────────────────

async fn import_activities(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp.path().to_str().ok_or_else(|| AppError("Invalid temp path".into()))?.to_owned();
    let count = {
        let mut conn = s.conn.lock().await;
        csv_import::import_csv(&mut *conn, &path).ae()?
    };
    Ok(Json(serde_json::json!({ "count": count })))
}

#[derive(Deserialize)]
struct ExportParams {
    start: Option<String>,
    end: Option<String>,
}

async fn export_activities(
    State(s): State<Shared>,
    Query(params): Query<ExportParams>,
) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp.path().to_str().ok_or_else(|| AppError("Invalid temp path".into()))?.to_owned();
    let count = {
        let conn = s.conn.lock().await;
        csv_import::export_logs_csv(&conn, &path, params.start, params.end).ae()?
    };
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, "attachment; filename=\"activities.csv\"")
        .header("x-row-count", count.to_string())
        .body(Body::from(bytes))
        .ae()
}

async fn analyze_media_csv_upload(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<Vec<csv_import::MediaConflict>>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp.path().to_str().ok_or_else(|| AppError("Invalid temp path".into()))?.to_owned();
    let conn = s.conn.lock().await;
    csv_import::analyze_media_csv(&conn, &path).ae().map(Json)
}

async fn apply_media_import_handler(
    State(s): State<Shared>,
    Json(records): Json<Vec<csv_import::MediaCsvRow>>,
) -> HandlerResult<Json<usize>> {
    let covers_dir = s.data_dir.join("covers");
    let mut conn = s.conn.lock().await;
    csv_import::apply_media_import(covers_dir, &mut *conn, records).ae().map(Json)
}

async fn export_media_handler(State(s): State<Shared>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp.path().to_str().ok_or_else(|| AppError("Invalid temp path".into()))?.to_owned();
    let count = {
        let conn = s.conn.lock().await;
        csv_import::export_media_csv(&conn, &path).ae()?
    };
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, "attachment; filename=\"media_library.csv\"")
        .header("x-row-count", count.to_string())
        .body(Body::from(bytes))
        .ae()
}

// ── Cover images ──────────────────────────────────────────────────────────────

async fn upload_cover(
    State(s): State<Shared>,
    Path(media_id): Path<i64>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let covers_dir = s.data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir).ae()?;

    let field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError("No file field in multipart".into()))?;
    let filename = field.file_name().unwrap_or("upload").to_owned();
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_owned();
    let bytes = field.bytes().await.ae()?.to_vec();
    let conn = s.conn.lock().await;
    let path = db::save_cover_bytes(&conn, covers_dir, media_id, bytes, &ext).ae()?;
    Ok(Json(serde_json::json!({ "path": path })))
}

async fn serve_cover(
    State(s): State<Shared>,
    Path(filename): Path<String>,
) -> HandlerResult<Response> {
    // Prevent path traversal: only use the bare filename component.
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError("Invalid filename".into()))?
        .to_owned();
    let file_path = s.data_dir.join("covers").join(&safe_name);
    if !file_path.exists() {
        return Err(AppError("Cover not found".into()));
    }
    let bytes = std::fs::read(&file_path).ae()?;
    let content_type = match file_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg") {
        "png"  => "image/png",
        "gif"  => "image/gif",
        "webp" => "image/webp",
        _      => "image/jpeg",
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .ae()
}

#[derive(Deserialize)]
struct DownloadCoverBody {
    media_id: i64,
    url: String,
}

async fn download_cover(
    State(s): State<Shared>,
    Json(body): Json<DownloadCoverBody>,
) -> HandlerResult<Json<serde_json::Value>> {
    let covers_dir = s.data_dir.join("covers");
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .ae()?;
    let bytes = client
        .get(&body.url)
        .send()
        .await
        .ae()?
        .error_for_status()
        .ae()?
        .bytes()
        .await
        .ae()?
        .to_vec();
    let ext = std::path::Path::new(&body.url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg").to_owned();
    let conn = s.conn.lock().await;
    let path = db::save_cover_bytes(&conn, covers_dir, body.media_id, bytes, &ext).ae()?;
    Ok(Json(serde_json::json!({ "path": path })))
}

// ── External network proxy ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FetchJsonBody {
    url: String,
    method: String,
    body: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
}

async fn fetch_json_proxy(
    Json(payload): Json<FetchJsonBody>,
) -> HandlerResult<Json<serde_json::Value>> {
    let default_ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let ua = payload.headers.as_ref()
        .and_then(|h| h.get("User-Agent"))
        .map(|s| s.to_owned())
        .unwrap_or_else(|| default_ua.to_owned());

    let client = reqwest::Client::builder().user_agent(&ua).build().ae()?;
    let mut req = match payload.method.to_uppercase().as_str() {
        "POST" => client.post(&payload.url),
        _      => client.get(&payload.url),
    };
    if let Some(ref h) = payload.headers {
        for (k, v) in h {
            if k.eq_ignore_ascii_case("User-Agent") { continue; }
            req = req.header(k, v);
        }
    }
    if let Some(b) = payload.body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let text = req.send().await.ae()?.error_for_status().ae()?.text().await.ae()?;
    Ok(Json(serde_json::json!({ "data": text })))
}

#[derive(Deserialize)]
struct FetchBytesBody {
    url: String,
}

async fn fetch_bytes_proxy(
    Json(payload): Json<FetchBytesBody>,
) -> HandlerResult<Json<serde_json::Value>> {
    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().ae()?;
    let bytes: Vec<u8> = client
        .get(&payload.url)
        .send().await.ae()?
        .error_for_status().ae()?
        .bytes().await.ae()?
        .to_vec();
    Ok(Json(serde_json::json!({ "bytes": bytes })))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Reads the first multipart field into a temporary file and returns it.
/// The caller must keep `tmp` alive until the path has been consumed.
async fn field_to_tempfile(multipart: &mut Multipart) -> HandlerResult<tempfile::NamedTempFile> {
    let field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError("No file in multipart".into()))?;
    let bytes = field.bytes().await.ae()?;
    let mut tmp = tempfile::NamedTempFile::new().ae()?;
    tmp.write_all(&bytes).ae()?;
    Ok(tmp)
}

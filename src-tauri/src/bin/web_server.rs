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
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

use kechimochi_lib::{
    csv_import,
    db,
    delete_theme_pack_logic,
    export_theme_pack_logic,
    get_username_logic,
    get_theme_pack_asset_path_logic,
    import_theme_pack_logic,
    ImportedThemePackFile,
    list_theme_pack_contents_logic,
    list_theme_pack_summaries_logic,
    models,
    theme_pack_has_assets_logic,
    read_theme_pack_logic,
    save_theme_pack_logic,
    theme_packs_dir,
    ThemePackSummary,
    profile_picture,
};

// ── Error handling ────────────────────────────────────────────────────────────

#[derive(Debug)]
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

const MAX_MULTIPART_UPLOAD_BYTES: usize = 64 * 1024 * 1024;

// ── Shared state ──────────────────────────────────────────────────────────────

struct AppState {
    conn: Mutex<rusqlite::Connection>,
    data_dir: PathBuf,
    static_dir: PathBuf,
}

type Shared = Arc<AppState>;

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let data_dir = db::get_data_dir(&db::STANDALONE_DATA_DIR_PROVIDER);
    println!("[kechimochi] data dir: {}", data_dir.display());

    let user_db_path = data_dir.join("kechimochi_user.db");
    let conn = if user_db_path.exists() {
        db::init_db(data_dir.clone(), None).expect("Failed to open database")
    } else {
        rusqlite::Connection::open_in_memory().expect("Failed to open in-memory DB")
    };

    let static_dir = resolve_static_dir();
    let static_index = static_dir.join("index.html");
    if !static_index.exists() {
        panic!(
            "[kechimochi] missing frontend build output at {}. Run `npm run web:build` from project root, or set KECHIMOCHI_WEB_DIST_DIR.",
            static_index.display()
        );
    }

    println!("[kechimochi] static dir: {}", static_dir.display());

    let state: Shared = Arc::new(AppState {
        conn: Mutex::new(conn),
        data_dir,
        static_dir: static_dir.clone(),
    });

    let app = build_app(state);

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("{}:{}", host, port);
    println!("[kechimochi] listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server error");
}

fn build_app(state: Shared) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Media
        .route("/api/media", get(get_all_media).post(add_media))
        .route(
            "/api/media/:id",
            put(update_media).delete(delete_media_handler),
        )
        // Logs — specific routes before the parameterised :id route
        .route("/api/logs/heatmap", get(get_heatmap))
        .route("/api/logs/media/:id", get(get_logs_for_media))
        .route("/api/logs", get(get_logs).post(add_log))
        .route("/api/logs/:id", delete(delete_log_handler))
        .route("/api/timeline", get(get_timeline_events_handler))
        // Milestones
        .route("/api/milestones", post(add_milestone_handler))
        .route(
            "/api/milestones/media/:title",
            get(get_milestones_for_media_handler).delete(clear_milestones_for_media_handler),
        )
        .route("/api/milestones/:id", delete(delete_milestone_handler))
        // Profiles
        .route("/api/profiles/initialize", post(initialize_user_db_handler))
        .route(
            "/api/profile-picture",
            get(get_profile_picture_handler)
                .post(upload_profile_picture_handler)
                .delete(delete_profile_picture_handler),
        )
        // Settings
    .route("/api/settings/:key", get(get_setting).put(set_setting))
        .route("/api/themes",               get(list_theme_packs_handler).post(save_theme_pack_handler))
        .route("/api/themes/import",        post(import_theme_pack_handler))
        .route("/api/themes/export",        post(export_theme_pack_handler))
        .route("/api/themes/summaries",     get(list_theme_pack_summaries_handler))
        .route("/api/themes/:theme_id/assets/*asset_path", get(get_theme_pack_asset_handler))
        .route("/api/themes/:theme_id",     get(get_theme_pack_handler).delete(delete_theme_pack_handler))
        // Utility
        .route("/api/username", get(get_username))
        .route("/api/version", get(get_version))
        .route("/api/activities/clear", post(clear_activities))
        .route("/api/reset", post(wipe_everything_handler))
        // Import / export
        .route("/api/import/activities", post(import_activities))
        .route("/api/export/activities", get(export_activities))
        .route("/api/import/media/analyze", post(analyze_media_csv_upload))
        .route("/api/import/media/apply", post(apply_media_import_handler))
        .route("/api/export/media", get(export_media_handler))
        .route("/api/import/milestones", post(import_milestones))
        .route("/api/export/milestones", get(export_milestones))
        .route("/api/export/full-backup", post(export_full_backup_handler))
        .route("/api/import/full-backup", post(import_full_backup_handler))
        // Covers — specific routes before the parameterised :media_id route
        .route("/api/covers/download", post(download_cover))
        .route("/api/covers/file/:filename", get(serve_cover))
        .route("/api/covers/:media_id", post(upload_cover))
        // External proxy
        .route("/api/fetch/json", post(fetch_json_proxy))
        .route("/api/fetch/bytes", post(fetch_bytes_proxy))
        // Any unmatched /api route should remain an API 404, not SPA fallback.
        .route("/api", any(api_not_found))
        .route("/api/*path", any(api_not_found))
        .route("/", get(serve_spa_index))
        .route("/*path", get(serve_static_or_spa))
        .with_state(state)
        .layer(DefaultBodyLimit::max(MAX_MULTIPART_UPLOAD_BYTES))
        .layer(cors)
}

fn resolve_static_dir() -> PathBuf {
    if let Ok(path) = std::env::var("KECHIMOCHI_WEB_DIST_DIR") {
        return PathBuf::from(path);
    }

    if let Ok(cwd) = std::env::current_dir() {
        let dist = cwd.join("dist");
        if dist.exists() {
            return dist;
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let dist = parent.join("dist");
            if dist.exists() {
                return dist;
            }
        }
    }

    PathBuf::from("dist")
}

async fn api_not_found() -> (StatusCode, &'static str) {
    (StatusCode::NOT_FOUND, "API route not found")
}

async fn serve_spa_index(State(s): State<Shared>) -> HandlerResult<Response> {
    let index = s.static_dir.join("index.html");
    let bytes = std::fs::read(index).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(bytes))
        .ae()
}

async fn serve_static_or_spa(
    State(s): State<Shared>,
    Path(path): Path<String>,
) -> HandlerResult<Response> {
    // Refuse traversal or absolute paths and fall back to the SPA shell.
    let req_path = std::path::Path::new(&path);
    let has_bad_component = req_path.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    });

    if !has_bad_component {
        let candidate = s.static_dir.join(req_path);
        if candidate.is_file() {
            let bytes = std::fs::read(&candidate).ae()?;
            let content_type = match candidate
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
            {
                "css" => "text/css; charset=utf-8",
                "js" => "application/javascript; charset=utf-8",
                "json" => "application/json; charset=utf-8",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "jpg" | "jpeg" => "image/jpeg",
                "ico" => "image/x-icon",
                "html" => "text/html; charset=utf-8",
                _ => "application/octet-stream",
            };

            return Response::builder()
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from(bytes))
                .ae();
        }
    }

    serve_spa_index(State(s)).await
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

async fn get_timeline_events_handler(
    State(s): State<Shared>,
) -> HandlerResult<Json<Vec<models::TimelineEvent>>> {
    let conn = s.conn.lock().await;
    db::get_timeline_events(&conn).ae().map(Json)
}

// ── Milestone handlers ───────────────────────────────────────────────────────

async fn get_milestones_for_media_handler(
    State(s): State<Shared>,
    Path(title): Path<String>,
) -> HandlerResult<Json<Vec<models::Milestone>>> {
    let conn = s.conn.lock().await;
    db::get_milestones_for_media(&conn, &title).ae().map(Json)
}

async fn add_milestone_handler(
    State(s): State<Shared>,
    Json(milestone): Json<models::Milestone>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().await;
    db::add_milestone(&conn, &milestone).ae().map(Json)
}

async fn delete_milestone_handler(
    State(s): State<Shared>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::delete_milestone(&conn, id).ae().map(|_| Json(()))
}

async fn clear_milestones_for_media_handler(
    State(s): State<Shared>,
    Path(title): Path<String>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::delete_milestones_for_media(&conn, &title)
        .ae()
        .map(|_| Json(()))
}

// ── Profile handlers ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct InitializeDbBody {
    fallback_username: Option<String>,
}

async fn initialize_user_db_handler(
    State(s): State<Shared>,
    Json(body): Json<InitializeDbBody>,
) -> HandlerResult<Json<()>> {
    let new_conn = db::init_db(s.data_dir.clone(), body.fallback_username.as_deref()).ae()?;
    *s.conn.lock().await = new_conn;
    Ok(Json(()))
}

async fn get_profile_picture_handler(
    State(s): State<Shared>,
) -> HandlerResult<Json<Option<models::ProfilePicture>>> {
    let conn = s.conn.lock().await;
    db::get_profile_picture(&conn).ae().map(Json)
}

async fn upload_profile_picture_handler(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<models::ProfilePicture>> {
    let field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError("No file field in multipart".into()))?;
    let bytes = field.bytes().await.ae()?.to_vec();
    let profile_picture = profile_picture::process_profile_picture_bytes(&bytes).ae()?;
    let conn = s.conn.lock().await;
    db::upsert_profile_picture(&conn, &profile_picture).ae()?;
    Ok(Json(profile_picture))
}

async fn delete_profile_picture_handler(State(s): State<Shared>) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().await;
    db::delete_profile_picture(&conn).ae().map(|_| Json(()))
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
    db::set_setting(&conn, &key, &body.value)
        .ae()
        .map(|_| Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveThemePackBody {
    theme_id: String,
    content: String,
    preferred_file_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportThemePackBody {
    theme_id: String,
    content: String,
}

async fn list_theme_packs_handler(State(s): State<Shared>) -> HandlerResult<Json<Vec<String>>> {
    list_theme_pack_contents_logic(&theme_packs_dir(&s.data_dir)).ae().map(Json)
}

async fn list_theme_pack_summaries_handler(State(s): State<Shared>) -> HandlerResult<Json<Vec<ThemePackSummary>>> {
    list_theme_pack_summaries_logic(&theme_packs_dir(&s.data_dir)).ae().map(Json)
}

async fn get_theme_pack_handler(
    State(s): State<Shared>,
    Path(theme_id): Path<String>,
) -> HandlerResult<Json<Option<String>>> {
    read_theme_pack_logic(&theme_packs_dir(&s.data_dir), &theme_id).ae().map(Json)
}

async fn save_theme_pack_handler(
    State(s): State<Shared>,
    Json(body): Json<SaveThemePackBody>,
) -> HandlerResult<Json<()>> {
    save_theme_pack_logic(&theme_packs_dir(&s.data_dir), &body.theme_id, &body.content, body.preferred_file_name.as_deref())
        .ae()
        .map(|_| Json(()))
}

async fn import_theme_pack_handler(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<ImportedThemePackFile>> {
    let (tmp, file_name) = field_to_tempfile_with_name(&mut multipart).await?;
    let bytes = std::fs::read(tmp.path()).ae()?;
    import_theme_pack_logic(&theme_packs_dir(&s.data_dir), &bytes, file_name.as_deref())
        .ae()
        .map(Json)
}

async fn export_theme_pack_handler(
    State(s): State<Shared>,
    Json(body): Json<ExportThemePackBody>,
) -> HandlerResult<Response> {
    let has_assets = theme_pack_has_assets_logic(&theme_packs_dir(&s.data_dir), &body.theme_id).ae()?;
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();

    export_theme_pack_logic(&theme_packs_dir(&s.data_dir), &body.theme_id, &body.content, &path).ae()?;
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            if has_assets {
                "application/zip"
            } else {
                "application/json; charset=utf-8"
            },
        )
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"{}.{}\"",
                body.theme_id.replace(':', "-"),
                if has_assets { "zip" } else { "json" }
            ),
        )
        .body(Body::from(bytes))
        .ae()
}

async fn get_theme_pack_asset_handler(
    State(s): State<Shared>,
    Path((theme_id, asset_path)): Path<(String, String)>,
) -> HandlerResult<Response> {
    let Some(asset_path) = get_theme_pack_asset_path_logic(&theme_packs_dir(&s.data_dir), &theme_id, &asset_path).ae()? else {
        return Err(AppError("Theme asset not found".into()));
    };

    let path = PathBuf::from(asset_path);
    let bytes = std::fs::read(&path).ae()?;
    let content_type = match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "mp4" => "video/mp4",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    };

    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .ae()
}

async fn delete_theme_pack_handler(
    State(s): State<Shared>,
    Path(theme_id): Path<String>,
) -> HandlerResult<Json<()>> {
    delete_theme_pack_logic(&theme_packs_dir(&s.data_dir), &theme_id)
        .ae()
        .map(|_| Json(()))
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
    db::wipe_everything(s.data_dir.clone())
        .ae()
        .map(|_| Json(()))
}

// ── CSV import / export ───────────────────────────────────────────────────────

async fn import_activities(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let mut conn = s.conn.lock().await;
        csv_import::import_csv(&mut conn, &path).ae()?
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
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().await;
        csv_import::export_logs_csv(&conn, &path, params.start, params.end).ae()?
    };
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"activities.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(Body::from(bytes))
        .ae()
}

async fn analyze_media_csv_upload(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<Vec<csv_import::MediaConflict>>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let conn = s.conn.lock().await;
    csv_import::analyze_media_csv(&conn, &path).ae().map(Json)
}

async fn apply_media_import_handler(
    State(s): State<Shared>,
    Json(records): Json<Vec<csv_import::MediaCsvRow>>,
) -> HandlerResult<Json<usize>> {
    let covers_dir = s.data_dir.join("covers");
    let mut conn = s.conn.lock().await;
    csv_import::apply_media_import(covers_dir, &mut conn, records)
        .ae()
        .map(Json)
}

async fn export_media_handler(State(s): State<Shared>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().await;
        csv_import::export_media_csv(&conn, &path).ae()?
    };
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"media_library.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(Body::from(bytes))
        .ae()
}

async fn import_milestones(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let mut conn = s.conn.lock().await;
        csv_import::import_milestones_csv(&mut conn, &path).ae()?
    };
    Ok(Json(serde_json::json!({ "count": count })))
}

async fn export_milestones(State(s): State<Shared>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().await;
        csv_import::export_milestones_csv(&conn, &path).ae()?
    };
    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"milestones.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(Body::from(bytes))
        .ae()
}

// ── Full Backup ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExportFullBackupBody {
    local_storage: String,
    version: String,
}

async fn export_full_backup_handler(
    State(s): State<Shared>,
    Json(body): Json<ExportFullBackupBody>,
) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();

    {
        let conn = s.conn.lock().await;
        kechimochi_lib::backup::export_full_backup_internal(
            &s.data_dir,
            &conn,
            &path,
            &body.local_storage,
            &body.version,
        )
        .ae()?;
    }

    let bytes = std::fs::read(tmp.path()).ae()?;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"full_backup.zip\"",
        )
        .body(Body::from(bytes))
        .ae()
}

async fn import_full_backup_handler(
    State(s): State<Shared>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();

    let ls = {
        let mut conn = s.conn.lock().await;
        kechimochi_lib::backup::import_full_backup_internal(&s.data_dir, &mut conn, &path).ae()?
    };

    Ok(Json(serde_json::json!({ "localStorage": ls })))
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
    let content_type = match file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
    {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
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
    let ua = payload
        .headers
        .as_ref()
        .and_then(|h| h.get("User-Agent"))
        .map(|s| s.to_owned())
        .unwrap_or_else(|| default_ua.to_owned());

    let client = reqwest::Client::builder().user_agent(&ua).build().ae()?;
    let mut req = match payload.method.to_uppercase().as_str() {
        "POST" => client.post(&payload.url),
        _ => client.get(&payload.url),
    };
    if let Some(ref h) = payload.headers {
        for (k, v) in h {
            if k.eq_ignore_ascii_case("User-Agent") {
                continue;
            }
            req = req.header(k, v);
        }
    }
    if let Some(b) = payload.body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let text = req
        .send()
        .await
        .ae()?
        .error_for_status()
        .ae()?
        .text()
        .await
        .ae()?;
    Ok(Json(serde_json::json!({ "data": text })))
}

#[derive(Deserialize)]
struct FetchBytesBody {
    url: String,
}

async fn fetch_bytes_proxy(
    Json(payload): Json<FetchBytesBody>,
) -> HandlerResult<Json<serde_json::Value>> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .ae()?;
    let bytes: Vec<u8> = client
        .get(&payload.url)
        .send()
        .await
        .ae()?
        .error_for_status()
        .ae()?
        .bytes()
        .await
        .ae()?
        .to_vec();
    Ok(Json(serde_json::json!({ "bytes": bytes })))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Reads the first multipart field into a temporary file and returns it.
/// The caller must keep `tmp` alive until the path has been consumed.
async fn field_to_tempfile(multipart: &mut Multipart) -> HandlerResult<tempfile::NamedTempFile> {
    field_to_tempfile_with_name(multipart).await.map(|(tmp, _)| tmp)
}

async fn field_to_tempfile_with_name(
    multipart: &mut Multipart,
) -> HandlerResult<(tempfile::NamedTempFile, Option<String>)> {
    let field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError("No file in multipart".into()))?;
    let file_name = field.file_name().map(|value| value.to_string());
    let bytes = field.bytes().await.ae()?;
    let mut tmp = tempfile::NamedTempFile::new().ae()?;
    tmp.write_all(&bytes).ae()?;
    Ok((tmp, file_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header::CONTENT_TYPE, Request};
    use tower::ServiceExt;

    fn unique_data_dir() -> std::path::PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "kechimochi_web_server_test_{}_{}",
            std::process::id(),
            ts
        ))
    }

    fn sample_media(title: &str) -> models::Media {
        models::Media {
            id: None,
            uid: None,
            title: title.to_string(),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        }
    }

    fn sample_milestone(media_title: &str, name: &str, duration: i64) -> models::Milestone {
        models::Milestone {
            id: None,
            media_uid: None,
            media_title: media_title.to_string(),
            name: name.to_string(),
            duration,
            characters: 0,
            date: Some("2024-03-01".to_string()),
        }
    }

    fn setup_state() -> Shared {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        db::create_tables(&conn).unwrap();

        let data_dir = unique_data_dir();
        std::fs::create_dir_all(&data_dir).unwrap();

        Arc::new(AppState {
            conn: Mutex::new(conn),
            data_dir,
            static_dir: PathBuf::from("dist"),
        })
    }

    #[tokio::test]
    async fn test_get_version_has_web_prefix() {
        let version = get_version().await.0;
        assert!(version.starts_with("web-"));
    }

    #[tokio::test]
    async fn test_add_and_get_media_handlers_roundtrip() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let media = sample_media("Web Handler Test");
        let inserted = add_media(State(state.clone()), Json(media))
            .await
            .unwrap()
            .0;
        assert!(inserted > 0);

        let all = get_all_media(State(state)).await.unwrap().0;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Web Handler Test");
        assert_eq!(all[0].id, Some(inserted));

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_set_and_get_setting_handlers_roundtrip() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let body = SetSettingBody {
            value: "molokai".to_string(),
        };
        let _ = set_setting(State(state.clone()), Path("theme".to_string()), Json(body))
            .await
            .unwrap();

        let value = get_setting(State(state), Path("theme".to_string()))
            .await
            .unwrap()
            .0;
        assert_eq!(value, Some("molokai".to_string()));

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_theme_pack_handlers_roundtrip() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let body = SaveThemePackBody {
            theme_id: "custom:web-theme".to_string(),
            content: r#"{"version":1,"id":"custom:web-theme","name":"Web Theme","variables":{}}"#.to_string(),
            preferred_file_name: Some("web-theme.json".to_string()),
        };

        let _ = save_theme_pack_handler(State(state.clone()), Json(body)).await.unwrap();

        let listed = list_theme_packs_handler(State(state.clone())).await.unwrap().0;
        assert_eq!(listed.len(), 1);
        assert!(listed[0].contains("custom:web-theme"));

        let summaries = list_theme_pack_summaries_handler(State(state.clone())).await.unwrap().0;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "custom:web-theme");
        assert_eq!(summaries[0].name, "Web Theme");

        let fetched = get_theme_pack_handler(State(state.clone()), Path("custom:web-theme".to_string())).await.unwrap().0;
        assert!(fetched.as_deref().is_some_and(|value| value.contains("custom:web-theme")));

        let _ = delete_theme_pack_handler(State(state.clone()), Path("custom:web-theme".to_string())).await.unwrap();

        let listed_after_delete = list_theme_packs_handler(State(state)).await.unwrap().0;
        assert!(listed_after_delete.is_empty());

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_theme_import_route_accepts_large_multipart_payloads() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();
        let app = build_app(state.clone());

        let theme_json = serde_json::json!({
            "version": 1,
            "id": "custom:web-large-theme",
            "name": "Web Large Theme",
            "variables": {
                "surface-base": "#111111",
                "surface-card": "#222222",
                "surface-card-hover": "#333333",
                "text-primary": "#ffffff",
                "text-secondary": "#cccccc",
                "accent-primary": "#ff0000",
                "accent-primary-hover": "#ee0000",
                "accent-danger": "#dd0000",
                "accent-interactive": "#00ff00",
                "accent-highlight": "#0000ff",
                "accent-secondary": "#ff00ff",
                "border-subtle": "#444444",
                "shadow-soft": "0 1px 2px rgba(0,0,0,0.2)",
                "shadow-strong": "0 4px 12px rgba(0,0,0,0.4)",
                "heatmap-hue": "353",
                "heatmap-saturation-base": "30",
                "heatmap-saturation-range": "70",
                "heatmap-lightness-base": "45",
                "heatmap-lightness-range": "41",
                "accent-contrast": "#ffffff",
                "chart-series-1": "#ff0000",
                "chart-series-2": "#00ff00",
                "chart-series-3": "#0000ff",
                "chart-series-4": "#ffff00",
                "chart-series-5": "#ff00ff"
            },
            "background": {
                "type": "video",
                "src": "assets/background.mp4"
            }
        })
        .to_string();
        let asset_bytes = vec![0_u8; 3 * 1024 * 1024];

        let mut archive = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut archive);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("theme.json", options).unwrap();
            zip.write_all(theme_json.as_bytes()).unwrap();
            zip.start_file("assets/background.mp4", options).unwrap();
            zip.write_all(&asset_bytes).unwrap();
            zip.finish().unwrap();
        }
        let zip_bytes = archive.into_inner();
        assert!(zip_bytes.len() > 2 * 1024 * 1024);
        assert!(zip_bytes.len() < MAX_MULTIPART_UPLOAD_BYTES);

        let boundary = "X-BOUNDARY";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"file\"; filename=\"large-theme.zip\"\r\n");
        body.extend_from_slice(b"Content-Type: application/zip\r\n\r\n");
        body.extend_from_slice(&zip_bytes);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/themes/import")
                    .header(CONTENT_TYPE, format!("multipart/form-data; boundary={}", boundary))
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let summaries = list_theme_pack_summaries_handler(State(state)).await.unwrap().0;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "custom:web-large-theme");
        assert_eq!(summaries[0].has_assets, Some(true));

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_get_logs_for_media_handler_filters_by_media_id() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let media_a = add_media(State(state.clone()), Json(sample_media("A")))
            .await
            .unwrap()
            .0;
        let media_b = add_media(State(state.clone()), Json(sample_media("B")))
            .await
            .unwrap()
            .0;

        {
            let conn = state.conn.lock().await;
            db::add_log(
                &conn,
                &models::ActivityLog {
                    id: None,
                    media_id: media_a,
                    duration_minutes: 30,
                    characters: 0,
                    date: "2024-01-01".to_string(),
                    activity_type: String::new(),
                },
            )
            .unwrap();
            db::add_log(
                &conn,
                &models::ActivityLog {
                    id: None,
                    media_id: media_b,
                    duration_minutes: 45,
                    characters: 0,
                    date: "2024-01-02".to_string(),
                    activity_type: String::new(),
                },
            )
            .unwrap();
        }

        let logs_for_a = get_logs_for_media(State(state), Path(media_a))
            .await
            .unwrap()
            .0;
        assert_eq!(logs_for_a.len(), 1);
        assert_eq!(logs_for_a[0].media_id, media_a);
        assert_eq!(logs_for_a[0].title, "A");

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_get_timeline_events_handler_returns_aggregated_events() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let media_id = add_media(
            State(state.clone()),
            Json(models::Media {
                tracking_status: "Complete".to_string(),
                content_type: "Novel".to_string(),
                ..sample_media("Timeline Handler")
            }),
        )
        .await
        .unwrap()
        .0;

        {
            let conn = state.conn.lock().await;
            db::add_log(
                &conn,
                &models::ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 45,
                    characters: 1500,
                    date: "2024-03-01".to_string(),
                    activity_type: "Reading".to_string(),
                },
            )
            .unwrap();
            db::add_milestone(
                &conn,
                &models::Milestone {
                    id: None,
                    media_uid: None,
                    media_title: "Timeline Handler".to_string(),
                    name: "Checkpoint".to_string(),
                    duration: 45,
                    characters: 0,
                    date: Some("2024-03-01".to_string()),
                },
            )
            .unwrap();
        }

        let events = get_timeline_events_handler(State(state)).await.unwrap().0;
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, models::TimelineEventKind::Finished);
        assert_eq!(events[1].kind, models::TimelineEventKind::Milestone);
        assert_eq!(events[1].milestone_minutes, 45);
        assert_eq!(events[1].milestone_characters, 0);

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_milestone_handlers_roundtrip() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let media = sample_media("Milestone Media");
        let _ = add_media(State(state.clone()), Json(media)).await.unwrap();

        let milestone = sample_milestone("Milestone Media", "Chapter 1", 120);
        let inserted_id = add_milestone_handler(State(state.clone()), Json(milestone))
            .await
            .unwrap()
            .0;
        assert!(inserted_id > 0);

        let milestones = get_milestones_for_media_handler(
            State(state.clone()),
            Path("Milestone Media".to_string()),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].name, "Chapter 1");

        let _ = delete_milestone_handler(State(state.clone()), Path(inserted_id))
            .await
            .unwrap();

        let milestones_after_delete =
            get_milestones_for_media_handler(State(state), Path("Milestone Media".to_string()))
                .await
                .unwrap()
                .0;
        assert_eq!(milestones_after_delete.len(), 0);

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_clear_milestones_for_media_handler_removes_only_target_media() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let _ = add_media(State(state.clone()), Json(sample_media("A")))
            .await
            .unwrap();
        let _ = add_media(State(state.clone()), Json(sample_media("B")))
            .await
            .unwrap();

        let _ = add_milestone_handler(State(state.clone()), Json(sample_milestone("A", "A1", 60)))
            .await
            .unwrap();
        let _ = add_milestone_handler(State(state.clone()), Json(sample_milestone("A", "A2", 90)))
            .await
            .unwrap();
        let _ = add_milestone_handler(State(state.clone()), Json(sample_milestone("B", "B1", 45)))
            .await
            .unwrap();

        let _ = clear_milestones_for_media_handler(State(state.clone()), Path("A".to_string()))
            .await
            .unwrap();

        let a_milestones =
            get_milestones_for_media_handler(State(state.clone()), Path("A".to_string()))
                .await
                .unwrap()
                .0;
        let b_milestones = get_milestones_for_media_handler(State(state), Path("B".to_string()))
            .await
            .unwrap()
            .0;

        assert_eq!(a_milestones.len(), 0);
        assert_eq!(b_milestones.len(), 1);
        assert_eq!(b_milestones[0].name, "B1");

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_clear_activities_handler_removes_logs_only() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let media_id = add_media(State(state.clone()), Json(sample_media("Clear Activities")))
            .await
            .unwrap()
            .0;
        {
            let conn = state.conn.lock().await;
            db::add_log(
                &conn,
                &models::ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 20,
                    characters: 0,
                    date: "2024-03-01".to_string(),
                    activity_type: String::new(),
                },
            )
            .unwrap();
        }

        let before_logs = get_logs(State(state.clone())).await.unwrap().0;
        assert_eq!(before_logs.len(), 1);

        let _ = clear_activities(State(state.clone())).await.unwrap();

        let after_logs = get_logs(State(state.clone())).await.unwrap().0;
        assert_eq!(after_logs.len(), 0);

        let media = get_all_media(State(state)).await.unwrap().0;
        assert_eq!(media.len(), 1);

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_initialize_user_db_handler_creates_db() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let body = InitializeDbBody {
            fallback_username: Some("webuser".to_string()),
        };
        let _ = initialize_user_db_handler(State(state.clone()), Json(body))
            .await
            .unwrap();

        let expected_db = state.data_dir.join("kechimochi_user.db");
        assert!(expected_db.exists());

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_wipe_everything_handler_removes_covers_and_db_files() {
        let state = setup_state();
        let state_dir = state.data_dir.clone();

        let covers_dir = state.data_dir.join("covers");
        std::fs::create_dir_all(&covers_dir).unwrap();
        std::fs::write(covers_dir.join("x.png"), "img").unwrap();
        std::fs::write(state.data_dir.join("kechimochi_user.db"), "").unwrap();
        std::fs::write(state.data_dir.join("kechimochi_shared_media.db"), "").unwrap();

        let _ = wipe_everything_handler(State(state.clone())).await.unwrap();

        assert!(!covers_dir.exists());
        assert!(!state.data_dir.join("kechimochi_user.db").exists());
        assert!(!state.data_dir.join("kechimochi_shared_media.db").exists());

        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn test_fetch_json_proxy_returns_error_for_unreachable_url() {
        let payload = FetchJsonBody {
            url: "http://127.0.0.1:0/unreachable".to_string(),
            method: "GET".to_string(),
            body: None,
            headers: None,
        };

        let result = fetch_json_proxy(Json(payload)).await;
        assert!(result.is_err());
    }
}

use std::io::Write as _;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post, put},
    Json, Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::{backup, csv_import, db, get_username_logic, models, profile_picture, sync_state};

pub type DirtyCallback = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;
pub type SharedApiState = Arc<HttpApiState>;

#[derive(Clone)]
pub struct HttpApiState {
    conn: Arc<Mutex<Connection>>,
    data_dir: PathBuf,
    mark_dirty: Option<DirtyCallback>,
}

impl HttpApiState {
    pub fn new(
        conn: Arc<Mutex<Connection>>,
        data_dir: PathBuf,
        mark_dirty: Option<DirtyCallback>,
    ) -> Self {
        Self {
            conn,
            data_dir,
            mark_dirty,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HttpApiScope {
    Automation,
    Full,
}

#[derive(Debug, Clone)]
pub enum HttpApiCors {
    Permissive,
    AllowedOrigins(Vec<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostValidationPolicy {
    LocalOnly,
    LocalNetwork,
    Disabled,
}

#[derive(Debug, Clone)]
pub struct HttpApiRouterConfig {
    pub scope: HttpApiScope,
    pub cors: HttpApiCors,
    pub host_policy: HostValidationPolicy,
}

#[derive(Clone)]
struct HostPolicyState {
    policy: HostValidationPolicy,
}

#[derive(Debug)]
struct AppError(String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}

trait AeExt<T> {
    fn ae(self) -> HandlerResult<T>;
}

impl<T, E: std::fmt::Display> AeExt<T> for std::result::Result<T, E> {
    fn ae(self) -> HandlerResult<T> {
        self.map_err(|e| AppError(e.to_string()))
    }
}

type HandlerResult<T> = std::result::Result<T, AppError>;

pub fn build_api_router(state: SharedApiState, config: HttpApiRouterConfig) -> Router {
    let scope = config.scope;
    let profile_picture_routes = if scope == HttpApiScope::Full {
        get(get_profile_picture_handler)
            .post(upload_profile_picture_handler)
            .delete(delete_profile_picture_handler)
    } else {
        get(get_profile_picture_handler)
    };

    let mut router = Router::new()
        .route("/api/media", get(get_all_media).post(add_media))
        .route(
            "/api/media/:id",
            put(update_media).delete(delete_media_handler),
        )
        .route("/api/logs/heatmap", get(get_heatmap))
        .route("/api/logs/media/:id", get(get_logs_for_media))
        .route("/api/logs", get(get_logs).post(add_log))
        .route(
            "/api/logs/:id",
            put(update_log_handler).delete(delete_log_handler),
        )
        .route("/api/timeline", get(get_timeline_events_handler))
        .route("/api/milestones", post(add_milestone_handler))
        .route(
            "/api/milestones/media/:title",
            get(get_milestones_for_media_handler).delete(clear_milestones_for_media_handler),
        )
        .route(
            "/api/milestones/:id",
            put(update_milestone_handler).delete(delete_milestone_handler),
        )
        .route("/api/profiles/initialize", post(initialize_user_db_handler))
        .route("/api/profile-picture", profile_picture_routes)
        .route("/api/settings/:key", get(get_setting).put(set_setting))
        .route("/api/username", get(get_username))
        .route("/api/version", get(get_version));

    if scope == HttpApiScope::Full {
        router = router
            .route("/api/activities/clear", post(clear_activities))
            .route("/api/reset", post(wipe_everything_handler))
            .route("/api/import/activities", post(import_activities))
            .route("/api/export/activities", get(export_activities))
            .route("/api/import/media/analyze", post(analyze_media_csv_upload))
            .route("/api/import/media/apply", post(apply_media_import_handler))
            .route("/api/export/media", get(export_media_handler))
            .route("/api/import/milestones", post(import_milestones))
            .route("/api/export/milestones", get(export_milestones))
            .route("/api/export/full-backup", post(export_full_backup_handler))
            .route("/api/import/full-backup", post(import_full_backup_handler))
            .route("/api/covers/download", post(download_cover))
            .route("/api/covers/file/:filename", get(serve_cover))
            .route("/api/covers/:media_id", post(upload_cover))
            .route("/api/fetch/json", post(fetch_json_proxy))
            .route("/api/fetch/bytes", post(fetch_bytes_proxy));
    }

    router = router
        .route("/api", any(api_not_found))
        .route("/api/*path", any(api_not_found));

    if config.host_policy != HostValidationPolicy::Disabled {
        router = router.layer(middleware::from_fn_with_state(
            HostPolicyState {
                policy: config.host_policy,
            },
            validate_host,
        ));
    }

    match config.cors {
        HttpApiCors::Permissive => router
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_methods(Any)
                    .allow_headers(Any),
            )
            .with_state(state),
        HttpApiCors::AllowedOrigins(origins) if !origins.is_empty() => {
            let origins = origins
                .iter()
                .filter_map(|origin| HeaderValue::from_str(origin).ok())
                .collect::<Vec<_>>();
            router
                .layer(
                    CorsLayer::new()
                        .allow_origin(origins)
                        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                        .allow_headers([header::CONTENT_TYPE]),
                )
                .with_state(state)
        }
        HttpApiCors::AllowedOrigins(_) => router.with_state(state),
    }
}

async fn validate_host(
    State(policy): State<HostPolicyState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let allowed = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| is_allowed_host(host, policy.policy));

    if allowed {
        next.run(req).await
    } else {
        (
            StatusCode::FORBIDDEN,
            "Host header is not allowed for the local Kechimochi API",
        )
            .into_response()
    }
}

fn is_allowed_host(host_header: &str, policy: HostValidationPolicy) -> bool {
    if policy == HostValidationPolicy::Disabled {
        return true;
    }

    let host = host_name_without_port(host_header);
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };

    match (policy, ip) {
        (HostValidationPolicy::LocalOnly, IpAddr::V4(addr)) => addr.is_loopback(),
        (HostValidationPolicy::LocalOnly, IpAddr::V6(addr)) => addr.is_loopback(),
        (HostValidationPolicy::LocalNetwork, IpAddr::V4(addr)) => {
            addr.is_loopback() || addr.is_private() || addr.is_link_local()
        }
        (HostValidationPolicy::LocalNetwork, IpAddr::V6(addr)) => {
            addr.is_loopback() || is_ipv6_unique_local(&addr) || is_ipv6_unicast_link_local(&addr)
        }
        (HostValidationPolicy::Disabled, _) => true,
    }
}

fn host_name_without_port(host_header: &str) -> &str {
    let trimmed = host_header.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }

    if trimmed.matches(':').count() == 1 {
        return trimmed
            .split_once(':')
            .map(|(host, _)| host)
            .unwrap_or(trimmed);
    }

    trimmed
}

fn is_ipv6_unique_local(addr: &std::net::Ipv6Addr) -> bool {
    (addr.segments()[0] & 0xfe00) == 0xfc00
}

fn is_ipv6_unicast_link_local(addr: &std::net::Ipv6Addr) -> bool {
    (addr.segments()[0] & 0xffc0) == 0xfe80
}

fn mark_dirty(state: &HttpApiState) -> HandlerResult<()> {
    if let Some(callback) = &state.mark_dirty {
        callback().map_err(AppError)?;
    }
    Ok(())
}

async fn api_not_found() -> (StatusCode, &'static str) {
    (StatusCode::NOT_FOUND, "API route not found")
}

async fn get_all_media(State(s): State<SharedApiState>) -> HandlerResult<Json<Vec<models::Media>>> {
    let conn = s.conn.lock().ae()?;
    db::get_all_media(&conn).ae().map(Json)
}

async fn add_media(
    State(s): State<SharedApiState>,
    Json(media): Json<models::Media>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().ae()?;
    let id = db::add_media_with_id(&conn, &media).ae()?;
    mark_dirty(&s)?;
    Ok(Json(id))
}

async fn update_media(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(mut media): Json<models::Media>,
) -> HandlerResult<Json<()>> {
    media.id = Some(id);
    let conn = s.conn.lock().ae()?;
    db::update_media(&conn, &media).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn delete_media_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::delete_media(&conn, id).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn get_logs(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::ActivitySummary>>> {
    let conn = s.conn.lock().ae()?;
    db::get_logs(&conn).ae().map(Json)
}

async fn add_log(
    State(s): State<SharedApiState>,
    Json(log): Json<models::ActivityLog>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().ae()?;
    let id = db::add_log(&conn, &log).ae()?;
    mark_dirty(&s)?;
    Ok(Json(id))
}

async fn update_log_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(mut log): Json<models::ActivityLog>,
) -> HandlerResult<Json<()>> {
    log.id = Some(id);
    let conn = s.conn.lock().ae()?;
    db::update_log(&conn, &log).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn delete_log_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::delete_log(&conn, id).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn get_heatmap(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::DailyHeatmap>>> {
    let conn = s.conn.lock().ae()?;
    db::get_heatmap(&conn).ae().map(Json)
}

async fn get_logs_for_media(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<Vec<models::ActivitySummary>>> {
    let conn = s.conn.lock().ae()?;
    db::get_logs_for_media(&conn, id).ae().map(Json)
}

async fn get_timeline_events_handler(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::TimelineEvent>>> {
    let conn = s.conn.lock().ae()?;
    db::get_timeline_events(&conn).ae().map(Json)
}

async fn get_milestones_for_media_handler(
    State(s): State<SharedApiState>,
    Path(title): Path<String>,
) -> HandlerResult<Json<Vec<models::Milestone>>> {
    let conn = s.conn.lock().ae()?;
    db::get_milestones_for_media(&conn, &title).ae().map(Json)
}

async fn add_milestone_handler(
    State(s): State<SharedApiState>,
    Json(milestone): Json<models::Milestone>,
) -> HandlerResult<Json<i64>> {
    let conn = s.conn.lock().ae()?;
    let id = db::add_milestone(&conn, &milestone).ae()?;
    mark_dirty(&s)?;
    Ok(Json(id))
}

async fn update_milestone_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(mut milestone): Json<models::Milestone>,
) -> HandlerResult<Json<()>> {
    milestone.id = Some(id);
    let conn = s.conn.lock().ae()?;
    db::update_milestone(&conn, &milestone).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn delete_milestone_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::delete_milestone(&conn, id).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn clear_milestones_for_media_handler(
    State(s): State<SharedApiState>,
    Path(title): Path<String>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::delete_milestones_for_media(&conn, &title).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
struct InitializeDbBody {
    fallback_username: Option<String>,
}

async fn initialize_user_db_handler(
    State(s): State<SharedApiState>,
    Json(body): Json<InitializeDbBody>,
) -> HandlerResult<Json<()>> {
    let new_conn = db::init_db(s.data_dir.clone(), body.fallback_username.as_deref()).ae()?;
    *s.conn.lock().ae()? = new_conn;
    Ok(Json(()))
}

async fn get_profile_picture_handler(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Option<models::ProfilePicture>>> {
    let conn = s.conn.lock().ae()?;
    db::get_profile_picture(&conn).ae().map(Json)
}

async fn upload_profile_picture_handler(
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<models::ProfilePicture>> {
    let field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError("No file field in multipart".into()))?;
    let bytes = field.bytes().await.ae()?.to_vec();
    let profile_picture = profile_picture::process_profile_picture_bytes(&bytes).ae()?;
    let conn = s.conn.lock().ae()?;
    db::upsert_profile_picture(&conn, &profile_picture).ae()?;
    mark_dirty(&s)?;
    Ok(Json(profile_picture))
}

async fn delete_profile_picture_handler(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::delete_profile_picture(&conn).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn get_setting(
    State(s): State<SharedApiState>,
    Path(key): Path<String>,
) -> HandlerResult<Json<Option<String>>> {
    let conn = s.conn.lock().ae()?;
    db::get_setting(&conn, &key).ae().map(Json)
}

#[derive(Deserialize)]
struct SetSettingBody {
    value: String,
}

async fn set_setting(
    State(s): State<SharedApiState>,
    Path(key): Path<String>,
    Json(body): Json<SetSettingBody>,
) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::set_setting(&conn, &key, &body.value).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn get_username() -> Json<String> {
    Json(get_username_logic())
}

async fn get_version() -> Json<String> {
    let version = option_env!("CARGO_PKG_VERSION").unwrap_or("0.0.0");
    Json(format!("http-{}", version))
}

async fn clear_activities(State(s): State<SharedApiState>) -> HandlerResult<Json<()>> {
    let conn = s.conn.lock().ae()?;
    db::clear_activities(&conn).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn wipe_everything_handler(State(s): State<SharedApiState>) -> HandlerResult<Json<()>> {
    *s.conn.lock().ae()? = rusqlite::Connection::open_in_memory().ae()?;
    sync_state::clear_sync_runtime_files(&s.data_dir).ae()?;
    db::wipe_everything(s.data_dir.clone()).ae()?;
    mark_dirty(&s)?;
    Ok(Json(()))
}

async fn import_activities(
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let mut conn = s.conn.lock().ae()?;
        csv_import::import_csv(&mut conn, &path).ae()?
    };
    mark_dirty(&s)?;
    Ok(Json(serde_json::json!({ "count": count })))
}

#[derive(Deserialize)]
struct ExportParams {
    start: Option<String>,
    end: Option<String>,
}

async fn export_activities(
    State(s): State<SharedApiState>,
    Query(params): Query<ExportParams>,
) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
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
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<Vec<csv_import::MediaConflict>>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let conn = s.conn.lock().ae()?;
    csv_import::analyze_media_csv(&conn, &path).ae().map(Json)
}

async fn apply_media_import_handler(
    State(s): State<SharedApiState>,
    Json(records): Json<Vec<csv_import::MediaCsvRow>>,
) -> HandlerResult<Json<usize>> {
    let covers_dir = s.data_dir.join("covers");
    let count = {
        let mut conn = s.conn.lock().ae()?;
        csv_import::apply_media_import(covers_dir, &mut conn, records).ae()?
    };
    mark_dirty(&s)?;
    Ok(Json(count))
}

async fn export_media_handler(State(s): State<SharedApiState>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
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
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let mut conn = s.conn.lock().ae()?;
        csv_import::import_milestones_csv(&mut conn, &path).ae()?
    };
    mark_dirty(&s)?;
    Ok(Json(serde_json::json!({ "count": count })))
}

async fn export_milestones(State(s): State<SharedApiState>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
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

#[derive(Deserialize)]
struct ExportFullBackupBody {
    local_storage: String,
    version: String,
}

async fn export_full_backup_handler(
    State(s): State<SharedApiState>,
    Json(body): Json<ExportFullBackupBody>,
) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();

    {
        let conn = s.conn.lock().ae()?;
        backup::export_full_backup_internal(
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
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<serde_json::Value>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError("Invalid temp path".into()))?
        .to_owned();

    let ls = {
        let mut conn = s.conn.lock().ae()?;
        backup::import_full_backup_internal(&s.data_dir, &mut conn, &path).ae()?
    };
    mark_dirty(&s)?;

    Ok(Json(serde_json::json!({ "localStorage": ls })))
}

async fn upload_cover(
    State(s): State<SharedApiState>,
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
    let path = {
        let conn = s.conn.lock().ae()?;
        db::save_cover_bytes(&conn, covers_dir, media_id, bytes, &ext).ae()?
    };
    mark_dirty(&s)?;
    Ok(Json(serde_json::json!({ "path": path })))
}

async fn serve_cover(
    State(s): State<SharedApiState>,
    Path(filename): Path<String>,
) -> HandlerResult<Response> {
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
    State(s): State<SharedApiState>,
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
    let path = {
        let conn = s.conn.lock().ae()?;
        db::save_cover_bytes(&conn, covers_dir, body.media_id, bytes, &ext).ae()?
    };
    mark_dirty(&s)?;
    Ok(Json(serde_json::json!({ "path": path })))
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_validation_allows_only_loopback_in_local_mode() {
        assert!(is_allowed_host(
            "127.0.0.1:3031",
            HostValidationPolicy::LocalOnly
        ));
        assert!(is_allowed_host(
            "localhost:3031",
            HostValidationPolicy::LocalOnly
        ));
        assert!(is_allowed_host(
            "[::1]:3031",
            HostValidationPolicy::LocalOnly
        ));
        assert!(!is_allowed_host(
            "192.168.1.10:3031",
            HostValidationPolicy::LocalOnly
        ));
        assert!(!is_allowed_host(
            "example.com",
            HostValidationPolicy::LocalOnly
        ));
    }

    #[test]
    fn host_validation_allows_private_ips_in_lan_mode() {
        assert!(is_allowed_host(
            "192.168.1.10:3031",
            HostValidationPolicy::LocalNetwork
        ));
        assert!(is_allowed_host(
            "10.0.0.3:3031",
            HostValidationPolicy::LocalNetwork
        ));
        assert!(is_allowed_host(
            "[fd00::1]:3031",
            HostValidationPolicy::LocalNetwork
        ));
        assert!(!is_allowed_host(
            "example.com",
            HostValidationPolicy::LocalNetwork
        ));
        assert!(!is_allowed_host(
            "8.8.8.8:3031",
            HostValidationPolicy::LocalNetwork
        ));
    }
}

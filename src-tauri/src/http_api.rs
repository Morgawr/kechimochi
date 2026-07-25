use std::io::Write as _;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::{
        rejection::JsonRejection, ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post, put},
    Json, Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};

use crate::{
    backup, csv_import, db, get_username_logic, models, profile_picture, remote_fetch, sync_state,
};

pub type DirtyCallback = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;
pub type SharedApiState = Arc<HttpApiState>;

const PROFILE_UPLOAD_LIMIT: usize = 8 * 1024 * 1024;
const CSV_IMPORT_LIMIT: usize = 256 * 1024 * 1024;
const COVER_UPLOAD_LIMIT: usize = 32 * 1024 * 1024;
const FULL_BACKUP_IMPORT_LIMIT: usize = 1024 * 1024 * 1024;
const FULL_BACKUP_EXPORT_LIMIT: usize = 64 * 1024 * 1024;

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
enum AppError {
    Internal(String),
    BadRequest(String),
    Conflict(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::Internal(message) => (StatusCode::INTERNAL_SERVER_ERROR, message).into_response(),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            Self::Conflict(message) => (StatusCode::CONFLICT, message).into_response(),
        }
    }
}

fn map_media_write_error(error: rusqlite::Error) -> AppError {
    let message = error.to_string();
    if message.contains("Another media entry already uses title") {
        AppError::Conflict(message)
    } else if message.contains("cannot be blank")
        || message.contains("requires an id")
        || message.contains("cannot be changed")
        || message.contains("Media extra_data")
        || (message.contains("Media ") && message.contains("not found"))
    {
        AppError::BadRequest(message)
    } else {
        AppError::Internal(message)
    }
}

fn map_milestone_write_error(error: rusqlite::Error) -> AppError {
    let message = error.to_string();
    if message.contains("Milestone ") || message.contains("Media with uid") {
        AppError::BadRequest(message)
    } else {
        AppError::Internal(message)
    }
}

fn map_activity_write_error(error: rusqlite::Error) -> AppError {
    let message = error.to_string();
    if message.contains("Activity ")
        || (message.contains("Media ") && message.contains("not found"))
    {
        AppError::BadRequest(message)
    } else {
        AppError::Internal(message)
    }
}

fn map_csv_import_error(error: String) -> AppError {
    if csv_import::is_client_input_error_message(&error) {
        AppError::BadRequest(error)
    } else {
        AppError::Internal(error)
    }
}

fn map_sync_operation_error(error: String) -> AppError {
    if error == sync_state::SYNC_OPERATION_IN_PROGRESS_ERROR {
        AppError::Conflict(error)
    } else {
        AppError::Internal(error)
    }
}

trait AeExt<T> {
    fn ae(self) -> HandlerResult<T>;
}

impl<T, E: std::fmt::Display> AeExt<T> for std::result::Result<T, E> {
    fn ae(self) -> HandlerResult<T> {
        self.map_err(|e| AppError::Internal(e.to_string()))
    }
}

type HandlerResult<T> = std::result::Result<T, AppError>;

pub fn build_api_router(state: SharedApiState, config: HttpApiRouterConfig) -> Router {
    let scope = config.scope;
    let profile_picture_routes = if scope == HttpApiScope::Full {
        get(get_profile_picture_handler)
            .post(upload_profile_picture_handler)
            .delete(delete_profile_picture_handler)
            .layer(DefaultBodyLimit::max(PROFILE_UPLOAD_LIMIT))
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
            "/api/media/:media_uid/milestones",
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
            .route(
                "/api/import/activities",
                post(import_activities).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route(
                "/api/import/activities/analyze",
                post(analyze_activity_csv_upload).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route(
                "/api/import/activities/apply",
                post(apply_activity_import_handler).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route("/api/export/activities", get(export_activities))
            .route(
                "/api/import/media/analyze",
                post(analyze_media_csv_upload).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route(
                "/api/import/media/apply",
                post(apply_media_import_handler).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route("/api/export/media", get(export_media_handler))
            .route(
                "/api/import/milestones",
                post(import_milestones).layer(DefaultBodyLimit::max(CSV_IMPORT_LIMIT)),
            )
            .route("/api/export/milestones", get(export_milestones))
            .route(
                "/api/export/full-backup",
                post(export_full_backup_handler)
                    .layer(DefaultBodyLimit::max(FULL_BACKUP_EXPORT_LIMIT)),
            )
            .route(
                "/api/import/full-backup",
                post(import_full_backup_handler)
                    .layer(DefaultBodyLimit::max(FULL_BACKUP_IMPORT_LIMIT)),
            )
            .route("/api/covers/download", post(download_cover))
            .route("/api/covers/file/:filename", get(serve_cover))
            .route(
                "/api/covers/:media_id",
                post(upload_cover).layer(DefaultBodyLimit::max(COVER_UPLOAD_LIMIT)),
            )
            .route("/api/fetch/json", post(fetch_json_proxy))
            .route("/api/fetch/bytes", post(fetch_bytes_proxy));
    }

    router = router
        .route("/api", any(api_not_found))
        .route("/api/*path", any(api_not_found))
        .layer(middleware::from_fn(validate_mutation_request));

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
                        .allow_headers([
                            header::CONTENT_TYPE,
                            header::HeaderName::from_static("x-kechimochi-api"),
                        ]),
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
    let host_allowed = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| is_allowed_host(host, policy.policy));

    let peer_allowed = req
        .extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .is_some_and(|ConnectInfo(address)| is_allowed_peer(address.ip(), policy.policy));

    if host_allowed && peer_allowed {
        next.run(req).await
    } else {
        (
            StatusCode::FORBIDDEN,
            "Host header is not allowed for the local Kechimochi API",
        )
            .into_response()
    }
}

async fn validate_mutation_request(req: Request<Body>, next: Next) -> Response {
    if matches!(*req.method(), Method::POST | Method::PUT | Method::DELETE) {
        let is_json = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
            });
        let has_api_header = req
            .headers()
            .get("x-kechimochi-api")
            .and_then(|value| value.to_str().ok())
            == Some("1");
        if !is_json && !has_api_header {
            return (
                StatusCode::FORBIDDEN,
                "Non-JSON mutations require the X-Kechimochi-API: 1 header",
            )
                .into_response();
        }
    }
    next.run(req).await
}

fn is_allowed_host(host_header: &str, policy: HostValidationPolicy) -> bool {
    if policy == HostValidationPolicy::Disabled {
        return true;
    }

    let Some(host) = host_name_without_port(host_header) else {
        return false;
    };
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

fn is_allowed_peer(ip: IpAddr, policy: HostValidationPolicy) -> bool {
    match (policy, ip) {
        (HostValidationPolicy::Disabled, _) => true,
        (HostValidationPolicy::LocalOnly, IpAddr::V4(addr)) => addr.is_loopback(),
        (HostValidationPolicy::LocalOnly, IpAddr::V6(addr)) => addr.is_loopback(),
        (HostValidationPolicy::LocalNetwork, IpAddr::V4(addr)) => {
            addr.is_loopback() || addr.is_private() || addr.is_link_local()
        }
        (HostValidationPolicy::LocalNetwork, IpAddr::V6(addr)) => {
            addr.is_loopback() || is_ipv6_unique_local(&addr) || is_ipv6_unicast_link_local(&addr)
        }
    }
}

fn host_name_without_port(host_header: &str) -> Option<String> {
    let trimmed = host_header.trim();
    let authority = trimmed.parse::<axum::http::uri::Authority>().ok()?;
    let authority_host = authority.host();
    let suffix = trimmed.strip_prefix(authority_host)?;
    if !suffix.is_empty() {
        let port = suffix.strip_prefix(':')?;
        if port.is_empty() || port.parse::<u16>().is_err() {
            return None;
        }
    }

    Some(
        authority_host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
            .unwrap_or(authority_host)
            .to_owned(),
    )
}

fn is_ipv6_unique_local(addr: &std::net::Ipv6Addr) -> bool {
    (addr.segments()[0] & 0xfe00) == 0xfc00
}

fn is_ipv6_unicast_link_local(addr: &std::net::Ipv6Addr) -> bool {
    (addr.segments()[0] & 0xffc0) == 0xfe80
}

fn mark_dirty(state: &HttpApiState) -> HandlerResult<()> {
    if let Some(callback) = &state.mark_dirty {
        callback().map_err(AppError::Internal)?;
    }
    Ok(())
}

fn with_dirty_conn<T>(
    state: &HttpApiState,
    operation: impl FnOnce(&mut Connection) -> HandlerResult<T>,
) -> HandlerResult<T> {
    // Sync finalization uses the same database mutex while deciding whether
    // the profile is Clean. Keep the Dirty marker and mutation behind that
    // mutex so their order cannot be inverted by an in-flight sync.
    let mut conn = state.conn.lock().ae()?;
    mark_dirty(state)?;
    operation(&mut conn)
}

async fn api_not_found() -> (StatusCode, &'static str) {
    (StatusCode::NOT_FOUND, "API route not found")
}

async fn get_all_media(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::HttpMedia>>> {
    let conn = s.conn.lock().ae()?;
    let media = db::get_all_media(&conn)
        .ae()?
        .into_iter()
        .map(models::HttpMedia::from)
        .collect();
    Ok(Json(media))
}

async fn add_media(
    State(s): State<SharedApiState>,
    Json(media): Json<models::HttpMedia>,
) -> HandlerResult<Json<i64>> {
    let media = models::Media::try_from(media).map_err(AppError::BadRequest)?;
    let id = with_dirty_conn(&s, |conn| {
        db::add_media_with_id(conn, &media).map_err(map_media_write_error)
    })?;
    Ok(Json(id))
}

async fn update_media(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(media): Json<models::HttpMedia>,
) -> HandlerResult<Json<()>> {
    let mut media = models::Media::try_from(media).map_err(AppError::BadRequest)?;
    media.id = Some(id);
    with_dirty_conn(&s, |conn| {
        db::update_media(conn, &media).map_err(map_media_write_error)
    })?;
    Ok(Json(()))
}

async fn delete_media_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    with_dirty_conn(&s, |conn| db::delete_media(conn, id).ae())?;
    Ok(Json(()))
}

async fn get_logs(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::HttpActivitySummary>>> {
    let conn = s.conn.lock().ae()?;
    let logs = db::get_logs(&conn)
        .ae()?
        .into_iter()
        .map(models::HttpActivitySummary::from)
        .collect();
    Ok(Json(logs))
}

async fn add_log(
    State(s): State<SharedApiState>,
    Json(log): Json<models::ActivityLog>,
) -> HandlerResult<Json<i64>> {
    let id = with_dirty_conn(&s, |conn| {
        db::add_log(conn, &log).map_err(map_activity_write_error)
    })?;
    Ok(Json(id))
}

async fn update_log_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(mut log): Json<models::ActivityLog>,
) -> HandlerResult<Json<()>> {
    log.id = Some(id);
    with_dirty_conn(&s, |conn| {
        db::update_log(conn, &log).map_err(map_activity_write_error)
    })?;
    Ok(Json(()))
}

async fn delete_log_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    with_dirty_conn(&s, |conn| db::delete_log(conn, id).ae())?;
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
) -> HandlerResult<Json<Vec<models::HttpActivitySummary>>> {
    let conn = s.conn.lock().ae()?;
    let logs = db::get_logs_for_media(&conn, id)
        .ae()?
        .into_iter()
        .map(models::HttpActivitySummary::from)
        .collect();
    Ok(Json(logs))
}

async fn get_timeline_events_handler(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<Vec<models::TimelineEvent>>> {
    let conn = s.conn.lock().ae()?;
    db::get_timeline_events(&conn).ae().map(Json)
}

async fn get_milestones_for_media_handler(
    State(s): State<SharedApiState>,
    Path(media_uid): Path<String>,
) -> HandlerResult<Json<Vec<models::Milestone>>> {
    let conn = s.conn.lock().ae()?;
    db::get_milestones_for_media_uid(&conn, &media_uid)
        .ae()
        .map(Json)
}

async fn add_milestone_handler(
    State(s): State<SharedApiState>,
    Json(milestone): Json<models::Milestone>,
) -> HandlerResult<Json<i64>> {
    let id = with_dirty_conn(&s, |conn| {
        db::add_milestone(conn, &milestone).map_err(map_milestone_write_error)
    })?;
    Ok(Json(id))
}

async fn update_milestone_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
    Json(mut milestone): Json<models::Milestone>,
) -> HandlerResult<Json<()>> {
    milestone.id = Some(id);
    with_dirty_conn(&s, |conn| {
        db::update_milestone(conn, &milestone).map_err(map_milestone_write_error)
    })?;
    Ok(Json(()))
}

async fn delete_milestone_handler(
    State(s): State<SharedApiState>,
    Path(id): Path<i64>,
) -> HandlerResult<Json<()>> {
    with_dirty_conn(&s, |conn| db::delete_milestone(conn, id).ae())?;
    Ok(Json(()))
}

async fn clear_milestones_for_media_handler(
    State(s): State<SharedApiState>,
    Path(media_uid): Path<String>,
) -> HandlerResult<Json<()>> {
    with_dirty_conn(&s, |conn| {
        db::delete_milestones_for_media_uid(conn, &media_uid).ae()
    })?;
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
        .ok_or_else(|| AppError::Internal("No file field in multipart".into()))?;
    let bytes = field.bytes().await.ae()?.to_vec();
    let profile_picture = profile_picture::process_profile_picture_bytes(&bytes).ae()?;
    with_dirty_conn(&s, |conn| {
        db::upsert_profile_picture(conn, &profile_picture).ae()
    })?;
    Ok(Json(profile_picture))
}

async fn delete_profile_picture_handler(
    State(s): State<SharedApiState>,
) -> HandlerResult<Json<()>> {
    with_dirty_conn(&s, |conn| db::delete_profile_picture(conn).ae())?;
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
    with_dirty_conn(&s, |conn| db::set_setting(conn, &key, &body.value).ae())?;
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
    with_dirty_conn(&s, |conn| db::clear_activities(conn).ae())?;
    Ok(Json(()))
}

async fn wipe_everything_handler(State(s): State<SharedApiState>) -> HandlerResult<Json<()>> {
    let _sync_guard =
        sync_state::acquire_sync_lock(&s.data_dir).map_err(map_sync_operation_error)?;
    let mut conn = s.conn.lock().ae()?;
    *conn = rusqlite::Connection::open_in_memory().ae()?;
    let reset_result = sync_state::wipe_local_data(&s.data_dir);
    if let Err(error) = reset_result {
        if let Ok(connection) = db::init_db(s.data_dir.clone(), None) {
            *conn = connection;
        }
        return Err(AppError::Internal(error));
    }
    *conn = db::init_db(s.data_dir.clone(), None).ae()?;
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let count = with_dirty_conn(&s, |conn| {
        csv_import::import_csv(conn, &path).map_err(map_csv_import_error)
    })?;
    Ok(Json(serde_json::json!({ "count": count })))
}

async fn analyze_activity_csv_upload(
    State(s): State<SharedApiState>,
    mut multipart: Multipart,
) -> HandlerResult<Json<csv_import::ActivityCsvAnalysis>> {
    let tmp = field_to_tempfile(&mut multipart).await?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let conn = s.conn.lock().ae()?;
    csv_import::analyze_activity_csv(&conn, &path)
        .map_err(map_csv_import_error)
        .map(Json)
}

async fn apply_activity_import_handler(
    State(s): State<SharedApiState>,
    payload: Result<Json<csv_import::ActivityCsvImportRequest>, JsonRejection>,
) -> HandlerResult<Json<csv_import::ActivityCsvImportResult>> {
    let Json(request) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    with_dirty_conn(&s, |conn| {
        csv_import::apply_activity_import(conn, request)
            .map_err(map_csv_import_error)
            .map(Json)
    })
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
        csv_import::export_logs_csv(&conn, &path, params.start, params.end).ae()?
    };
    let body = tempfile_body(&tmp)?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"activities.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(body)
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let conn = s.conn.lock().ae()?;
    csv_import::analyze_media_csv(&conn, &path)
        .map_err(map_csv_import_error)
        .map(Json)
}

async fn apply_media_import_handler(
    State(s): State<SharedApiState>,
    payload: Result<Json<Vec<csv_import::MediaCsvImportSelection>>, JsonRejection>,
) -> HandlerResult<Json<usize>> {
    let Json(records) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let covers_dir = s.data_dir.join("covers");
    let count = with_dirty_conn(&s, |conn| {
        csv_import::apply_media_import(covers_dir, conn, records).map_err(map_csv_import_error)
    })?;
    Ok(Json(count))
}

async fn export_media_handler(State(s): State<SharedApiState>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
        csv_import::export_media_csv(&conn, &path).ae()?
    };
    let body = tempfile_body(&tmp)?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"media_library.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(body)
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let count = with_dirty_conn(&s, |conn| {
        csv_import::import_milestones_csv(conn, &path).map_err(map_csv_import_error)
    })?;
    Ok(Json(serde_json::json!({ "count": count })))
}

async fn export_milestones(State(s): State<SharedApiState>) -> HandlerResult<Response> {
    let tmp = tempfile::NamedTempFile::new().ae()?;
    let path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();
    let count = {
        let conn = s.conn.lock().ae()?;
        csv_import::export_milestones_csv(&conn, &path).ae()?
    };
    let body = tempfile_body(&tmp)?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"milestones.csv\"",
        )
        .header("x-row-count", count.to_string())
        .body(body)
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
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

    let body = tempfile_body(&tmp)?;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"full_backup.zip\"",
        )
        .body(body)
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
        .ok_or_else(|| AppError::Internal("Invalid temp path".into()))?
        .to_owned();

    let ls = {
        let _sync_guard =
            sync_state::acquire_sync_lock(&s.data_dir).map_err(map_sync_operation_error)?;
        let zip_file = std::fs::File::open(&path).ae()?;
        match backup::prepare_full_backup_from_reader_internal(&s.data_dir, zip_file).ae()? {
            backup::PreparedFullBackupOutcome::Ready(prepared) => {
                let mut conn = s.conn.lock().ae()?;
                backup::install_prepared_full_backup(&s.data_dir, &mut conn, &prepared).ae()?
            }
            backup::PreparedFullBackupOutcome::RecoveryRequired { prepared, .. } => {
                let _ = std::fs::remove_dir_all(prepared.staging_dir);
                return Err(AppError::BadRequest(
                    "This backup requires interactive database recovery in the desktop app."
                        .to_string(),
                ));
            }
        }
    };

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
        .ok_or_else(|| AppError::Internal("No file field in multipart".into()))?;
    let bytes = field.bytes().await.ae()?.to_vec();
    let extension = remote_fetch::infer_image_extension(&bytes).map_err(AppError::BadRequest)?;
    let path = with_dirty_conn(&s, |conn| {
        db::save_cover_bytes(conn, covers_dir, media_id, bytes, &extension).ae()
    })?;
    Ok(Json(serde_json::json!({ "path": path })))
}

async fn serve_cover(
    State(s): State<SharedApiState>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> HandlerResult<Response> {
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Internal("Invalid filename".into()))?
        .to_owned();
    let covers_dir = std::fs::canonicalize(s.data_dir.join("covers"))
        .map_err(|_| AppError::Internal("Cover not found".into()))?;
    let file_path = std::fs::canonicalize(covers_dir.join(&safe_name))
        .map_err(|_| AppError::Internal("Cover not found".into()))?;
    if !file_path.starts_with(&covers_dir) || !file_path.is_file() {
        return Err(AppError::BadRequest("Invalid cover path".into()));
    }
    let (file, etag) = open_hashed_file(&file_path).await?;
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        == Some(etag.as_str())
    {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ETAG, etag)
            .header(header::CACHE_CONTROL, "private, no-cache")
            .body(Body::empty())
            .ae();
    }
    let content_type = match file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/jpeg",
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "private, no-cache")
        .body(Body::from_stream(ReaderStream::new(file)))
        .ae()
}

async fn open_hashed_file(path: &std::path::Path) -> HandlerResult<(tokio::fs::File, String)> {
    let mut file = tokio::fs::File::open(path).await.ae()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).await.ae()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    file.seek(std::io::SeekFrom::Start(0)).await.ae()?;
    Ok((file, format!("\"{:x}\"", hasher.finalize())))
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
    let bytes = remote_fetch::fetch_public(remote_fetch::PublicFetchRequest {
        url: body.url,
        method: reqwest::Method::GET,
        body: None,
        headers: std::collections::HashMap::new(),
        max_response_bytes: remote_fetch::MAX_BINARY_RESPONSE_BYTES,
    })
    .await
    .map_err(AppError::BadRequest)?
    .bytes;
    let extension = remote_fetch::infer_image_extension(&bytes).map_err(AppError::BadRequest)?;
    let path = with_dirty_conn(&s, |conn| {
        db::save_cover_bytes(conn, covers_dir, body.media_id, bytes, &extension).ae()
    })?;
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
    let method = match payload.method.to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "GET" => reqwest::Method::GET,
        _ => {
            return Err(AppError::BadRequest(
                "Only GET and POST remote requests are supported".to_string(),
            ));
        }
    };
    let mut headers = payload.headers.unwrap_or_default();
    if payload.body.is_some()
        && !headers
            .keys()
            .any(|name| name.eq_ignore_ascii_case("content-type"))
    {
        headers.insert("Content-Type".to_string(), "application/json".to_string());
    }
    let response = remote_fetch::fetch_public(remote_fetch::PublicFetchRequest {
        url: payload.url,
        method,
        body: payload.body.map(String::into_bytes),
        headers,
        max_response_bytes: remote_fetch::MAX_TEXT_RESPONSE_BYTES,
    })
    .await
    .map_err(AppError::BadRequest)?;
    Ok(Json(serde_json::json!({
        "data": String::from_utf8_lossy(&response.bytes)
    })))
}

#[derive(Deserialize)]
struct FetchBytesBody {
    url: String,
}

async fn fetch_bytes_proxy(
    Json(payload): Json<FetchBytesBody>,
) -> HandlerResult<Json<serde_json::Value>> {
    let bytes = remote_fetch::fetch_public(remote_fetch::PublicFetchRequest {
        url: payload.url,
        method: reqwest::Method::GET,
        body: None,
        headers: std::collections::HashMap::new(),
        max_response_bytes: remote_fetch::MAX_BINARY_RESPONSE_BYTES,
    })
    .await
    .map_err(AppError::BadRequest)?
    .bytes;
    Ok(Json(serde_json::json!({ "bytes": bytes })))
}

async fn field_to_tempfile(multipart: &mut Multipart) -> HandlerResult<tempfile::NamedTempFile> {
    let mut field = multipart
        .next_field()
        .await
        .ae()?
        .ok_or_else(|| AppError::Internal("No file in multipart".into()))?;
    let mut tmp = tempfile::NamedTempFile::new().ae()?;
    while let Some(chunk) = field.chunk().await.ae()? {
        tmp.write_all(&chunk).ae()?;
    }
    Ok(tmp)
}

fn tempfile_body(tmp: &tempfile::NamedTempFile) -> HandlerResult<Body> {
    // CSV and backup exporters atomically replace the destination path. Reopen
    // that installed file by path rather than asking NamedTempFile to verify
    // that its original inode is still there.
    let file = std::fs::File::open(tmp.path()).ae()?;
    Ok(Body::from_stream(ReaderStream::new(
        tokio::fs::File::from_std(file),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::FromRequest;
    use tower::ServiceExt;

    fn setup_api_state() -> SharedApiState {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        db::create_tables(&conn).unwrap();
        Arc::new(HttpApiState::new(
            Arc::new(Mutex::new(conn)),
            PathBuf::from("/tmp/kechimochi-http-api-tests"),
            None,
        ))
    }

    fn setup_disk_api_state(data_dir: &std::path::Path) -> SharedApiState {
        let conn = db::init_db(data_dir.to_path_buf(), None).unwrap();
        Arc::new(HttpApiState::new(
            Arc::new(Mutex::new(conn)),
            data_dir.to_path_buf(),
            None,
        ))
    }

    fn sample_http_media(title: &str, variant: &str) -> models::HttpMedia {
        models::HttpMedia::from(models::Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: variant.to_string(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        })
    }

    async fn csv_multipart(file_name: &str, contents: &str) -> Multipart {
        file_multipart(file_name, "text/csv", contents.as_bytes()).await
    }

    async fn file_multipart(file_name: &str, content_type: &str, contents: &[u8]) -> Multipart {
        let boundary = "kechimochi-csv-boundary";
        let mut body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .into_bytes();
        body.extend_from_slice(contents);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let request = Request::builder()
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap();
        Multipart::from_request(request, &()).await.unwrap()
    }

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
        assert!(!is_allowed_host(
            "[::1]evil",
            HostValidationPolicy::LocalOnly
        ));
        assert!(!is_allowed_host(
            "127.0.0.1:not-a-port",
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

    #[tokio::test]
    async fn media_handlers_allow_variants_and_return_conflict_for_an_exact_pair() {
        let state = setup_api_state();
        let _ = add_media(
            State(state.clone()),
            Json(sample_http_media("Horimiya", "Anime")),
        )
        .await
        .unwrap();
        let _ = add_media(
            State(state.clone()),
            Json(sample_http_media("Horimiya", "Manga")),
        )
        .await
        .unwrap();

        let error = add_media(
            State(state.clone()),
            Json(sample_http_media("Horimiya", "Anime")),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AppError::Conflict(_)));

        let mut anime = get_all_media(State(state.clone()))
            .await
            .unwrap()
            .0
            .into_iter()
            .find(|media| media.variant == "Anime")
            .unwrap();
        let anime_id = anime.id.unwrap();
        anime.variant = "Manga".to_string();
        let error = update_media(State(state.clone()), Path(anime_id), Json(anime))
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Conflict(_)));
        assert_eq!(get_all_media(State(state)).await.unwrap().0.len(), 2);
    }

    #[tokio::test]
    async fn media_handlers_return_bad_request_for_whitespace_only_titles() {
        let state = setup_api_state();
        let add_error = add_media(
            State(state.clone()),
            Json(sample_http_media(" \t\u{2003} ", "Novel")),
        )
        .await
        .unwrap_err();
        assert!(matches!(add_error, AppError::BadRequest(_)));
        assert!(get_all_media(State(state.clone()))
            .await
            .unwrap()
            .0
            .is_empty());

        let media_id = add_media(
            State(state.clone()),
            Json(sample_http_media("Original", "Novel")),
        )
        .await
        .unwrap()
        .0;
        let mut media = get_all_media(State(state.clone()))
            .await
            .unwrap()
            .0
            .remove(0);
        media.title = " \n\u{2003}".to_string();
        let update_error = update_media(State(state.clone()), Path(media_id), Json(media))
            .await
            .unwrap_err();
        assert!(matches!(update_error, AppError::BadRequest(_)));
        assert_eq!(
            get_all_media(State(state)).await.unwrap().0[0].title,
            "Original"
        );
    }

    #[tokio::test]
    async fn activity_handlers_return_bad_request_for_negative_metrics() {
        let state = setup_api_state();
        let media_id = add_media(
            State(state.clone()),
            Json(sample_http_media("Validation", "Novel")),
        )
        .await
        .unwrap()
        .0;
        let error = add_log(
            State(state.clone()),
            Json(models::ActivityLog {
                id: None,
                media_id,
                duration_minutes: -1,
                characters: 100,
                date: "2026-07-22".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
        assert!(get_logs(State(state)).await.unwrap().0.is_empty());
    }

    #[tokio::test]
    async fn csv_activity_handler_returns_bad_request_for_identifier_columns_and_ambiguity() {
        let state = setup_api_state();
        let forbidden_identifier = csv_multipart(
            "activities.csv",
            "Date,Log Name,Default Activity Type,Duration,Language,Media UID\n\
             2026-07-21,No IDs,Reading,30,Japanese,opaque-id\n",
        )
        .await;
        let error = import_activities(State(state.clone()), forbidden_identifier)
            .await
            .unwrap_err();
        match error {
            AppError::BadRequest(message) => {
                assert!(message.contains("Unsupported 'Media UID' column"));
            }
            other => panic!("expected bad request, got {other:?}"),
        }

        {
            let conn = state.conn.lock().unwrap();
            for variant in ["Anime", "Manga"] {
                db::add_media_with_id(
                    &conn,
                    &models::Media {
                        variant: variant.to_string(),
                        ..models::Media::try_from(sample_http_media("Horimiya", variant)).unwrap()
                    },
                )
                .unwrap();
            }
        }
        let ambiguous = csv_multipart(
            "activities.csv",
            "Date,Log Name,Default Activity Type,Duration,Language\n\
             2026-07-21,Horimiya,Reading,30,Japanese\n",
        )
        .await;
        let error = import_activities(State(state.clone()), ambiguous)
            .await
            .unwrap_err();
        match error {
            AppError::BadRequest(message) => {
                assert!(message.contains("Ambiguous activity CSV row 2"));
            }
            other => panic!("expected bad request, got {other:?}"),
        }
        assert!(db::get_logs(&state.conn.lock().unwrap())
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn csv_media_apply_handler_maps_semantic_errors_to_bad_request_only() {
        let state = setup_api_state();
        let invalid = csv_import::MediaCsvRow {
            title: " \t\u{2003} ".to_string(),
            default_activity_type: Some("Reading".to_string()),
            legacy_media_type: None,
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            content_type: "Novel".to_string(),
            tracking_status: None,
            extra_data: "{}".to_string(),
            cover_image_b64: String::new(),
            variant: "Manga".to_string(),
        };

        let error = apply_media_import_handler(
            State(state),
            Ok(Json(vec![csv_import::MediaCsvImportSelection {
                incoming: invalid,
                review_token: "not-reached-for-invalid-title".to_string(),
            }])),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
        assert!(matches!(
            map_csv_import_error("disk write failed".to_string()),
            AppError::Internal(_)
        ));
    }

    #[tokio::test]
    async fn csv_media_apply_route_maps_forbidden_identifier_json_to_bad_request() {
        let state = setup_api_state();
        let router = build_api_router(
            state,
            HttpApiRouterConfig {
                scope: HttpApiScope::Full,
                cors: HttpApiCors::AllowedOrigins(Vec::new()),
                host_policy: HostValidationPolicy::Disabled,
            },
        );
        let body = serde_json::json!([{
            "incoming": {
                "Title": "No private identity",
                "Default Activity Type": "Reading",
                "Status": "Active",
                "Language": "Japanese",
                "Description": "",
                "Content Type": "Novel",
                "Extra Data": "{}",
                "Cover Image (Base64)": "",
                "Variant": "",
                "Media UID": "private-uid"
            },
            "review_token": "not-reached-for-forbidden-identifier"
        }])
        .to_string();

        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/import/media/apply")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert!(String::from_utf8(bytes.to_vec())
            .unwrap()
            .contains("Media UID"));
    }

    #[tokio::test]
    async fn csv_export_streams_the_atomically_installed_file() {
        let response = export_milestones(State(setup_api_state())).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(
            bytes.as_ref(),
            b"Media Title,Name,Duration,Characters,Date,Media Variant\n"
        );
    }

    #[tokio::test]
    async fn milestone_handlers_use_media_uid_for_same_title_variants() {
        let state = setup_api_state();
        let _ = add_media(
            State(state.clone()),
            Json(sample_http_media("Horimiya", "Anime")),
        )
        .await
        .unwrap();
        let _ = add_media(
            State(state.clone()),
            Json(sample_http_media("Horimiya", "Manga")),
        )
        .await
        .unwrap();
        let media = get_all_media(State(state.clone())).await.unwrap().0;
        let anime_uid = media
            .iter()
            .find(|media| media.variant == "Anime")
            .and_then(|media| media.uid.clone())
            .unwrap();
        let manga_uid = media
            .iter()
            .find(|media| media.variant == "Manga")
            .and_then(|media| media.uid.clone())
            .unwrap();

        for (uid, name) in [
            (&anime_uid, "Anime checkpoint"),
            (&manga_uid, "Manga checkpoint"),
        ] {
            let _ = add_milestone_handler(
                State(state.clone()),
                Json(models::Milestone {
                    id: None,
                    media_uid: Some(uid.to_string()),
                    media_title: "client display text is ignored".to_string(),
                    name: name.to_string(),
                    duration: 30,
                    characters: 0,
                    date: None,
                }),
            )
            .await
            .unwrap();
        }

        let anime = get_milestones_for_media_handler(State(state.clone()), Path(anime_uid.clone()))
            .await
            .unwrap()
            .0;
        let manga = get_milestones_for_media_handler(State(state.clone()), Path(manga_uid.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(anime[0].name, "Anime checkpoint");
        assert_eq!(anime[0].media_title, "Horimiya");
        assert_eq!(manga[0].name, "Manga checkpoint");

        let _ = clear_milestones_for_media_handler(State(state.clone()), Path(anime_uid.clone()))
            .await
            .unwrap();
        assert!(
            get_milestones_for_media_handler(State(state.clone()), Path(anime_uid))
                .await
                .unwrap()
                .0
                .is_empty()
        );
        assert_eq!(
            get_milestones_for_media_handler(State(state), Path(manga_uid))
                .await
                .unwrap()
                .0
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn destructive_routes_return_conflict_without_mutating_database_or_sync_runtime() {
        let data_dir = tempfile::TempDir::new().unwrap();
        let state = setup_disk_api_state(data_dir.path());
        let _ = add_media(
            State(state.clone()),
            Json(sample_http_media("Keep me", "Novel")),
        )
        .await
        .unwrap();
        sync_state::ensure_sync_dir(data_dir.path()).unwrap();
        std::fs::write(sync_state::sync_config_path(data_dir.path()), "config").unwrap();
        std::fs::write(sync_state::base_snapshot_path(data_dir.path()), "base").unwrap();
        std::fs::write(
            sync_state::pending_conflicts_path(data_dir.path()),
            "pending",
        )
        .unwrap();
        let _sync_guard = sync_state::acquire_sync_lock(data_dir.path()).unwrap();

        let router = build_api_router(
            state.clone(),
            HttpApiRouterConfig {
                scope: HttpApiScope::Full,
                cors: HttpApiCors::AllowedOrigins(Vec::new()),
                host_policy: HostValidationPolicy::Disabled,
            },
        );
        let reset_response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/reset")
                    .header("X-Kechimochi-API", "1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reset_response.status(), StatusCode::CONFLICT);

        let import_error = import_full_backup_handler(
            State(state.clone()),
            file_multipart("backup.zip", "application/zip", b"not opened").await,
        )
        .await
        .unwrap_err();
        assert!(matches!(import_error, AppError::Conflict(_)));

        assert_eq!(
            db::get_all_media(&state.conn.lock().unwrap())
                .unwrap()
                .len(),
            1
        );
        assert!(data_dir.path().join("kechimochi_user.db").exists());
        assert!(sync_state::sync_config_path(data_dir.path()).exists());
        assert!(sync_state::base_snapshot_path(data_dir.path()).exists());
        assert!(sync_state::pending_conflicts_path(data_dir.path()).exists());
    }

    #[tokio::test]
    async fn full_backup_import_clears_the_previous_sync_runtime() {
        let source_dir = tempfile::TempDir::new().unwrap();
        let source_conn = db::init_db(source_dir.path().to_path_buf(), None).unwrap();
        db::add_media_with_id(
            &source_conn,
            &models::Media::try_from(sample_http_media("Imported", "Manga")).unwrap(),
        )
        .unwrap();
        let backup_path = source_dir.path().join("full-backup.zip");
        backup::export_full_backup_internal(
            source_dir.path(),
            &source_conn,
            backup_path.to_str().unwrap(),
            r#"{"restored":true}"#,
            "test",
        )
        .unwrap();

        let target_dir = tempfile::TempDir::new().unwrap();
        let state = setup_disk_api_state(target_dir.path());
        sync_state::ensure_sync_dir(target_dir.path()).unwrap();
        std::fs::write(sync_state::sync_config_path(target_dir.path()), "config").unwrap();
        std::fs::write(sync_state::base_snapshot_path(target_dir.path()), "base").unwrap();
        std::fs::write(
            sync_state::pending_conflicts_path(target_dir.path()),
            "pending",
        )
        .unwrap();
        let backup_bytes = std::fs::read(&backup_path).unwrap();

        let Json(result) = import_full_backup_handler(
            State(state.clone()),
            file_multipart("backup.zip", "application/zip", &backup_bytes).await,
        )
        .await
        .unwrap();

        assert_eq!(result["localStorage"], r#"{"restored":true}"#);
        let media = db::get_all_media(&state.conn.lock().unwrap()).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "Imported");
        assert!(!sync_state::sync_config_path(target_dir.path()).exists());
        assert!(!sync_state::base_snapshot_path(target_dir.path()).exists());
        assert!(!sync_state::pending_conflicts_path(target_dir.path()).exists());
    }
}

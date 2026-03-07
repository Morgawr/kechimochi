use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::Multipart;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use crate::state::AppState;
use kechimochi_core::models::{ActivityLog, Media};

pub fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        // Unified command invoke (mirrors Tauri IPC).
        // Most commands go through here – adding a new one is just a match arm.
        .route("/invoke/{command}", post(invoke_command))
        // File operations need dedicated routes (multipart uploads / binary downloads).
        .route("/covers/{media_id}/upload", post(upload_cover))
        .route("/covers/{media_id}", get(get_cover))
        .route("/import/csv", post(import_csv))
        .route("/export/csv", get(export_csv))
}

// ─── Helpers ─────────────────────────────────────────────────

/// Extract a typed argument from parsed JSON args.
/// Early-returns a 400 response on missing / malformed arg.
macro_rules! arg {
    ($args:expr, $key:expr) => {
        match serde_json::from_value($args.get($key).cloned().unwrap_or(Value::Null)) {
            Ok(v) => v,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("Invalid arg '{}': {}", $key, e),
                )
                    .into_response()
            }
        }
    };
}

/// Convert a `Result<T, E>` into a JSON 200 response, or a 500 on error.
fn to_json<T: serde::Serialize, E: std::fmt::Display>(result: Result<T, E>) -> Response {
    match result {
        Ok(val) => Json(val).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ─── Unified command dispatch ────────────────────────────────
// Mirrors Tauri's invoke IPC. The frontend sends the same command name and
// args object it would send through Tauri, and we dispatch here.
// To add a new command: add a match arm below (and one line in api.ts).

async fn invoke_command(
    State(state): State<Arc<AppState>>,
    Path(command): Path<String>,
    body: String,
) -> Response {
    let args: Value =
        serde_json::from_str(&body).unwrap_or(Value::Object(Default::default()));

    match command.as_str() {
        // --- Media ---
        "get_all_media" => {
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::get_all_media(&conn))
        }
        "add_media" => {
            let media: Media = arg!(args, "media");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::add_media_with_id(&conn, &media))
        }
        "update_media" => {
            let media: Media = arg!(args, "media");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::update_media(&conn, &media))
        }
        "delete_media" => {
            let id: i64 = arg!(args, "id");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::delete_media(&conn, id))
        }

        // --- Logs ---
        "add_log" => {
            let log: ActivityLog = arg!(args, "log");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::add_log(&conn, &log))
        }
        "delete_log" => {
            let id: i64 = arg!(args, "id");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::delete_log(&conn, id))
        }
        "get_logs" => {
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::get_logs(&conn))
        }
        "get_heatmap" => {
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::get_heatmap(&conn))
        }
        "get_logs_for_media" => {
            let media_id: i64 = arg!(args, "mediaId");
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::db::get_logs_for_media(&conn, media_id))
        }

        // --- Profiles ---
        "switch_profile" => {
            let profile_name: String = arg!(args, "profileName");
            match kechimochi_core::db::init_db(&state.data_dir, &profile_name) {
                Ok(new_conn) => {
                    let mut conn = state.conn.lock().unwrap();
                    *conn = new_conn;
                    Json(()).into_response()
                }
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
                }
            }
        }
        "wipe_profile" => {
            let profile_name: String = arg!(args, "profileName");
            {
                let mut conn = state.conn.lock().unwrap();
                *conn = rusqlite::Connection::open_in_memory().unwrap();
            }
            if let Err(e) =
                kechimochi_core::db::wipe_profile(&state.data_dir, &profile_name)
            {
                return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
            }
            match kechimochi_core::db::init_db(&state.data_dir, &profile_name) {
                Ok(new_conn) => {
                    let mut conn = state.conn.lock().unwrap();
                    *conn = new_conn;
                    Json(()).into_response()
                }
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
                }
            }
        }
        "delete_profile" => {
            let profile_name: String = arg!(args, "profileName");
            {
                let mut conn = state.conn.lock().unwrap();
                *conn = rusqlite::Connection::open_in_memory().unwrap();
            }
            to_json(kechimochi_core::db::wipe_profile(
                &state.data_dir,
                &profile_name,
            ))
        }
        "list_profiles" => {
            to_json(kechimochi_core::db::list_profiles(&state.data_dir))
        }

        // --- Proxy ---
        "fetch_external_json" => {
            let url: String = arg!(args, "url");
            let method: String = arg!(args, "method");
            let body_opt: Option<String> = args
                .get("body")
                .and_then(|v| if v.is_null() { None } else { v.as_str().map(str::to_string) });
            match kechimochi_core::covers::fetch_external_json(&url, &method, body_opt)
                .await
            {
                Ok(text) => Json(text).into_response(),
                Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
            }
        }

        // --- Cover download ---
        "download_and_save_image" => {
            let media_id: i64 = arg!(args, "mediaId");
            let url: String = arg!(args, "url");

            // Download image bytes first (no lock held across await)
            let client = match reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                        .into_response()
                }
            };
            let res = match client.get(&url).send().await {
                Ok(r) => r,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
                }
            };
            let res = match res.error_for_status() {
                Ok(r) => r,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
                }
            };
            let bytes = match res.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
                }
            };

            let ext = std::path::Path::new(&url)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");
            let ext = ext.split('?').next().unwrap_or("jpg");
            let dest_file = format!("{}_remote.{}", media_id, ext);

            // Now lock and save
            let conn = state.conn.lock().unwrap();
            to_json(kechimochi_core::covers::save_cover(
                &conn,
                &state.covers_dir,
                media_id,
                &dest_file,
                &bytes,
            ))
        }

        _ => (
            StatusCode::NOT_FOUND,
            format!("Unknown command: {command}"),
        )
            .into_response(),
    }
}

// ─── File operation handlers (need special HTTP handling) ────

async fn upload_cover(
    State(state): State<Arc<AppState>>,
    Path(media_id): Path<i64>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field
            .file_name()
            .unwrap_or("upload.png")
            .to_string();
        let ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let dest_name = format!("{}.{}", media_id, ext);

        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, e.to_string()).into_response();
            }
        };

        let conn = state.conn.lock().unwrap();
        return match kechimochi_core::covers::save_cover(
            &conn,
            &state.covers_dir,
            media_id,
            &dest_name,
            &data,
        ) {
            Ok(path) => Json(path).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        };
    }
    (StatusCode::BAD_REQUEST, "No file uploaded").into_response()
}

async fn get_cover(
    State(state): State<Arc<AppState>>,
    Path(media_id): Path<i64>,
) -> impl IntoResponse {
    let cover_path = {
        let conn = state.conn.lock().unwrap();
        kechimochi_core::db::get_cover_image(&conn, media_id)
    };

    if cover_path.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }

    match kechimochi_core::covers::read_file_bytes(&cover_path) {
        Ok(bytes) => {
            let ext = std::path::Path::new(&cover_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let content_type = match ext {
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "image/png",
            };
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, content_type)],
                bytes,
            )
                .into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn import_csv(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    while let Ok(Some(field)) = multipart.next_field().await {
        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, e.to_string()).into_response();
            }
        };

        let temp_path = state.data_dir.join("_import_temp.csv");
        if let Err(e) = std::fs::write(&temp_path, &data) {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }

        let mut conn = state.conn.lock().unwrap();
        let result = kechimochi_core::csv_import::import_csv(
            &mut conn,
            temp_path.to_str().unwrap_or(""),
        );
        let _ = std::fs::remove_file(&temp_path);

        return match result {
            Ok(count) => Json(count).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        };
    }
    (StatusCode::BAD_REQUEST, "No file uploaded").into_response()
}

#[derive(Deserialize)]
struct ExportCsvParams {
    start_date: Option<String>,
    end_date: Option<String>,
}

async fn export_csv(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ExportCsvParams>,
) -> impl IntoResponse {
    let temp_path = state.data_dir.join("_export_temp.csv");
    let conn = state.conn.lock().unwrap();

    match kechimochi_core::csv_import::export_csv(
        &conn,
        temp_path.to_str().unwrap_or(""),
        params.start_date.as_deref(),
        params.end_date.as_deref(),
    ) {
        Ok(_count) => {
            drop(conn);
            match std::fs::read(&temp_path) {
                Ok(bytes) => {
                    let _ = std::fs::remove_file(&temp_path);
                    (
                        StatusCode::OK,
                        [
                            (axum::http::header::CONTENT_TYPE, "text/csv"),
                            (
                                axum::http::header::CONTENT_DISPOSITION,
                                "attachment; filename=\"kechimochi_export.csv\"",
                            ),
                        ],
                        bytes,
                    )
                        .into_response()
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

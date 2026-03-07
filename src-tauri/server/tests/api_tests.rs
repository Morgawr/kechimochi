use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use kechimochi_server::routes::api_routes;
use kechimochi_server::state::AppState;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

fn test_state() -> Arc<AppState> {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().to_path_buf();
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir).unwrap();

    let conn = kechimochi_core::db::init_db(&data_dir, "test").unwrap();

    // Leak the tempdir so it lives for the duration of the test
    std::mem::forget(dir);

    Arc::new(AppState {
        conn: Mutex::new(conn),
        data_dir,
        covers_dir,
    })
}

fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/api", api_routes())
        .with_state(state)
}

async fn invoke(app: &Router, command: &str, body: Value) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/invoke/{}", command))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes)
}

async fn invoke_json(app: &Router, command: &str, body: Value) -> (StatusCode, Value) {
    let (status, bytes) = invoke(app, command, body).await;
    let val = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, val)
}

// ─── Media CRUD ──────────────────────────────────────────────

#[tokio::test]
async fn test_add_and_get_media() {
    let state = test_state();
    let app = app(state);

    let media = json!({
        "media": {
            "id": null,
            "title": "Test Anime",
            "media_type": "Watching",
            "status": "Active",
            "language": "Japanese",
            "description": "",
            "cover_image": "",
            "extra_data": "{}",
            "content_type": "Unknown"
        }
    });

    let (status, val) = invoke_json(&app, "add_media", media).await;
    assert_eq!(status, StatusCode::OK);
    let media_id = val.as_i64().unwrap();
    assert!(media_id > 0);

    let (status, val) = invoke_json(&app, "get_all_media", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let arr = val.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["title"], "Test Anime");
    assert_eq!(arr[0]["media_type"], "Watching");
}

#[tokio::test]
async fn test_update_media() {
    let state = test_state();
    let app = app(state);

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "Old Title", "media_type": "Reading",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let id = val.as_i64().unwrap();

    let (status, _) = invoke_json(&app, "update_media", json!({
        "media": {
            "id": id, "title": "New Title", "media_type": "Reading",
            "status": "Finished", "language": "Japanese", "description": "updated",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    assert_eq!(status, StatusCode::OK);

    let (_, val) = invoke_json(&app, "get_all_media", json!({})).await;
    let arr = val.as_array().unwrap();
    assert_eq!(arr[0]["title"], "New Title");
    assert_eq!(arr[0]["status"], "Finished");
    assert_eq!(arr[0]["description"], "updated");
}

#[tokio::test]
async fn test_delete_media() {
    let state = test_state();
    let app = app(state);

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "To Delete", "media_type": "Playing",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let id = val.as_i64().unwrap();

    let (status, _) = invoke_json(&app, "delete_media", json!({"id": id})).await;
    assert_eq!(status, StatusCode::OK);

    let (_, val) = invoke_json(&app, "get_all_media", json!({})).await;
    assert_eq!(val.as_array().unwrap().len(), 0);
}

// ─── Logs ────────────────────────────────────────────────────

#[tokio::test]
async fn test_add_and_get_logs() {
    let state = test_state();
    let app = app(state);

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "Log Target", "media_type": "Watching",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let media_id = val.as_i64().unwrap();

    let (status, log_id) = invoke_json(&app, "add_log", json!({
        "log": { "id": null, "media_id": media_id, "duration_minutes": 30, "date": "2025-01-15" }
    })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(log_id.as_i64().unwrap() > 0);

    let (status, val) = invoke_json(&app, "get_logs", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let arr = val.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["duration_minutes"], 30);

    let (status, val) = invoke_json(&app, "get_logs_for_media", json!({"mediaId": media_id})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(val.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn test_delete_log() {
    let state = test_state();
    let app = app(state);

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "For Log", "media_type": "Reading",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let media_id = val.as_i64().unwrap();

    let (_, log_id) = invoke_json(&app, "add_log", json!({
        "log": { "id": null, "media_id": media_id, "duration_minutes": 60, "date": "2025-02-01" }
    })).await;

    let (status, _) = invoke_json(&app, "delete_log", json!({"id": log_id.as_i64().unwrap()})).await;
    assert_eq!(status, StatusCode::OK);

    let (_, val) = invoke_json(&app, "get_logs", json!({})).await;
    assert_eq!(val.as_array().unwrap().len(), 0);
}

// ─── Heatmap ─────────────────────────────────────────────────

#[tokio::test]
async fn test_heatmap() {
    let state = test_state();
    let app = app(state);

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "Heatmap Media", "media_type": "Watching",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let media_id = val.as_i64().unwrap();

    invoke_json(&app, "add_log", json!({
        "log": { "id": null, "media_id": media_id, "duration_minutes": 45, "date": "2025-03-01" }
    })).await;
    invoke_json(&app, "add_log", json!({
        "log": { "id": null, "media_id": media_id, "duration_minutes": 30, "date": "2025-03-01" }
    })).await;

    let (status, val) = invoke_json(&app, "get_heatmap", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let arr = val.as_array().unwrap();
    let entry = arr.iter().find(|e| e["date"] == "2025-03-01").unwrap();
    assert_eq!(entry["total_minutes"], 75);
}

// ─── Unknown command ──────────────────────────────────────────

#[tokio::test]
async fn test_unknown_command_returns_404() {
    let state = test_state();
    let app = app(state);

    let (status, _) = invoke(&app, "nonexistent_command", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ─── Bad arguments ───────────────────────────────────────────

#[tokio::test]
async fn test_bad_args_returns_400() {
    let state = test_state();
    let app = app(state);

    let (status, _) = invoke(&app, "add_media", json!({"media": "not an object"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ─── Profiles ────────────────────────────────────────────────

#[tokio::test]
async fn test_list_profiles() {
    let state = test_state();
    let app = app(state);

    let (status, val) = invoke_json(&app, "list_profiles", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let arr = val.as_array().unwrap();
    assert!(arr.iter().any(|p| p == "test"));
}

#[tokio::test]
async fn test_switch_profile() {
    let state = test_state();
    let app = app(state);

    // Add media on the initial profile
    invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "Profile1 Media", "media_type": "Reading",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;

    // Switch to a new profile
    let (status, _) = invoke_json(&app, "switch_profile", json!({"profileName": "second"})).await;
    assert_eq!(status, StatusCode::OK);

    // New profile should have no media
    let (_, val) = invoke_json(&app, "get_all_media", json!({})).await;
    assert_eq!(val.as_array().unwrap().len(), 0);

    // Switch back
    let (status, _) = invoke_json(&app, "switch_profile", json!({"profileName": "test"})).await;
    assert_eq!(status, StatusCode::OK);

    // Original media should be there
    let (_, val) = invoke_json(&app, "get_all_media", json!({})).await;
    assert_eq!(val.as_array().unwrap().len(), 1);
}

// ─── CSV export ──────────────────────────────────────────────

#[tokio::test]
async fn test_export_csv() {
    let state = test_state();
    let app = app(state.clone());

    let (_, val) = invoke_json(&app, "add_media", json!({
        "media": {
            "id": null, "title": "Export Target", "media_type": "Watching",
            "status": "Active", "language": "Japanese", "description": "",
            "cover_image": "", "extra_data": "{}", "content_type": "Unknown"
        }
    })).await;
    let media_id = val.as_i64().unwrap();

    invoke_json(&app, "add_log", json!({
        "log": { "id": null, "media_id": media_id, "duration_minutes": 60, "date": "2025-06-15" }
    })).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/export/csv")
        .body(axum::body::Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let content_type = resp.headers().get("content-type").unwrap().to_str().unwrap();
    assert_eq!(content_type, "text/csv");

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let csv_text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(csv_text.contains("Export Target"));
    assert!(csv_text.contains("2025-06-15"));
}

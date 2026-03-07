use std::path::Path;

use crate::db;
use rusqlite::Connection;

/// Save cover image bytes to the covers directory, update the database, and clean up old cover.
pub fn save_cover(
    conn: &Connection,
    covers_dir: &Path,
    media_id: i64,
    file_name: &str,
    data: &[u8],
) -> Result<String, String> {
    std::fs::create_dir_all(covers_dir).map_err(|e| e.to_string())?;

    let dest = covers_dir.join(file_name);

    // Remove old cover if it exists
    let old_cover = db::get_cover_image(conn, media_id);
    if !old_cover.is_empty() {
        let old_path = Path::new(&old_cover);
        if old_path.exists() {
            let _ = std::fs::remove_file(old_path);
        }
    }

    std::fs::write(&dest, data).map_err(|e| e.to_string())?;

    let dest_str = dest.to_string_lossy().to_string();
    db::set_cover_image(conn, media_id, &dest_str)?;

    Ok(dest_str)
}

/// Copy a local file as the cover image for a media entry.
pub fn upload_cover_from_path(
    conn: &Connection,
    covers_dir: &Path,
    media_id: i64,
    source_path: &str,
) -> Result<String, String> {
    std::fs::create_dir_all(covers_dir).map_err(|e| e.to_string())?;

    let src = Path::new(source_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let dest_file = format!("{}.{}", media_id, ext);
    let dest = covers_dir.join(&dest_file);

    // Remove old cover if it exists
    let old_cover = db::get_cover_image(conn, media_id);
    if !old_cover.is_empty() {
        let old_path = Path::new(&old_cover);
        if old_path.exists() {
            let _ = std::fs::remove_file(old_path);
        }
    }

    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    let dest_str = dest.to_string_lossy().to_string();
    db::set_cover_image(conn, media_id, &dest_str)?;

    Ok(dest_str)
}

/// Read file bytes from a path (used for serving cover images).
pub fn read_file_bytes(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

/// Make an external HTTP request (proxy for CORS-restricted APIs).
pub async fn fetch_external_json(
    url: &str,
    method: &str,
    body: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(url),
        _ => client.get(url),
    };

    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

/// Download an image from a URL and save it as the cover for a media entry.
pub async fn download_and_save_cover(
    conn: &Connection,
    covers_dir: &Path,
    media_id: i64,
    url: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let res = res.error_for_status().map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let ext = Path::new(url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let ext = ext.split('?').next().unwrap_or("jpg");

    let dest_file = format!("{}_remote.{}", media_id, ext);
    save_cover(conn, covers_dir, media_id, &dest_file, &bytes)
}

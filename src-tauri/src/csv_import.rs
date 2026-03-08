use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use tauri::Manager;

use crate::db;
use crate::models::{ActivityLog, Media};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

#[derive(Debug, Deserialize)]
struct CsvRow {
    #[serde(rename = "Date")]
    date: String,
    #[serde(rename = "Log Name")]
    log_name: String,
    #[serde(rename = "Media Type")]
    media_type: String,
    #[serde(rename = "Duration")]
    duration: i64,
    #[serde(rename = "Language")]
    language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaCsvRow {
    #[serde(rename = "Title")]
    pub title: String,
    #[serde(rename = "Media Type")]
    pub media_type: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Language")]
    pub language: String,
    #[serde(rename = "Description")]
    pub description: String,
    #[serde(rename = "Content Type")]
    pub content_type: String,
    #[serde(rename = "Extra Data")]
    pub extra_data: String,
    #[serde(rename = "Cover Image (Base64)")]
    pub cover_image_b64: String,
}

#[derive(Debug, Serialize)]
pub struct MediaConflict {
    pub incoming: MediaCsvRow,
    pub existing: Option<Media>,
}

pub fn import_csv(conn: &mut Connection, file_path: &str) -> Result<usize, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_reader(file);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported_count = 0;

    for result in rdr.deserialize() {
        let record: CsvRow = match result {
            Ok(r) => r,
            Err(e) => {
                println!("Error parsing row: {:?}", e);
                continue;
            }
        };

        // Format Date from YYYY/MM/DD to YYYY-MM-DD
        let formatted_date = record.date.replace("/", "-");

        // Check if media exists
        let media_id: i64 = match tx.query_row(
            "SELECT id FROM shared.media WHERE title = ?1",
            [&record.log_name],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Create new media
                let new_media = Media {
                    id: None,
                    title: record.log_name.clone(),
                    media_type: record.media_type.clone(),
                    status: "Completed".into(), // Default to Completed for historical data
                    language: record.language.clone(),
                    description: "".to_string(),
                    cover_image: "".to_string(),
                    extra_data: "{}".to_string(),
                    content_type: "Unknown".to_string(),
                };
                
                match db::add_media_with_id(&tx, &new_media) {
                    Ok(id) => id,
                    Err(e) => {
                        println!("Error creating media {}: {}", record.log_name, e);
                        continue;
                    }
                }
            }
            Err(e) => {
                println!("Database error finding media: {}", e);
                continue;
            }
        };

        let new_log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: record.duration,
            date: formatted_date,
        };

        match db::add_log(&tx, &new_log) {
            Ok(_) => imported_count += 1,
            Err(e) => println!("Error adding log: {}", e),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported_count)
}

pub fn export_media_csv(conn: &Connection, file_path: &str) -> Result<usize, String> {
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;
    let media_list = db::get_all_media(conn).map_err(|e| e.to_string())?;
    let mut count = 0;

    for m in media_list {
        let mut b64 = String::new();
        if !m.cover_image.is_empty() {
            let path = Path::new(&m.cover_image);
            if path.exists() {
                if let Ok(bytes) = std::fs::read(path) {
                    b64 = BASE64.encode(&bytes);
                }
            }
        }

        let row = MediaCsvRow {
            title: m.title,
            media_type: m.media_type,
            status: m.status,
            language: m.language,
            description: m.description,
            content_type: m.content_type,
            extra_data: m.extra_data,
            cover_image_b64: b64,
        };

        wtr.serialize(row).map_err(|e| e.to_string())?;
        count += 1;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

// Parses the CSV and identifies which incoming media exist vs which are new.
// The frontend will then prompt the user and send back a filtered list to actually apply.
pub fn analyze_media_csv(conn: &Connection, file_path: &str) -> Result<Vec<MediaConflict>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_reader(file);
    let mut conflicts = Vec::new();

    for result in rdr.deserialize() {
        let record: MediaCsvRow = match result {
            Ok(r) => r,
            Err(e) => {
                println!("Error parsing media row: {:?}", e);
                continue;
            }
        };

        let existing: Option<Media> = conn.query_row(
            "SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type FROM shared.media WHERE title = ?1",
            [&record.title],
            |row| Ok(Media {
                id: row.get(0)?,
                title: row.get(1)?,
                media_type: row.get(2)?,
                status: row.get(3)?,
                language: row.get(4)?,
                description: row.get(5).unwrap_or_default(),
                cover_image: row.get(6).unwrap_or_default(),
                extra_data: row.get(7).unwrap_or_else(|_| "{}".to_string()),
                content_type: row.get(8).unwrap_or_else(|_| "Unknown".to_string()),
            })
        ).optional().map_err(|e| e.to_string())?;

        conflicts.push(MediaConflict {
            incoming: record,
            existing,
        });
    }

    Ok(conflicts)
}

pub fn apply_media_import(app_handle: &tauri::AppHandle, conn: &mut Connection, records: Vec<MediaCsvRow>) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported = 0;

    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let covers_dir = app_dir.join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    for req in records {
        // Find existing to possibly delete old cover
        let existing_id: Option<i64> = tx.query_row(
            "SELECT id FROM shared.media WHERE title = ?1",
            [&req.title],
            |row| row.get(0)
        ).ok();

        let mut final_cover_path = String::new();

        if !req.cover_image_b64.is_empty() {
            if let Ok(bytes) = BASE64.decode(&req.cover_image_b64) {
                // Generate a generic name using the title hash or timestamp to avoid collisions
                let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
                let dest_file = format!("import_{}.png", stamp);
                let dest = covers_dir.join(&dest_file);
                if std::fs::write(&dest, bytes).is_ok() {
                    final_cover_path = dest.to_string_lossy().to_string();
                }
            }
        }

        if let Some(id) = existing_id {
            // Delete old cover
            let old_cover: String = tx.query_row(
                "SELECT cover_image FROM shared.media WHERE id = ?1",
                [&id],
                |row| row.get(0)
            ).unwrap_or_default();
            
            if !old_cover.is_empty() {
                let _ = std::fs::remove_file(&old_cover);
            }

            let m = Media {
                id: Some(id),
                title: req.title,
                media_type: req.media_type,
                status: req.status,
                language: req.language,
                description: req.description,
                cover_image: final_cover_path,
                extra_data: req.extra_data,
                content_type: req.content_type,
            };
            db::update_media(&tx, &m).map_err(|e| e.to_string())?;
        } else {
            let m = Media {
                id: None,
                title: req.title,
                media_type: req.media_type,
                status: req.status,
                language: req.language,
                description: req.description,
                cover_image: final_cover_path,
                extra_data: req.extra_data,
                content_type: req.content_type,
            };
            db::add_media_with_id(&tx, &m).map_err(|e| e.to_string())?;
        }
        imported += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;
    use std::io::Write;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::create_tables(&conn).unwrap();
        conn
    }

    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn write_csv(content: &str) -> String {
        let dir = std::env::temp_dir();
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = dir.join(format!("kechimochi_test_{}_{}.csv", std::process::id(), id));
        let mut f = File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn test_import_csv_basic() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese\n\
             2024-01-16,呪術廻戦,Watching,25,Japanese\n"
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 2);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 2);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_deduplicates_media() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,FF7,Playing,60,Japanese\n\
             2024-01-16,FF7,Playing,120,Japanese\n"
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        // Only one media entry despite two rows with same title
        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "FF7");

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 2);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_date_formatting() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024/03/01,本好きの下剋上,Reading,30,Japanese\n"
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].date, "2024-03-01");

        std::fs::remove_file(csv_path).ok();
    }
}

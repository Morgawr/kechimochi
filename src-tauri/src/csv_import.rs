use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use chrono::NaiveDate;

use crate::db;
use crate::models::{ActivityLog, Media, Milestone};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

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
    #[serde(rename = "Characters")]
    characters: Option<i64>,
    #[serde(rename = "Activity Type", default)]
    activity_type: Option<String>,
    #[serde(rename = "Notes", default)]
    notes: Option<String>,
    #[serde(rename = "Media Variant", default)]
    media_variant: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MilestoneCsvRow {
    #[serde(rename = "Media Title")]
    pub media_title: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Duration")]
    pub duration: i64,
    #[serde(rename = "Characters")]
    pub characters: i64,
    #[serde(rename = "Date")]
    pub date: Option<String>,
    #[serde(rename = "Media Variant", default)]
    pub media_variant: String,
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
    #[serde(rename = "Variant", default)]
    pub variant: String,
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
    import_csv_from_reader(conn, file)
}

pub fn import_csv_from_reader<R: Read>(conn: &mut Connection, reader: R) -> Result<usize, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);

    let mut records = Vec::new();
    let mut variants_by_title: HashMap<String, HashSet<String>> = HashMap::new();

    for (index, result) in rdr.deserialize().enumerate() {
        let record: CsvRow = match result {
            Ok(r) => r,
            Err(e) => {
                println!("Error parsing row: {:?}", e);
                continue;
            }
        };
        let variant = record.media_variant.trim();
        if !variant.is_empty() {
            variants_by_title
                .entry(record.log_name.clone())
                .or_default()
                .insert(variant.to_string());
        }
        records.push((index + 2, record));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported_count = 0;

    for (row_number, record) in records {
        let formatted_date = normalize_activity_date(&record.date, row_number)?;

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
                    uid: None,
                    title: record.log_name.clone(),
                    variant: variants_by_title
                        .get(&record.log_name)
                        .filter(|variants| variants.len() == 1)
                        .and_then(|variants| variants.iter().next())
                        .cloned()
                        .unwrap_or_default(),
                    media_type: record.media_type.clone(),
                    status: "Complete".into(), // Default to Complete for historical data
                    language: record.language.clone(),
                    description: "".to_string(),
                    cover_image: "".to_string(),
                    extra_data: "{}".to_string(),
                    content_type: "Unknown".to_string(),
                    tracking_status: "Untracked".to_string(),
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
            characters: record.characters.unwrap_or(0),
            date: formatted_date,
            activity_type: record
                .activity_type
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| record.media_type.clone()),
            notes: record.notes.unwrap_or_default(),
        };

        match db::add_log(&tx, &new_log) {
            Ok(_) => imported_count += 1,
            Err(e) => println!("Error adding log: {}", e),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported_count)
}

fn normalize_activity_date(value: &str, row_number: usize) -> Result<String, String> {
    let is_slash_format = value.len() == 10
        && value.chars().nth(4) == Some('/')
        && value.chars().nth(7) == Some('/');
    let is_dash_format = value.len() == 10
        && value.chars().nth(4) == Some('-')
        && value.chars().nth(7) == Some('-');

    if !(is_slash_format || is_dash_format) {
        return Err(format!(
            "Invalid date format on CSV row {}: '{}'. Expected YYYY/MM/DD or YYYY-MM-DD.",
            row_number, value
        ));
    }

    let parse_format = if is_slash_format { "%Y/%m/%d" } else { "%Y-%m-%d" };
    let parsed_date = NaiveDate::parse_from_str(value, parse_format).map_err(|_| {
        format!(
            "Invalid date value on CSV row {}: '{}'. Expected YYYY/MM/DD or YYYY-MM-DD.",
            row_number, value
        )
    })?;

    Ok(parsed_date.format("%Y-%m-%d").to_string())
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
            variant: m.variant,
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

pub fn export_logs_csv(
    conn: &Connection,
    file_path: &str,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;

    wtr.write_record([
        "Date",
        "Log Name",
        "Media Type",
        "Duration",
        "Language",
        "Characters",
        "Activity Type",
        "Notes",
        "Media Variant",
    ])
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.date, m.title, m.media_type, a.duration_minutes, m.language,
                    a.characters, COALESCE(NULLIF(a.activity_type, ''), m.media_type),
                    a.notes, m.variant
             FROM main.activity_logs a
             JOIN shared.media m ON a.media_id = m.id
             ORDER BY a.date DESC, a.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let logs = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for log in logs {
        let (
            date,
            title,
            media_type,
            duration,
            language,
            characters,
            activity_type,
            notes,
            variant,
        ) = log.map_err(|e| e.to_string())?;
        if let Some(start) = &start_date {
            if &date < start {
                continue;
            }
        }
        if let Some(end) = &end_date {
            if &date > end {
                continue;
            }
        }

        wtr.write_record([
            &date,
            &title,
            &media_type,
            &duration.to_string(),
            &language,
            &characters.to_string(),
            &activity_type,
            &notes,
            &variant,
        ])
        .map_err(|e| e.to_string())?;

        count += 1;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn export_milestones_csv(conn: &Connection, file_path: &str) -> Result<usize, String> {
    let mut stmt = conn.prepare(
        "SELECT ms.id, ms.media_title, ms.name, ms.duration, ms.characters, ms.date,
                COALESCE(mu.variant, mt.variant, '')
         FROM main.milestones ms
         LEFT JOIN shared.media mu ON mu.uid = ms.media_uid
         LEFT JOIN shared.media mt ON (ms.media_uid IS NULL OR ms.media_uid = '') AND mt.title = ms.media_title
         ORDER BY ms.id ASC"
    )
        .map_err(|e| e.to_string())?;

    let milestone_iter = stmt
        .query_map([], |row| {
            Ok(MilestoneCsvRow {
                media_title: row.get(1)?,
                name: row.get(2)?,
                duration: row.get(3)?,
                characters: row.get(4)?,
                date: row.get(5)?,
                media_variant: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;

    for milestone in milestone_iter {
        let m = milestone.map_err(|e| e.to_string())?;
        wtr.serialize(m).map_err(|e| e.to_string())?;
        count += 1;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn import_milestones_csv(conn: &mut Connection, file_path: &str) -> Result<usize, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    import_milestones_csv_from_reader(conn, file)
}

pub fn import_milestones_csv_from_reader<R: Read>(
    conn: &mut Connection,
    reader: R,
) -> Result<usize, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported_count = 0;

    for result in rdr.deserialize() {
        let record: MilestoneCsvRow = match result {
            Ok(r) => r,
            Err(e) => {
                println!("Error parsing milestone row: {:?}", e);
                continue;
            }
        };

        let milestone = Milestone {
            id: None,
            media_uid: None,
            media_title: record.media_title,
            name: record.name,
            duration: record.duration,
            characters: record.characters,
            date: record.date,
        };

        match db::add_milestone(&tx, &milestone) {
            Ok(_) => imported_count += 1,
            Err(e) => println!("Error adding milestone log: {}", e),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported_count)
}

// Parses the CSV and identifies which incoming media exist vs which are new.
// The frontend will then prompt the user and send back a filtered list to actually apply.
pub fn analyze_media_csv(conn: &Connection, file_path: &str) -> Result<Vec<MediaConflict>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    analyze_media_csv_from_reader(conn, file)
}

pub fn analyze_media_csv_from_reader<R: Read>(
    conn: &Connection,
    reader: R,
) -> Result<Vec<MediaConflict>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);
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
            "SELECT id, uid, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status, variant FROM shared.media WHERE title = ?1",
            [&record.title],
            |row| Ok(Media {
                id: row.get(0)?,
                uid: row.get(1)?,
                title: row.get(2)?,
                media_type: row.get(3)?,
                status: row.get(4)?,
                language: row.get(5)?,
                description: row.get(6).unwrap_or_default(),
                cover_image: row.get(7).unwrap_or_default(),
                extra_data: row.get(8).unwrap_or_else(|_| "{}".to_string()),
                content_type: row.get(9).unwrap_or_else(|_| "Unknown".to_string()),
                tracking_status: row.get(10).unwrap_or_else(|_| "Untracked".to_string()),
                variant: row.get(11).unwrap_or_default(),
            })
        ).optional().map_err(|e| e.to_string())?;

        conflicts.push(MediaConflict {
            incoming: record,
            existing,
        });
    }

    Ok(conflicts)
}

pub fn apply_media_import(
    covers_dir: std::path::PathBuf,
    conn: &mut Connection,
    records: Vec<MediaCsvRow>,
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported = 0;

    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    for req in records {
        // Find existing to possibly delete old cover
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT id, variant FROM shared.media WHERE title = ?1",
                [&req.title],
                |row| Ok((row.get(0)?, row.get(1).unwrap_or_default())),
            )
            .ok();

        let mut final_cover_path = String::new();

        if !req.cover_image_b64.is_empty() {
            if let Ok(bytes) = BASE64.decode(&req.cover_image_b64) {
                // Generate a generic name using the title hash or timestamp to avoid collisions
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis();
                let dest_file = format!("import_{}.png", stamp);
                let dest = covers_dir.join(&dest_file);
                if std::fs::write(&dest, bytes).is_ok() {
                    final_cover_path = dest.to_string_lossy().to_string();
                }
            }
        }

        if let Some((id, existing_variant)) = existing {
            // Delete old cover
            let old_cover: String = tx
                .query_row(
                    "SELECT cover_image FROM shared.media WHERE id = ?1",
                    [&id],
                    |row| row.get(0),
                )
                .unwrap_or_default();

            if !old_cover.is_empty() {
                let _ = std::fs::remove_file(&old_cover);
            }

            let m = Media {
                id: Some(id),
                uid: None,
                title: req.title,
                variant: existing_variant,
                media_type: req.media_type,
                status: req.status,
                language: req.language,
                description: req.description,
                cover_image: final_cover_path,
                extra_data: req.extra_data,
                content_type: req.content_type,
                tracking_status: "Untracked".to_string(),
            };
            db::update_media(&tx, &m).map_err(|e| e.to_string())?;
        } else {
            let m = Media {
                id: None,
                uid: None,
                title: req.title,
                variant: req.variant.trim().to_string(),
                media_type: req.media_type,
                status: req.status,
                language: req.language,
                description: req.description,
                cover_image: final_cover_path,
                extra_data: req.extra_data,
                content_type: req.content_type,
                tracking_status: "Untracked".to_string(),
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
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
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

    fn sample_media(title: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        }
    }

    fn sample_media_csv_row(title: &str, variant: &str) -> MediaCsvRow {
        MediaCsvRow {
            title: title.to_string(),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            content_type: "Manga".to_string(),
            extra_data: "{}".to_string(),
            cover_image_b64: String::new(),
            variant: variant.to_string(),
        }
    }

    #[test]
    fn test_import_csv_basic() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters\n\
             2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese,1000\n\
             2024-01-16,呪術廻戦,Watching,25,Japanese,0\n",
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
             2024-01-16,FF7,Playing,120,Japanese\n",
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
    fn test_activity_import_preserves_existing_variant_when_csv_variant_is_missing_or_different() {
        let mut conn = setup_test_db();
        let mut existing = sample_media("Horimiya");
        existing.variant = "Manga".to_string();
        let existing_id = db::add_media_with_id(&conn, &existing).unwrap();

        let csv = "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2024-01-15,Horimiya,Watching,25,Japanese,0,Watching,,\n\
                   2024-01-16,Horimiya,Watching,25,Japanese,0,Watching,,Anime\n";
        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            2
        );

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].id, Some(existing_id));
        assert_eq!(media[0].variant, "Manga");
        assert_eq!(db::get_logs_for_media(&conn, existing_id).unwrap().len(), 2);
    }

    #[test]
    fn test_activity_import_uses_consensus_variant_only_for_new_media() {
        let mut conn = setup_test_db();
        let csv = "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2024-01-15,Horimiya,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-16,Horimiya,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-15,Mixed,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-16,Mixed,Watching,25,Japanese,0,Watching,,Anime\n";
        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            4
        );

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "Horimiya")
                .unwrap()
                .variant,
            "Manga"
        );
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "Mixed")
                .unwrap()
                .variant,
            ""
        );
    }

    #[test]
    fn test_media_import_preserves_existing_variant_and_sets_it_only_for_new_titles() {
        let mut conn = setup_test_db();
        let mut existing = sample_media("Horimiya");
        existing.variant = "Manga".to_string();
        db::add_media_with_id(&conn, &existing).unwrap();

        let covers_dir = std::env::temp_dir().join(format!(
            "variant_media_import_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        apply_media_import(
            covers_dir.clone(),
            &mut conn,
            vec![
                sample_media_csv_row("Horimiya", ""),
                sample_media_csv_row("New Title", "Light Novel"),
            ],
        )
        .unwrap();

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "Horimiya")
                .unwrap()
                .variant,
            "Manga"
        );
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "New Title")
                .unwrap()
                .variant,
            "Light Novel"
        );
        std::fs::remove_dir_all(covers_dir).ok();
    }

    #[test]
    fn test_import_csv_date_formatting() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024/03/01,本好きの下剋上,Reading,30,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].date, "2024-03-01");

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_export_media_csv() {
        let conn = setup_test_db();
        let m = Media {
            id: None,
            uid: None,
            title: "Export Test".to_string(),
            variant: "Light Novel".to_string(),
            media_type: "Reading".to_string(),
            status: "Ongoing".to_string(),
            language: "Japanese".to_string(),
            description: "Test Desc".to_string(),
            cover_image: "".to_string(),
            extra_data: "{\"key\":\"val\"}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        db::add_media_with_id(&conn, &m).unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("export_test.csv");
        let path_str = path.to_str().unwrap().to_string();

        let count = export_media_csv(&conn, &path_str).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Export Test"));
        assert!(content.contains("Novel"));
        assert!(content.contains("Light Novel"));
        // CSV escapes double quotes in fields by doubling them
        assert!(
            content.contains("\"{ \"\"key\"\": \"\"val\"\" }\"")
                || content.contains("\"{ \"\"key\"\":\"\"val\"\" }\"")
                || content.contains("key") && content.contains("val")
        );

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_analyze_media_csv() {
        let conn = setup_test_db();
        // Add one existing media
        let m = Media {
            id: None,
            uid: None,
            title: "Existing".to_string(),
            variant: "Manga".to_string(),
            media_type: "Reading".to_string(),
            status: "Complete".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        db::add_media_with_id(&conn, &m).unwrap();

        let csv_path = write_csv(
            "Title,Media Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)\n\
             Existing,Reading,Ongoing,Japanese,,Novel,{}, \n\
             New Media,Watching,Plan to Watch,English,,Anime,{}, \n"
        );

        let conflicts = analyze_media_csv(&conn, &csv_path).unwrap();
        assert_eq!(conflicts.len(), 2);

        // First one should have an existing media
        assert_eq!(conflicts[0].incoming.title, "Existing");
        assert!(conflicts[0].existing.is_some());
        assert_eq!(conflicts[0].existing.as_ref().unwrap().title, "Existing");

        // Second one should be new
        assert_eq!(conflicts[1].incoming.title, "New Media");
        assert!(conflicts[1].existing.is_none());

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_export_logs_csv() {
        let conn = setup_test_db();
        let mut media = sample_media("Log Test");
        media.variant = "Manga".to_string();
        let m_id = db::add_media_with_id(&conn, &media).unwrap();

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 30,
                characters: 100,
                date: "2024-01-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 45,
                characters: 200,
                date: "2024-02-01".to_string(),
                activity_type: "Watching".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 60,
                characters: 300,
                date: "2024-03-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("export_logs_test.csv");
        let path_str = path.to_str().unwrap().to_string();

        // Test with date filtering
        let count = export_logs_csv(
            &conn,
            &path_str,
            Some("2024-01-15".into()),
            Some("2024-02-15".into()),
        )
        .unwrap();
        assert_eq!(count, 1); // Only 2024-02-01 should match

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("2024-02-01"));
        assert!(content.contains("45"));
        assert!(content.contains("200")); // Characters
        assert!(content.contains("Media Variant"));
        assert!(content.contains("Manga"));
        assert!(content.contains("Log Test,Reading,45,Japanese,200,Watching"));
        assert!(!content.contains("2024-01-01"));
        assert!(!content.contains("2024-03-01"));

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_csv_malformed_skips() {
        let mut conn = setup_test_db();
        // Row 2 is missing a column (Duration)
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Good Row,Reading,45,Japanese\n\
             2024-01-16,Bad Row,Reading,MissingCol\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1); // Only the good row should be imported

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Good Row");

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_save_cover_bytes() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Byte Test")).unwrap();
        let temp_dir = std::env::temp_dir().join(format!("byte_covers_{}", std::process::id()));

        let bytes = vec![0, 1, 2, 3];
        let dest =
            db::save_cover_bytes(&conn, temp_dir.clone(), media_id, bytes.clone(), "png").unwrap();

        assert!(std::path::Path::new(&dest).exists());
        assert_eq!(std::fs::read(&dest).unwrap(), bytes);

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_binary_asset_round_trip() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir().join(format!("binary_test_{}", std::process::id()));
        let covers_dir = temp_dir.join("covers");
        std::fs::create_dir_all(&covers_dir).unwrap();

        // 1. Create a media with a base64 cover via import
        let fake_image_bytes = vec![255, 216, 255, 224, 0, 16, 74, 70, 73, 70]; // Fake JPEG header
        let b64_img = BASE64.encode(&fake_image_bytes);

        let records = vec![MediaCsvRow {
            title: "Binary Media".to_string(),
            media_type: "Watching".to_string(),
            status: "Ongoing".to_string(),
            language: "English".to_string(),
            description: "".to_string(),
            content_type: "Anime".to_string(),
            extra_data: "{}".to_string(),
            cover_image_b64: b64_img,
            variant: "Anime".to_string(),
        }];

        apply_media_import(covers_dir.clone(), &mut conn, records).unwrap();

        // 2. Export it back to CSV
        let export_path = temp_dir.join("export.csv");
        let export_path_str = export_path.to_str().unwrap().to_string();
        export_media_csv(&conn, &export_path_str).unwrap();

        // 3. Verify the exported CSV contains the same base64
        let content = std::fs::read_to_string(&export_path).unwrap();
        assert!(content.contains(&BASE64.encode(&fake_image_bytes)));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_export_milestones_csv() {
        let conn = setup_test_db();
        let mut media = sample_media("Export M");
        media.variant = "Manga".to_string();
        db::add_media_with_id(&conn, &media).unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: None,
                media_title: "Export M".into(),
                name: "M1".into(),
                duration: 120,
                characters: 500,
                date: Some("2024-03-12".into()),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("milestones_export.csv");
        let path_str = path.to_str().unwrap().to_string();

        let count = export_milestones_csv(&conn, &path_str).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Export M"));
        assert!(content.contains("M1"));
        assert!(content.contains("120"));
        assert!(content.contains("500"));
        assert!(content.contains("2024-03-12"));
        assert!(content.contains("Media Variant"));
        assert!(content.contains("Manga"));

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_milestones_csv() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Media Title,Name,Duration,Characters,Date\n\
             Imported Media,First Quest,60,100,2024-01-01\n\
             Imported Media,Second Quest,120,200,\n",
        );

        let count = import_milestones_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        let milestones = db::get_milestones_for_media(&conn, "Imported Media").unwrap();
        assert_eq!(milestones.len(), 2);
        assert_eq!(milestones[0].name, "First Quest");
        assert_eq!(milestones[0].characters, 100);
        assert_eq!(milestones[1].name, "Second Quest");
        assert_eq!(milestones[1].characters, 200);
        assert_eq!(milestones[1].date, None);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_activity_backwards_compatibility() {
        let mut conn = setup_test_db();
        // Missing "Characters" column
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Old Format,Reading,45,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].title, "Old Format");
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].characters, 0); // Default value

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_rejects_invalid_date_format_and_rolls_back() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Valid Row,Reading,45,Japanese\n\
             01/16/2024,Invalid Row,Reading,30,Japanese\n",
        );

        let result = import_csv(&mut conn, &csv_path);
        assert!(result.is_err());

        let error = result.err().unwrap();
        assert!(error.contains("Invalid date format on CSV row 3"));
        assert!(error.contains("Expected YYYY/MM/DD or YYYY-MM-DD"));

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_export_logs_csv_includes_notes_column() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Notes Export")).unwrap();

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-07-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "exported note text".to_string(),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "notes_export_{}_{}.csv",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let path_str = path.to_str().unwrap().to_string();

        let count = export_logs_csv(&conn, &path_str, None, None).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Notes"), "Header should include 'Notes'");
        assert!(
            content.contains("exported note text"),
            "Row should contain the note text"
        );

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_csv_with_notes_column_imports_note() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes\n\
             2024-08-01,Notes Media,Reading,45,Japanese,1000,Reading,My note here\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "My note here");

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_without_notes_column_imports_with_empty_notes() {
        // Old-format CSV without a Notes column should import cleanly with empty notes.
        // Guards the #[serde(rename = "Notes", default)] on CsvRow.notes.
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type\n\
             2024-09-01,Old Format Media,Reading,30,Japanese,500,Reading\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "");

        std::fs::remove_file(csv_path).ok();
    }
}

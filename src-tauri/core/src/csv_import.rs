use rusqlite::Connection;
use serde::Deserialize;
use std::fs::File;
use std::path::Path;

use crate::db;
use crate::models::{ActivityLog, Media};

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

pub fn import_csv(conn: &mut Connection, file_path: &str) -> Result<usize, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(file);

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
            "SELECT id FROM media WHERE title = ?1",
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

pub fn export_csv(
    conn: &Connection,
    file_path: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<usize, String> {
    let logs = db::get_logs(conn).map_err(|e| e.to_string())?;

    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;

    wtr.write_record(["Date", "Log Name", "Media Type", "Duration", "Language"])
        .map_err(|e| e.to_string())?;

    for log in logs {
        if let Some(start) = start_date {
            if log.date.as_str() < start {
                continue;
            }
        }
        if let Some(end) = end_date {
            if log.date.as_str() > end {
                continue;
            }
        }

        wtr.write_record([
            &log.date,
            &log.title,
            &log.media_type,
            &log.duration_minutes.to_string(),
            &log.language,
        ])
        .map_err(|e| e.to_string())?;

        count += 1;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::create_tables(&conn).unwrap();
        conn
    }

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn write_csv(content: &str) -> String {
        let dir = std::env::temp_dir();
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = dir.join(format!(
            "kechimochi_test_{}_{}.csv",
            std::process::id(),
            id
        ));
        let mut f = File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn test_import_csv_basic() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Test Media A,Reading,45,Japanese\n\
             2024-01-16,Test Media B,Watching,25,Japanese\n",
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
             2024/03/01,Test Media,Reading,30,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].date, "2024-03-01");

        std::fs::remove_file(csv_path).ok();
    }
}

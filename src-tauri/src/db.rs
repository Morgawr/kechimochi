use rusqlite::{params, Connection, Result};
use std::fs;
use tauri::Manager;

use crate::models::{ActivityLog, ActivitySummary, Media, DailyHeatmap};

fn migrate_to_shared(conn: &Connection) -> Result<()> {
    // Check if `main.media` exists
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='media'",
        [],
        |row| row.get(0),
    )?;

    if count > 0 {
        // Create shared.media table if it doesn't exist
        create_shared_media_table(conn)?;
        
        // Copy old media over.
        let _ = conn.execute(
            "INSERT OR IGNORE INTO shared.media (id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status)
             SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type, 'Untracked' FROM main.media",
            [],
        );

        // Before dropping main.media, recreate activity_logs without the FOREIGN KEY
        let count_logs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='activity_logs'",
            [],
            |row| row.get(0),
        )?;
        
        if count_logs > 0 {
           conn.execute("ALTER TABLE main.activity_logs RENAME TO activity_logs_old", [])?;
           create_activity_logs_table(conn)?;
           conn.execute("INSERT INTO main.activity_logs (id, media_id, duration_minutes, date) SELECT id, media_id, duration_minutes, date FROM main.activity_logs_old", [])?;
           conn.execute("DROP TABLE main.activity_logs_old", [])?;
        }

        // Now drop main.media
        conn.execute("DROP TABLE main.media", [])?;
    }
    Ok(())
}

fn create_shared_media_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS shared.media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL UNIQUE,
            media_type TEXT NOT NULL,
            status TEXT NOT NULL,
            language TEXT NOT NULL,
            description TEXT DEFAULT '',
            cover_image TEXT DEFAULT '',
            extra_data TEXT DEFAULT '{}',
            content_type TEXT DEFAULT 'Unknown',
            tracking_status TEXT DEFAULT 'Untracked'
        )",
        [],
    )?;
    
    // Try to add the columns to existing tables (fails gracefully if they already exist)
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN description TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN cover_image TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN extra_data TEXT DEFAULT '{}'", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN content_type TEXT DEFAULT 'Unknown'", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN tracking_status TEXT DEFAULT 'Untracked'", []);
    
    Ok(())
}

fn create_activity_logs_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            date TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

fn create_settings_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn create_tables(conn: &Connection) -> Result<()> {
    create_shared_media_table(conn)?;
    create_activity_logs_table(conn)?;
    create_settings_table(conn)?;
    Ok(())
}

pub fn init_db(app_handle: &tauri::AppHandle, profile_name: &str) -> Result<Connection> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    
    let shared_db_path = app_dir.join("kechimochi_shared_media.db");
    let file_name = format!("kechimochi_{}.db", profile_name);
    let db_path = app_dir.join(file_name);

    let conn = Connection::open(db_path)?;
    
    // Attach shared database
    conn.execute(
        "ATTACH DATABASE ?1 AS shared",
        rusqlite::params![shared_db_path.to_string_lossy()],
    )?;

    // Run migrations
    migrate_to_shared(&conn)?;

    // Ensure tables exist
    create_tables(&conn)?;

    Ok(conn)
}

pub fn wipe_profile(app_handle: &tauri::AppHandle, profile_name: &str) -> std::result::Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    let file_name = format!("kechimochi_{}.db", profile_name);
    let db_path = app_dir.join(file_name);
    
    if db_path.exists() {
        // Activity logs are wiped with the profile DB deletion. 
        // Media remains untouched.
        fs::remove_file(&db_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn list_profiles(app_handle: &tauri::AppHandle) -> std::result::Result<Vec<String>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let mut profiles = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("kechimochi_") && name.ends_with(".db") && name != "kechimochi_shared_media.db" {
                    let profile_name = name.trim_start_matches("kechimochi_").trim_end_matches(".db");
                    profiles.push(profile_name.to_string());
                }
            }
        }
    }
    Ok(profiles)
}

// Media Operations
pub fn get_all_media(conn: &Connection) -> Result<Vec<Media>> {
    let mut stmt = conn.prepare("SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status FROM shared.media")?;
    let media_iter = stmt.query_map([], |row| {
        Ok(Media {
            id: row.get(0)?,
            title: row.get(1)?,
            media_type: row.get(2)?,
            status: row.get(3)?,
            language: row.get(4)?,
            description: row.get(5).unwrap_or_default(),
            cover_image: row.get(6).unwrap_or_default(),
            extra_data: row.get(7).unwrap_or_else(|_| "{}".to_string()),
            content_type: row.get(8).unwrap_or_else(|_| "Unknown".to_string()),
            tracking_status: row.get(9).unwrap_or_else(|_| "Untracked".to_string()),
        })
    })?;

    let mut media_list = Vec::new();
    for media in media_iter {
        media_list.push(media?);
    }
    Ok(media_list)
}

pub fn add_media_with_id(conn: &Connection, media: &Media) -> Result<i64> {
    conn.execute(
        "INSERT INTO shared.media (title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![media.title, media.media_type, media.status, media.language, media.description, media.cover_image, media.extra_data, media.content_type, media.tracking_status],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_media(conn: &Connection, media: &Media) -> Result<()> {
    conn.execute(
        "UPDATE shared.media SET title = ?1, media_type = ?2, status = ?3, language = ?4, description = ?5, cover_image = ?6, extra_data = ?7, content_type = ?8, tracking_status = ?9 WHERE id = ?10",
        params![
            media.title,
            media.media_type,
            media.status,
            media.language,
            media.description,
            media.cover_image,
            media.extra_data,
            media.content_type,
            media.tracking_status,
            media.id.unwrap() // Must have an ID
        ],
    )?;
    Ok(())
}

pub fn delete_media(conn: &Connection, id: i64) -> Result<()> {
    // Delete cover image from file system
    if let Ok(cover_image) = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1 AND cover_image IS NOT NULL AND cover_image != ''",
        params![id],
        |row| row.get::<_, String>(0),
    ) {
        let path = std::path::Path::new(&cover_image);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    // Also delete associated logs in the local main DB
    conn.execute("DELETE FROM main.activity_logs WHERE media_id = ?1", params![id])?;
    conn.execute("DELETE FROM shared.media WHERE id = ?1", params![id])?;
    Ok(())
}

// Activity Log Operations
pub fn add_log(conn: &Connection, log: &ActivityLog) -> Result<i64> {
    conn.execute(
        "INSERT INTO main.activity_logs (media_id, duration_minutes, date) VALUES (?1, ?2, ?3)",
        params![log.media_id, log.duration_minutes, log.date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_log(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_activities(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs", [])?;
    Ok(())
}

pub fn get_logs(conn: &Connection) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, m.media_type, a.duration_minutes, a.date, m.language 
         FROM main.activity_logs a 
         JOIN shared.media m ON a.media_id = m.id
         ORDER BY a.date DESC",
    )?;
    let logs_iter = stmt.query_map([], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            date: row.get(5)?,
            language: row.get(6)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_logs_for_media(conn: &Connection, media_id: i64) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, m.media_type, a.duration_minutes, a.date, m.language 
         FROM main.activity_logs a 
         JOIN shared.media m ON a.media_id = m.id
         WHERE a.media_id = ?1
         ORDER BY a.date DESC",
    )?;
    let logs_iter = stmt.query_map(params![media_id], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            date: row.get(5)?,
            language: row.get(6)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_heatmap(conn: &Connection) -> Result<Vec<DailyHeatmap>> {
    let mut stmt = conn.prepare(
        "SELECT date, SUM(duration_minutes) as total_minutes 
         FROM main.activity_logs 
         GROUP BY date 
         ORDER BY date ASC",
    )?;
    let heatmap_iter = stmt.query_map([], |row| {
        Ok(DailyHeatmap {
            date: row.get(0)?,
            total_minutes: row.get(1)?,
        })
    })?;

    let mut heatmap_list = Vec::new();
    for hm in heatmap_iter {
        heatmap_list.push(hm?);
    }
    Ok(heatmap_list)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO main.settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM main.settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", []).unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    fn sample_media(title: &str) -> Media {
        Media {
            id: None,
            title: title.to_string(),
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

    #[test]
    fn test_create_tables() {
        let conn = setup_test_db();
        // Verify tables exist by querying sqlite_master
        let count_main: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name IN ('activity_logs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let count_shared: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared.sqlite_master WHERE type='table' AND name IN ('media')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_main, 1);
        assert_eq!(count_shared, 1);
    }

    #[test]
    fn test_add_and_get_media() {
        let conn = setup_test_db();
        let media = sample_media("ある魔女が死ぬまで");
        let id = add_media_with_id(&conn, &media).unwrap();
        assert!(id > 0);

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "ある魔女が死ぬまで");
        assert_eq!(all[0].id, Some(id));
    }

    #[test]
    fn test_add_duplicate_media_fails() {
        let conn = setup_test_db();
        let media = sample_media("薬屋のひとりごと");
        add_media_with_id(&conn, &media).unwrap();
        let result = add_media_with_id(&conn, &media);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_media() {
        let conn = setup_test_db();
        let media = sample_media("呪術廻戦");
        let id = add_media_with_id(&conn, &media).unwrap();

        let updated = Media {
            id: Some(id),
            title: "呪術廻戦".to_string(),
            media_type: "Watching".to_string(),
            status: "Completed".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        update_media(&conn, &updated).unwrap();

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].media_type, "Watching");
        assert_eq!(all[0].status, "Completed");
    }

    #[test]
    fn test_delete_media_cascades_logs() {
        let conn = setup_test_db();
        let media = sample_media("FF7");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 60,
            date: "2024-01-15".to_string(),
        };
        add_log(&conn, &log).unwrap();

        // Verify log exists
        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);

        // Delete media (should cascade)
        delete_media(&conn, media_id).unwrap();

        let media_list = get_all_media(&conn).unwrap();
        assert_eq!(media_list.len(), 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);
    }

    #[test]
    fn test_add_and_get_logs() {
        let conn = setup_test_db();
        let media = sample_media("本好きの下剋上");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 45,
            date: "2024-03-01".to_string(),
        };
        let log_id = add_log(&conn, &log).unwrap();
        assert!(log_id > 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "本好きの下剋上");
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].date, "2024-03-01");
    }

    #[test]
    fn test_get_heatmap_aggregation() {
        let conn = setup_test_db();
        let media = sample_media("ハイキュー");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        // Two logs on the same day
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 30,
            date: "2024-06-01".to_string(),
        }).unwrap();
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 45,
            date: "2024-06-01".to_string(),
        }).unwrap();

        // One log on a different day
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 20,
            date: "2024-06-02".to_string(),
        }).unwrap();

        let heatmap = get_heatmap(&conn).unwrap();
        assert_eq!(heatmap.len(), 2);
        assert_eq!(heatmap[0].date, "2024-06-01");
        assert_eq!(heatmap[0].total_minutes, 75); // 30 + 45
        assert_eq!(heatmap[1].date, "2024-06-02");
        assert_eq!(heatmap[1].total_minutes, 20);
    }
}
